---
topic: shim-mutation-surface
tags: [shim, state, plan, validation, framework]
issues: [275]
created: 2026-06-13T16:30:00Z
---

# Closing the shim mutation-surface gaps (#275)

REVIEW design, verified vs code 2026-06-13.

## The 6 direct-JSON writes and their new homes

| # | Field (file) | New subcommand |
|---|---|---|
| 1 | `parallelExecution` incl. completedInGroup (state.json) | `state.mjs parallel <wid> --start "1,2" --total N` / `--complete N` / `--clear` |
| 2 | `phase.healAttempts[]` (state.json) | `state.mjs heal-attempt <wid> --category C --outcome O [--message --strategy --next-step]` |
| 3 | `issue.{body,labels,labelDetails,state,url,createdAt,updatedAt}` (state.json) | `state.mjs enrich <wid> --json <file|-)` (allowlisted keys only) |
| 4 | `release.{currentIssues[],completedIssues[],completedBranches[]}` (state.json) | `state.mjs release-wave release:V [--current "41,42"] [--completed-issue N] [--completed-branch name]` |
| 5 | plan `phases[].{status,summary,completedAt,startedAt,error}` (plan file) | `plan.mjs phase <issue> --number N --status S [--summary ... --completed-at ISO ...]` |
| 6 | plan `successCriteria[].{verified,verifiedAt}` (plan file) | `plan.mjs verify-criteria <issue>` (applies the coverage-matrix rule) |
| + | plan `audited`/`auditedAt` (mark-audited.mjs) | `plan.mjs audited <issue>` — fold; mark-audited.mjs delegates |

## Architecture decisions (binding)

- **Single enum source.** Add EXPORTED constants to `state.mjs`: `VALID_WORK_STATUS`, `VALID_PHASE_STATUS` (= schema phaseStatus: pending/executing/completed/failed/skipped), `VALID_PIPELINE_STEP` (already `VALID_STEPS` — reuse/rename consistently), `VALID_HEAL_CATEGORY` (build-error/type-error/test-failure/lint-error/other — = config.schema autoHealCategory), `VALID_HEAL_OUTCOME` (success/failure). `plan.mjs` imports these from `./state.mjs` (it already imports resolveTikiPath). NO second copy.
- **`plan.mjs` is a NEW script** (mirrors mark-audited.mjs conventions: parseArgs, writeJsonAtomic, resolveTikiPath import, Node-built-ins only, die() codes). It owns plan-file mutations. install.js copies all scripts/*.mjs so it ships to `.claude/tiki/scripts/plan.mjs`; command bodies reference `node .claude/tiki/scripts/plan.mjs ...`. The plugin-layout test (#268) will extract + resolve it post-regen.
- **Write-time validation = hand-rolled built-ins** (NO ajv — Windows reparse-point constraint). Each subcommand validates: workId shape, enum membership (against the VALID_* sets), required fields, numeric coercion. Reject → exit 1 + stderr message (mirror existing transition validation).
- **Parity guard for the new enum sets.** Extend the #274 parity infra: new `packages/shared/src/__tests__/schema-shim-parity.test.ts` parses state.mjs's `VALID_PHASE_STATUS` / `VALID_WORK_STATUS` / `VALID_PIPELINE_STEP` / `VALID_HEAL_CATEGORY` and asserts each == its schema enum (reuse `_schema-enums.ts`). This stops the new validation from silently reintroducing drift — the exact class Epic 2 exists to kill.
- **parallelExecution Rust parity:** state_transition.rs already mutates parallelExecution on transition; the new `state.mjs parallel` subcommand is framework-only (desktop writes via its own IPC path). Document as framework-only in the mutation-parity scope; no new Rust mirror needed (no transition semantics change).
- **enrich allowlist:** body, labels, labelDetails, state, url, createdAt, updatedAt (+ number/title already set). Reject unknown keys so a typo can't write garbage into the issue object.

## Command-file edits (delete the acknowledged paragraphs)

- execute.md: parallelExecution (~L350), successCriteria.verified (~L358), healAttempts (~L566), per-phase plan status updates → call the new subcommands; DELETE every "direct JSON write acknowledged" / "shim does not expose" paragraph.
- release.md: currentIssues/completedBranches (~L256-280) → `release-wave`; delete acknowledged paragraph.
- get.md: issue-metadata enrichment (~L39-40) → `enrich`; delete the "follow-up direct JSON write" note. (The enrich helper replaces the bespoke tiki-enrich.mjs the dogfop used.)
- audit.md: `mark-audited.mjs` → `plan.mjs audited` (keep mark-audited.mjs as a thin delegator for back-comp).
- **Source-scan guard:** new/extended test asserting NO command .md contains the phrases "direct JSON write acknowledged", "shim does not expose", "write `<field>` directly". This pins the deletion (a future edit can't quietly reintroduce a direct write).
- yolo.md legacy plugin-only fallback STAYS (path-resolution fallback, not a surface gap; #268 bootstrap covers it).

## Conventions to mirror (from existing shim)
- parseArgs (state.mjs); withStateLock + writeStateAtomic for state.json; writeJsonAtomic (mark-audited) for plan files.
- Subcommand dispatch in state.mjs main() switch; help/usage text updated.
- Tests: state.test.mjs + new plan.test.mjs spawn the real CLI (execFileSync) and assert resulting JSON + reject-on-bad-input exit codes.
- Dogfood regen via `node packages/framework/install.js`; plugin-distribution dogfood-parity + plugin-layout + command-transition-coverage guards must stay green.
