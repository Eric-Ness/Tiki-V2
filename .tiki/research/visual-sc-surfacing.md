---
topic: visual-sc-surfacing
tags: [success-criteria, doctor, gate, observability]
issues: [281]
created: 2026-06-13T21:00:00Z
---

# Surfacing unverified visual success criteria (#281)

REVIEW design, verified vs code 2026-06-13.

## The data
Archived plans (`.tiki/plans/archive/issue-N.json`) carry `successCriteria[]` each with `{id, category?, description, verified?, verifiedAt?}`. EXECUTE marks automated SCs `verified:true` via `plan.mjs verify-criteria` (coverage-matrix rule, #275); visual/manual SCs can't be auto-verified so they ship `verified:false`. Live count right now: 4 archived plans hold 6 such unverified SCs (the v0.9.1 #263 SC4 / #264 SC3+SC5 and v0.9.2 #266 SC2/SC3 — user-confirmed-good but never flipped in the archived plan). Good fixtures + live validation set.

## The canonical "is this a visual/manual SC" heuristic (replicate in BOTH Rust and Node)
A success criterion is surfaced as *pending visual verification* iff `verified === false` AND it is plausibly visual/manual:
- its `category` (lowercased) is one of: `visual`, `manual`, `ux`, `ui`; OR
- its `description` matches (case-insensitive) any of these stems:
  `render`, `display`, `look`, `visual`, `blink`, `flicker`, `frame`/`fram`(ing), `snappy`/`snappier`, `animat`, `button`, `panel`, `badge`, `color`/`colour`, `icon`, `layout`, `screen`, `pixel`, `scroll`, `hover`, `theme`, `css`, `styl`, `tauri:dev`, `eyes`.
  Regex (JS): `/\b(render|display|look|visual|blink|flicker|fram(e|ing)|snapp|animat|button|panel|badge|colou?r|icon|layout|screen|pixel|scroll|hover|theme|css|styl|tauri:dev|eyes)/i`
  Rust: same alternation, lowercase the description and substring/regex-match (the `regex` crate is already a dep? if not, a lowercase `.contains()` over the stem list is fine and dependency-free).
This is intentionally a *heuristic* — it should flag the genuine visual SCs and avoid most automated ones; over-flagging an automated SC is a minor annoyance (it's an info checklist, never a blocker). Document the heuristic at each site and keep the term list identical.

## Three surfaces

1. **Rust `tiki_doctor`** (durable desktop checklist — the main deliverable): scan `.tiki/plans/archive/issue-*.json`; collect `{issue, id, description}` for each unverified+visual SC. Add `unverified_shipped_criteria: Vec<UnverifiedCriterion>` to `DiagnosticsReport` (state.rs:639; `#[serde(default)]`, camelCase `unverifiedShippedCriteria`). Populate in `tiki_doctor` (commands.rs). cargo test on a fixture archive + assert the field serializes (the #259 round-trip is now generally guarded by #278, but assert keys here too).

2. **Desktop surface** (deps on 1): mirror the field in `diagnosticsSummary.ts` `DiagnosticsReport`; add an INFO finding (never flips status to warnings — it's a checklist) like `N shipped visual criteria await verification` when the list is non-empty. `DiagnosticsPanel.tsx` renders the pending list (issue + id + short description). vitest for the summary. Reuse the #276 actionable-finding pattern (could make each entry link to the issue, optional).

3. **`check-release-readiness.mjs`** (pre-release nudge, repo-root scripts/): for each release issue, read its archived plan, and if any unverified visual SC exists, push a SOFT warning (existing `warnings[]` channel — informational, never changes exit code; matches #276's convention) naming `#issue SCx: <desc>`. Framework test in check-release-readiness.test.mjs.

## Notes
- check-release-readiness.mjs is repo-root `scripts/`, NOT dogfood-copied (confirmed in #276) → no install.js regen for phase 3.
- DiagnosticsReport already mirrored in diagnosticsSummary.ts (documented mirror) — keep them in sync (field-name drift = silent undefined).
- Keep the gate SOFT: pending visual SCs are a checklist, never block a release (the user verifies in tauri:dev/installer).
