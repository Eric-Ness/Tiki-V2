---
topic: dependency-graph-plan-data
tags: [desktop, dependency-graph, watcher, react, zustand]
issues: [256, 257]
created: 2026-05-24T18:02:00.000Z
---

# Dependency graph: plan-data plumbing constraints

Constraints discovered while planning #256 (durable phase progress on nodes). These
also govern #257 (click-node success-criteria panel), since both features consume the
same currently-discarded plan data.

## The graph already fetches the plan, then throws most of it away
`apps/desktop/src/components/dependencies/useDependencyGraph.ts` invokes `get_plan`
for every release issue (~line 107) but types the result `{ phases?: unknown[] } | null`
and keeps only `plan.phases.length` (as `phaseCount`, used solely for `computeNodeHeight`).
Per-phase `status`, `successCriteria`, and `coverageMatrix` are all discarded. Widening
what `FetchedIssue` retains is the shared foundation for both #256 and #257 — do it once
(in #256) and #257 becomes pure UI.

## The `planChanged` file-watch event is dead code on the frontend
The Rust watcher (`apps/desktop/src-tauri/src/watcher.rs`) emits
`TikiFileEvent::PlanChanged { issue_number }` (serialized camelCase:
`{ type: "planChanged", issueNumber }`) when `.tiki/plans/issue-N.json` changes. The
frontend `FileEvent` union in `apps/desktop/src/hooks/useTikiFileSync.ts` *declares*
`"planChanged"` and `issueNumber?`, but the listener only branches on
`stateChanged` / `releaseChanged` / `researchChanged` — `planChanged` falls through and
is silently dropped. Any plan-derived UI needs this branch added or it will never tick
live (the detail panel gets away with it today only because EXECUTE also writes
`state.json`, so `stateChanged` arrives alongside and re-fetches the plan).

## Two phase-truth sources: ephemeral vs durable
- `activeWork[issue:N].phase` (in `state.json`) is LIVE but **deleted on completion** —
  confirmed in both `packages/framework/scripts/state.mjs` and
  `apps/desktop/src-tauri/src/state_transition.rs`. Absent for pending/paused/shipped issues.
- `plan.phases[].status` (in `issue-N.json`) is DURABLE for every phase forever.
Derive the node's `N/M` from the plan; let live `activeWork.phase` override only while
`status === 'executing'`. This is what makes the indicator meaningful for the whole graph,
not just the one active issue.

## Dep-array infinite-loop trap in useDependencyGraph
The main fetch effect's deps are `[release, activeProject?.path]` and it `setFetchedIssues`
inside itself. Do NOT add `fetchedIssues` to those deps to get live updates — it loops.
Use a separate effect keyed on a per-issue plan nonce (`tikiStateStore.planNonces`) that
re-reads only the changed plan via `get_plan` and patches that single entry, leaving the
cached GitHub issue details untouched (avoids N+1 GitHub calls on every phase write).

## Hand-mirrored node-height functions must stay in sync
`computeNodeHeight()` in `useDependencyGraph.ts` and `nodeHeightFor()` in `IssueNode.tsx`
are literal twins consumed by dagre's layout. If a UI change (e.g. a textual `N/M` label)
increases node height, BOTH must change identically or dagre allocates the old height and
nodes overlap. Keeping new chrome within the existing height envelope avoids touching both.

## Fresh-ref selector rule (React 19 render-loop class, #210/#212)
Any new Zustand selector (e.g. reading `planNonces`) must select a stable reference —
the whole map object or a primitive — never an inline `?? {}` / `?? []` fallback, which
allocates fresh each call and trips `useSyncExternalStore` into a render loop. Seed
`planNonces` to a single stable `{}` in the store's `initialState`.

## Plans are not archived with releases
`get_plan` resolves `.tiki/plans/issue-{n}.json` only; shipping a release archives the
release JSON but leaves plan files in place. So `get_plan` on a shipped issue returns the
final plan (all phases `completed`) → durable `N/N` works with no special-casing.
