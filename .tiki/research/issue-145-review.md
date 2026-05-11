# Issue #145 — Review

**Title:** Add automated test suite — start with state.rs deserialization fixtures and store reducers

**Status:** OPEN, label `enhancement`, part of release v0.3.0.

## Problem Summary

Tiki V2 has no automated tests across any of its three packages. The Rust `state.rs` file in particular carries 6+ format-compatibility shims that exist because state file formats have drifted over time — and they are invisible-fragile without tests. The `pnpm build` step uses `tsc -b` (stricter than `tsc --noEmit`) but there is no CI to catch failures on PR. The framework's `<test-integration>` block in `execute.md` auto-detects test commands but the repo has nothing for it to find.

## Three Independent Phases

The issue lays out three parallel, independently shippable test investments. They touch completely different file trees:

### Phase A — Rust state-deserialization fixtures (highest ROI)

Build a "format zoo" under `apps/desktop/src-tauri/tests/fixtures/` with at least 6 JSON files representing every historical and current state shape:
- `legacy-flat.json` (issueNumber + title at top level — exercises `raw.issue_number` + `raw.title` fallback)
- `legacy-phases-object.json` (RawOldPhases form: phases:{total,completed,current:{number,...}})
- `legacy-phases-array.json` (#66 style array of `{id,title,status}` items, with possibly flat currentPhase/totalPhases)
- `canonical-current.json` (current schema: nested issue object, flat PhaseProgress)
- `with-parallel-execution.json` (canonical + `parallelExecution` field set)
- `with-parent-release.json` (canonical + `parentRelease` field set — used by release-grouped issues)

Then a `state_format_compat.rs` integration test under `apps/desktop/src-tauri/tests/` that loads each fixture, round-trips through `TikiState` deserialize -> serialize, and asserts the canonical fields are present (number, status, phase total, etc).

**Goal: pin the existing shims so future cleanup is safe.** Do NOT modify any shim — just lock down behavior.

### Phase B — Vitest for Zustand stores

Add vitest to `apps/desktop/`. Test the non-trivial reducers first:
- `terminalStore.ts` split-tree helpers — `replaceInTree`, `removeFromTree`, `regenerateLeafIds`. **These are module-private**, so we need to export them (or pull them into a new helper module). The latter is cleaner.
- `tikiStateStore.ts` — `getIssueWorkStatus` against fixture activeWork maps.
- `commandPaletteStore.ts` — `fuzzyMatch` + `filterAndSortActions` (already exported).
- KanbanBoard `getExecuteCommand` — currently a closure inside the component (KanbanBoard.tsx:96-109). Extract to a pure helper module so it can be imported and tested.

Total: at least 15 passing tests.

### Phase C — PR CI workflow

New file `.github/workflows/pr.yml` on `pull_request`:
- `pnpm install --frozen-lockfile`
- `pnpm typecheck && pnpm build` (catches the tsc -b strict cases)
- `pnpm -C apps/desktop test` (vitest)
- `cargo test` and `cargo clippy --deny warnings` against `apps/desktop/src-tauri/`

Existing `release.yml` is on tag-push only and has a heavy 4-platform matrix — `pr.yml` should be a single lightweight ubuntu-22.04 runner.

## Plus

- `pnpm test` works from repo root and runs TS + Rust suites.
- README "Running tests" section.
- `apps/desktop/src-tauri/tests/README.md` documenting how to add a new fixture.

## Success Criteria

- SC1: >=6 fixture files + integration test passing under `cargo test`
- SC2: Vitest configured for apps/desktop with >=15 passing tests across listed stores
- SC3: `.github/workflows/pr.yml` runs typecheck + build + cargo test + vitest on every PR
- SC4: `pnpm test` works from repo root
- SC5: README updated with "Running tests" section

## Codebase Touchpoints (verified)

- `apps/desktop/src-tauri/src/state.rs` — 610 lines, all the shims live here. State module that we're testing. Do not modify.
- `apps/desktop/src-tauri/src/state_transition.rs` — 584 lines, contains the existing test pattern (10 tests pass already). Use this as the structural reference for `state_format_compat.rs` (especially `#[cfg(test)] mod tests` block). However, our new file is an **integration test** under `tests/`, not a unit test inside `src/`, so it must use `tiki_desktop_lib::state::*` paths and load fixtures from disk.
- `apps/desktop/src/stores/terminalStore.ts` — split-tree helpers are module-private. Extract to a separate file `splitTree.ts` and re-import.
- `apps/desktop/src/stores/tikiStateStore.ts` — `getIssueWorkStatus` is on the store. Testable via `useTikiStateStore.getState().getIssueWorkStatus(N)` after calling `setActiveWork({...})`.
- `apps/desktop/src/stores/commandPaletteStore.ts` — `fuzzyMatch` and `filterAndSortActions` are already exported. Direct import + call.
- `apps/desktop/src/components/kanban/KanbanBoard.tsx:96-109` — closure. Extract to `apps/desktop/src/components/kanban/executeCommand.ts`.

## Parallelism Plan

Phase A (Rust), Phase B (vitest), and Phase C (CI) touch disjoint file sets:
- A: only `apps/desktop/src-tauri/tests/`, `apps/desktop/src-tauri/Cargo.toml` (maybe)
- B: `apps/desktop/package.json`, `apps/desktop/vitest.config.ts`, `apps/desktop/src/stores/__tests__/`, `apps/desktop/src/components/kanban/executeCommand.ts` + refactor of `KanbanBoard.tsx`, refactor of `terminalStore.ts` (extract splitTree)
- C: `.github/workflows/pr.yml`, root `package.json` (add `test` script)

A and B touch zero overlap. C depends on A and B existing (it runs their tests). Best executed: A and B in parallel (Phase A1 + Phase B1), then C (Phase B2 or call it Phase 2). Docs (README, tests/README.md) can go in the C group since they're independent of code.

## Risks / Gotchas

- **vitest in monorepo:** vitest needs to be added to `apps/desktop` not root. We must not pull in jsdom unless we test DOM — for pure store reducers we can use the default `node` environment, which is faster.
- **terminalStore Zustand store uses `persist` middleware** which calls `localStorage` — that will explode under node environment. Solution: extract the helpers (`replaceInTree`, `removeFromTree`, `regenerateLeafIds`, `getTerminalIds`) into a separate file that doesn't touch zustand at all, and test those directly. The store itself can be re-exported but we won't instantiate it for tests.
- **tikiStateStore uses `import type { WorkContext } from '../components/work'`** which transitively pulls React/TSX. We may need to mock or use vitest's default which is node + TS but no DOM — TSX imports should be fine since vite handles them, but a type-only import is erased at compile time anyway.
- **chrono in Rust:** not actually a dep of Tauri tests — fixtures are JSON loaded from disk, no time arithmetic needed.
- **cargo workspace:** Cargo.toml shows no `[dev-dependencies]` — we may need to add one for any test-only crates. For now, just `serde_json` is enough and it's already a runtime dep so it's available in tests automatically.
- **`pnpm test` from root:** `pnpm -r test` runs `test` script in every package. We need a `test` script in `apps/desktop` (vitest run) but also a way to run `cargo test`. Cleanest: root `package.json` adds `"test": "pnpm -r --if-present test && pnpm -C apps/desktop tauri-test"` or similar. Even simpler: `"test": "pnpm -r --if-present test && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml"`.

## Recursive Detection

Per the prompt: the framework's `<test-integration>` block detects tests AS we build them. So our audit step might find tests it didn't have before. That's expected — we wrote them. They should pass.
