---
topic: state-transition-ipc
tags: [tauri, ipc, state-machine, rust]
issues: [144]
created: 2026-05-11T01:00:00.000Z
---

# State Transition IPC

## Context

Tiki currently uses prose-based contracts in framework command files to instruct
Claude to mutate `.tiki/state.json` directly. This is fragile because:

1. Each pipeline step (GET/REVIEW/PLAN/AUDIT/EXECUTE/SHIP) duplicates the schema in prose.
2. When the prose drifts from the Rust struct shape, the desktop app desyncs.
3. `apps/desktop/src-tauri/src/state.rs` carries 6+ legacy serde shims
   (`RawIssueContext`, `RawOldPhases`, `deserialize_lenient_phase`, etc.) to
   absorb the resulting format drift.

## Solution Shape

Issue #144 calls for:

- A typed Tauri IPC command `state_transition(work_id, to_status, to_step, phase, parallel_execution, parent_release, tiki_path) -> Result<TikiState, String>`.
- A Node CLI shim at `packages/framework/scripts/state.mjs` invokable from bash that exposes the same logic — Claude Code only has Bash, not direct Tauri IPC.
- A legal-transition graph in Rust (testable).

## Existing Infrastructure

- `apps/desktop/src-tauri/src/fs_utils.rs::atomic_write` — `path.json.tmp` then rename. Use this.
- `apps/desktop/src-tauri/src/fs_utils.rs::read_json_resilient` — retries on parse failures. Use this for reads.
- `apps/desktop/src-tauri/src/state.rs` — `TikiState`, `IssueContext`, `ReleaseContext`, `WorkStatus`, `PipelineStep`, `PhaseProgress`, `ParallelExecution` types already exist.
- `apps/desktop/src-tauri/src/commands.rs::update_work_status` — existing precedent for state mutations via IPC.

## State Machine (canonical)

Per `docs/DESIGN.md` and observed prose:

```
Issue lifecycle:
  pending → reviewing → planning → executing → shipping → completed
                ↘         ↘         ↘
                 failed   failed   failed
                                      ↓
                                   (recoverable: back to executing)
   paused: anywhere → paused → previous status

PipelineStep parallels:
  GET → REVIEW → PLAN → AUDIT → EXECUTE → SHIP
```

Legal transitions (from → to):

| from        | to (status)                                          |
|-------------|------------------------------------------------------|
| pending     | reviewing, planning, executing, paused, failed       |
| reviewing   | planning, paused, failed                             |
| planning    | planning (audit cycle), executing, paused, failed    |
| executing   | executing (parallel/sequence), shipping, paused, failed |
| shipping    | completed, failed                                    |
| paused      | pending, reviewing, planning, executing, shipping    |
| failed      | pending, executing (retry), shipping (force ship)    |
| completed   | (terminal)                                           |

Releases follow the same shape with their own pipelineStep.

## Backward Compatibility Constraint (CRITICAL)

The CLI shim is **additive** for the first release. Old framework command
prose must continue to work — the new shim wraps the same JSON shape.

Specifically:
- The shim writes state.json using the **same Rust-compatible JSON shape** the prose currently produces.
- Old framework versions (those that still describe JSON directly) keep working because the shape doesn't change.
- New framework versions call the shim, which is simply a convenience that prevents drift.
- The legacy serde shims in `state.rs` stay — they're issue #145's concern, deliberately out of scope.

## Recursion Risk

Issue #144 rewrites `release.md`, `yolo.md`, `execute.md`, `ship.md` — the very
files driving the pipeline that's executing this issue AND will execute #145
and #146 next. The new prose **must keep the old behavior working** to avoid
breaking the in-flight v0.3.0 release.

Mitigation: the new prose phrases each state update as:

> Either: (A) call the shim [recommended], OR (B) write the JSON directly [legacy]

Both paths produce identical state.json content.

## Test Strategy

Rust unit tests (in `state_transition.rs` next to the new code):

1. Legal transitions accepted — pending→reviewing, reviewing→planning, etc.
2. Illegal transitions rejected — completed→executing, completed→pending, etc.
3. parentRelease preservation — when an issue ships and parentRelease is set,
   the entry stays in activeWork with status="completed" rather than being removed.
4. Round-trip — write a transition, read state, verify shape matches.

Node shim tests are nice-to-have but not blocking — the heavy lifting is in
the Rust code path. The shim is small (~150 LOC) and can be smoke-tested
manually.
