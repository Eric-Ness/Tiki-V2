# `apps/desktop/src-tauri/tests/`

Integration tests for the Tauri Rust backend. These run alongside `cargo test`
and execute as a separate test binary from the in-crate `#[cfg(test)]` modules.

## What lives here

| File | Purpose |
|------|---------|
| `state_format_compat.rs` | Pins the legacy state-format compatibility shims in `src/state.rs`. Loads every JSON fixture under `fixtures/`, deserializes through `TikiState`, re-serializes, re-parses, and asserts canonical fields. |
| `fixtures/` | One JSON file per historical or current shape of `.tiki/state.json`. |

## Why these tests exist

`src/state.rs` carries half a dozen format-compatibility shims:

- `RawIssueContext` — accepts both nested `issue` objects and legacy flat
  `issueNumber` + `title` fields.
- `RawOldPhases` — accepts the old `phases: { total, completed, current: {...} }`
  object form.
- `RawPhaseArrayItem` — accepts the #66 array form
  `phases: [{ id, title, status }]`.
- `deserialize_lenient_phase` / `deserialize_lenient_phases` — leniently parse
  whatever shape happens to be on disk without erroring out on missing fields.
- The custom `Deserialize for IssueContext` impl — normalizes all of the above
  into the canonical struct shape.

These shims exist because the on-disk format has drifted over time. Without
tests pinning their behavior, a "harmless refactor" can silently break loading
of older state files. The fixtures here lock down each shim by exercising the
exact shape it absorbs.

## Fixture inventory

| Fixture | Exercises |
|---------|-----------|
| `legacy-flat.json` | `issueNumber` + `title` at top level, `startedAt` instead of `createdAt`. Pins the `raw.issue_number` / `raw.title` / `raw.started_at` fallback paths. |
| `legacy-phases-object.json` | `phases: { total, completed, current: { number, status } }`. Pins `RawOldPhases` + `RawOldCurrentPhase`. |
| `legacy-phases-array.json` | `phases: [{ id, title, status }]` plus flat `currentPhase` + `totalPhases`. Pins `RawPhaseArrayItem` + the derivation logic for `current` and `total`. |
| `canonical-current.json` | Current schema: nested `issue` object, flat `PhaseProgress`, `history` block. Round-trip should be lossless. |
| `with-parallel-execution.json` | Canonical + `parallelExecution: { phases, completedInGroup, totalInGroup, startedAt }`. Pins the parallel-group field. |
| `with-parent-release.json` | Canonical issue with `parentRelease: "v0.3.0"` + a parent `release:vX.Y.Z` entry. Pins the release-grouping field. |

## Running the tests

```bash
# From repo root
pnpm test:rust

# Or directly with cargo
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# Run only the format-compat suite
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test state_format_compat
```

## Adding a new fixture (recipe)

When you change `state.rs` in a way that introduces a new on-disk shape — or
when you fix a bug that depends on absorbing a previously-unseen legacy shape
— add a fixture so the new behavior is pinned:

1. **Decide what the fixture is exercising.** Is it a new canonical field?
   A new legacy form to absorb? Make the name self-explanatory:
   `canonical-<feature>.json` for new canonical shapes, `legacy-<name>.json`
   for old shapes you're committing to support.

2. **Build the JSON file** under `apps/desktop/src-tauri/tests/fixtures/`.
   It must be a complete, valid `TikiState` — i.e. it starts at
   `{ "schemaVersion": 1, "activeWork": { ... } }` and is parseable by
   `serde_json::from_str::<TikiState>`.

3. **Register the fixture** in the `FIXTURES` array in
   `state_format_compat.rs::every_fixture_round_trips_without_panic`. Forgetting
   this step means the new fixture is silently untested.

4. **Add a focused `#[test] fn`** in `state_format_compat.rs` that loads the
   fixture via `round_trip(...)` and asserts the specific canonical fields
   your fixture exists to pin. Don't repeat assertions already covered by
   another test.

5. **Run `cargo test --test state_format_compat`** and verify everything
   passes.

6. **Commit the fixture and the test together** so reviewers can see the
   contract you're pinning.

## Test isolation

These integration tests load fixtures via `std::fs::read_to_string` rooted at
`env!("CARGO_MANIFEST_DIR")/tests/fixtures/`. They do not touch any real
`.tiki/state.json`, write to disk, or invoke Tauri commands. Adding new tests
that mutate the filesystem is discouraged — keep state-mutation testing in the
in-crate `state_transition::tests` module.
