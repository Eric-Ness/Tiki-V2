---
topic: reconciler-contract
tags: [reconciler, state, framework, hooks]
issues: [270]
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
