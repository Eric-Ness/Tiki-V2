---
topic: reconciler-contract
tags: [reconciler, state, framework, hooks]
issues: [270, 271, 272]
created: 2026-06-13T01:00:00Z
---

# Reconciler internals — contract and extension points

Facts verified against `packages/framework/scripts/reconcile-state.mjs` (2026-06-13), for Epic #269 work (#270 bootstrap, #271 SHIP/release derivation, #272 journal).

## Safety contract (header lines 17-37 — every rule fixed a real trap; #270/#271 deliberately narrow rules 1 & 4)
1. activeWork-scoped, never creates entries (→ being narrowed by #270 with a 3-condition bootstrap rule).
2. Advance-only (STEP_ORDER monotonic; `GET:0 … SHIP:5`).
3. FROZEN_STATUSES = failed | paused | completed — never touched.
4. Completion only from `history.recentIssues` membership (→ #271 adds archived-plan + gh-closed as a second signal).
5. Legality pre-guarded with `isLegalTransition` BEFORE `applyTransition` (applyTransition `die()`s on illegal — would crash the hook).
6. Never blocks: `withStateLock(tikiPath, pass, { lenient: true })` skips on contention; `--quiet` always exits 0.

## Key extension points
- **`applyTransition(state, input)` CREATES a fresh entry** when `state.activeWork[workId]` is absent and `input.issue` ({number, title}) is provided (state.mjs:446-483) — no legality check on creation (no from-status). Bootstrap (#270) can call it directly with a derived toStatus/toStep.
- **`deriveTarget(plan)` ladder:** plan null or `phases.length === 0` → null; phase started (`derivePhase`) → executing/EXECUTE with {current,total,status}; else `plan.audited === true` → planning/AUDIT; else planning/PLAN. All-phases-done stays executing/EXECUTE phase-status "completed" (SHIP never fabricated — rule 4).
- **`reconcile()` pass loop** iterates `Object.entries(state.activeWork)` filtering `issue:*` — bootstrap must run as a separate scan of `.tiki/plans/*.json` BEFORE/AFTER that loop, inside the same locked pass. Plans dir contains an `archive/` subdir — match files only via `/^issue-(\d+)\.json$/` on readdir entries.
- **`buildReport(state, tikiPath)`** is the read-only mirror powering `--print`; any new reconcile behavior MUST be mirrored there (drift/"would create" rows) or the doctor lies. `formatReport` renders rows; "would create" rows need a workId-like label + note.
- **Write-only-on-change:** `reconcile()` writes state only when `result.changes.length > 0` — bootstrap changes must push into `result.changes` to be persisted.

## 2026-06-13 findings (#271 REVIEW decisions)

- **Ship signal for issues** = `.tiki/plans/archive/issue-N.json` exists (active plan may also linger — archive presence wins) AND GitHub reports the issue closed. Both required; either alone is not enough (archive can exist while the issue reopened; closed-without-archive means ship never ran its teardown — that's #247 foreground territory).
- **gh budget rule:** gh is called ONLY for entries that are already "ship-shaped" (archived plan present, not frozen, not in history). Normal in-flight passes make ZERO gh calls — the Stop hook stays fast.
- **Injectable fetcher:** the gh call must be injectable for tests AND for --print: `reconcile(tikiPath, { fetchIssueState })` / `buildReport(state, tikiPath, { fetchIssueState })`; default impl spawns `gh issue view N --json state` via spawnSync with `shell: process.platform === "win32"` (PATHEXT) and a hard timeout (5s); ANY failure (no gh, offline, non-zero, parse error, timeout) → returns null → no change (degrade silently, rule 6).
- **History append from the reconciler:** state.mjs does not export its append-history internals; the reconciler implements the same idempotent shape (filter prior record for N, unshift `{number, title, completedAt, parentRelease?}`). Title source: entry.issue.title.
- **Ship-derivation actions** mirror the existing history path: standalone → append history + delete entry; release child (parentRelease) → append history + applyTransition to completed/SHIP (legal from executing AND shipping ✓).
- **Release reconciliation scope (kept tight):** (a) version in `history.recentReleases` → delete `release:*` entry; (b) NOT in history but def archived at `.tiki/releases/archive/<version>.json` → append release history record `{version, issues (from archived def), completedAt, tag: version}` + delete entry; (c) in-flight releases left untouched (no progress healing this issue — advance-only semantics for release progress deferred). FROZEN_STATUSES applies to releases too.
- **buildReport gains release rows** (currently `continue`s on non-issue keys): recorded triple as-is; derived = teardown verdict when (a)/(b) applies, else recorded (in-sync). Plus ship-derivation rows for issues need the fetcher; --print accepts the same injection and tolerates fetcher absence (rows then show "gh unavailable" note rather than fabricating drift).
- **Version key normalization:** state key is `release:<version>`; def files live at `releases/<version>.json` with or without `v` prefix historically — check both (mirror check-release-readiness.mjs which accepts both).

## 2026-06-13 findings (#272 REVIEW decisions — intent journal)

- **No new script file.** Journal helpers live INSIDE state.mjs (exported: `appendJournalEntry`, `readJournalEntries`, `journalFloor`, `pruneJournal`) plus a `state.mjs journal` CLI subcommand — command bodies gain no new path dependency (#268 class), and the bootstrap/plugin-layout tests need no script-list changes.
- **Entry shape:** one JSON line `{ts, workId, step, event, phase?, title?}`. `event` = "start" (only event v1 — "complete" reserved). GET passes `--title` so journal-qualified bootstrap can create entries with a real title pre-plan.
- **Append = O_APPEND single-line write, NO lock** (fs.appendFileSync; atomic enough for sub-PIPE_BUF lines; a torn line is tolerated by the defensive reader — skip unparseable lines). Append must NEVER fail the command: wrap, warn to stderr, exit 0 from the subcommand.
- **Reconciler consumption order (binding):** frozen → history → ship-derivation (#271) → advance to MAX(artifact target, journal floor) by STEP_ORDER, legality-pre-guarded, advance-only. Journal floor status mapping: GET→pending, REVIEW→reviewing, PLAN→planning, AUDIT→planning, EXECUTE→executing (phase from artifact only), SHIP→shipping. Journal NEVER overrides frozen/history/ship-derivation.
- **Journal-qualified bootstrap:** a journal entry for issue:N within the same 14-day recency window qualifies bootstrap even with NO plan file (covers dropped GET/REVIEW — previously impossible). Guards 1-3 from #270 still apply (existing entry / history / archived plan); title from the newest journal entry's `title` ?? `Issue N`.
- **Pruning:** inside the locked pass only; rewrite journal atomically WITHOUT entries whose issue number is in history.recentIssues (or release version in recentReleases), only when the file has > 50 prunable-or-total threshold lines (avoid churn). Accepted risk (documented): an append racing the rewrite can lose that one line = degraded to pre-#272 behavior, never corruption (reader skips torn lines).
- **--print:** journal-derived floors appear as normal drift rows with note "journal floor: <STEP>"; journal-qualified bootstrap candidates show "would create (journal #272)".
- **Coverage guard:** command-transition-coverage.test.mjs extended — every workflow command file must contain a `state.mjs journal` invocation; yolo/release must journal once per step they orchestrate (static presence per required step, mirroring the transition-pair checks).
- **SC5 e2e:** fixture pipeline writing ONLY journal lines + artifacts (zero transitions, zero history) must reconcile to the same state.json as the imperative path (extends the #248 DROP-RESILIENCE family; now includes GET/REVIEW distinguishability, which artifacts alone cannot provide).

## Test conventions (`__tests__/reconcile-state.test.mjs`)
- Imports `reconcile`/`buildReport` directly (ESM import, no spawn) + fixture `.tiki` trees in tmp dirs; 16 existing scenarios incl. TRAP tests (frozen, stale-plan-not-resurrected — that one currently asserts NO entry creation for an issue NOT in activeWork **with the issue in history**... verify exact fixture before changing semantics; #270 must keep the not-in-history+archived-plan resurrection guard intact and re-pin the TRAP test for the new rule: archived plan → never bootstrap, history member → never bootstrap).

## Plan-file facts relevant to bootstrap — QUANTIFIED (2026-06-13, #270 review)
- Active plan: `.tiki/plans/issue-N.json`; archived: `.tiki/plans/archive/issue-N.json` (ship.md moves it). `plan.issue` = {number, title, url}.
- `history.recentIssues` is NOT capped in state.mjs append-history (unshift, no slice) — but it only exists since the reconciler era: in the dogfood repo it covers 52 issues (#149+).
- **Live count: ~120 stale ACTIVE plan files** for long-shipped issues (issue-18 … issue-148 era) that are NOT in history and NOT archived. The issue-as-filed 3-condition rule (active plan + no entry + not in history) would resurrect ~70 of them on first pass — the exact #245 flood.
- **Decided guard set for bootstrap (4 conditions + recency):**
  1. active plan exists; 2. no `issue:N` in activeWork; 3. N not in `history.recentIssues`; 4. NO `.tiki/plans/archive/issue-N.json` (archive presence = shipped, even if history predates it); 5. plan is RECENT — max(createdAt, updatedAt, auditedAt) within a 14-day window. Freshness uses plan JSON timestamps, NOT file mtime (git checkout/clone resets mtime → a fresh clone would flood again).
  - Rationale: the bootstrap exists to heal drops happening NOW (plugin-dead installs, dropped GET); any legit case has a recently written plan. A weeks-stale dropped entry is an accepted miss (the #272 journal becomes the definitive signal later).
- Live-fire acceptance check: after implementing, `reconcile-state.mjs --print` on THIS repo must show zero "would create" rows.
