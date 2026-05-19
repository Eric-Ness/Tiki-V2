---
topic: worktree-cwd-state-leakage
tags: [shim, watcher, worktree, release, yolo]
issues: [211]
created: 2026-05-18T20:55:00Z
---

# Worktree CWD state leakage

The state shim and the watcher disagree about where `.tiki/state.json` lives once sub-agent dispatch enters a git worktree. This causes pipeline transitions from sub-agents to be written to a state.json the desktop app never sees.

## The two anchors

| Component | How it resolves the `.tiki/` path |
|---|---|
| `packages/framework/scripts/state.mjs:155-158` | `process.cwd() + "/.tiki"` (unless `--tiki-path` is passed) |
| `apps/desktop/src-tauri/src/watcher.rs:64` | `std::env::current_dir() + "/.tiki"` at startup, OR `switch_watch_path(new_path)` |

They are designed to agree when the framework runs in the same CWD the desktop app launched from. They are guaranteed to disagree when:

1. **A sub-agent is dispatched with `isolation: "worktree"`** — its process CWD is the worktree root, not the main repo.
2. **The desktop app's watcher was switched** to a different project path than the shell that's running `/tiki:*` commands.

## Why this surfaces in `/tiki:release` cascades but not foreground commands

`packages/framework/commands/release.md:52-63` spawns parallel Agents for each issue in a release wave:

```
- description: Run /tiki:yolo {N}
- subagent_type: general-purpose
- isolation: worktree
- prompt: Run the /tiki:yolo {N} skill in this worktree.
```

Each Agent runs `/tiki:yolo` whose subcommands invoke `state.mjs transition` with no `--tiki-path`. The shim writes to `<worktree>/.tiki/state.json`. The main repo's `.tiki/state.json` (the one the desktop watcher observes) is **not touched** for the entire duration of that issue's pipeline.

The wave-merge step (release.md:62) merges the worktree's code branch back via `git merge --no-ff` but does **not** merge state.json. After the wave, `release.md` writes its OWN transitions in the main repo (status updates, completedIssues additions). To an observer watching the Kanban, the issue appears stuck in its starting column for the entire YOLO run and then "jumps" to Completed when release.md writes its post-wave update.

This explains the v0.6.4 cascade (#206) symptom precisely.

## Why direct `/tiki:yolo` (no release wrapper) may also miss transitions

`packages/framework/commands/yolo.md:115-167` contains a `<state-management>` block that describes the GET → REVIEW → PLAN → AUDIT → EXECUTE → SHIP transition table — but the actual `state.mjs transition` shell example appears **only once** (a generic placeholder, lines 134-138). There is no per-step "**run this command before dispatching step X**" directive.

The companion `<sub-agent-strategy>` block (lines 59-79) says "Run as sub-agent (fresh context): REVIEW, PLAN, EXECUTE, SHIP" but does not specify the dispatch mechanism. The model has two reasonable interpretations:

- **Invoke the step's slash command via Skill** — e.g., `Skill("tiki:review", "{N}")`. The skill prompt loads review.md, which contains its own `state.mjs transition` call. Transitions land correctly.
- **Spawn an Agent with a hand-crafted prompt** — e.g., `Agent({ subagent_type: "general-purpose", prompt: "Review issue #N..." })`. The custom prompt does not include state.mjs calls. Transitions are dropped.

Both interpretations are consistent with yolo.md's prose. Which one the model picks is non-deterministic across runs, which matches the issue's claim that the bug appeared "on the last couple of executions" rather than continuously.

## What the watcher actually receives

`watcher.rs:200-256` emits `TikiFileEvent::StateChanged` for any non-`.tmp` write to a `state.json` inside the watched tree. The shim's atomic-write pattern (`writeStateAtomic` at `state.mjs:178-197`) writes `state.json.tmp` then renames it — the rename event is what the watcher sees. There is **no debounce bug** here (the leading-edge 50ms debounce at `watcher.rs:128-129` correctly coalesces the 3-5 raw events from a single rename burst per key, but does not drop logically distinct writes).

The watcher itself is healthy. The problem is that the writes are going to a different `.tiki/`.

## Fix surface

A clean fix needs:

1. **Make the shim path explicit when CWD is ambiguous.** Either:
   - Pass `--tiki-path "<main-repo>/.tiki"` in every state.mjs call inside worktree sub-agent prompts, OR
   - Have the shim walk upward looking for the nearest `.tiki/` that has a `state.json` (with worktree detection as a hint), OR
   - Have release.md's wave dispatch NOT use worktree isolation for the state-write portion (write transitions from the parent, run only the *code work* in worktrees).
2. **Tighten yolo.md's sub-agent dispatch prose** so the model can't drop intermediate transitions. Either explicitly say "invoke /tiki:{step} via Skill so its state transition runs" OR include literal `state.mjs transition` calls in the sub-agent prompts that yolo.md emits.
3. **Add a regression assertion** so future edits can't silently drop the transition calls. Candidates:
   - A grep-based CI check that every command file in `packages/framework/commands/` referenced by yolo.md contains its expected `state.mjs transition` call.
   - A bash repro test (run /tiki:get then /tiki:review against a fixture; assert state.json mtime advanced and `pipelineStep` is REVIEW).

## Diagnostic artifacts (this session)

- Foreground `state.mjs transition issue:211 ... --to-step GET` from main repo root: state.json mtime advanced from `2026-05-15 14:30:06` → `2026-05-18 16:53:10`. Confirmed the shim works.
- Direct JSON merge for richer GitHub metadata (body, labels, url, createdAt, updatedAt): wrote successfully.
- Second transition (`--to-step REVIEW`): mtime advanced to `16:55:06`. Preserved the merged metadata (shim does field-level merge, not full-entry replace).

So: hypothesis #2 (silent shim failure) is ruled out for foreground bash. Hypothesis #4 (frontend re-render bypass) is ruled out post-v0.6.5 (#210). Hypothesis #5 (end-of-cascade overwrite) is unnecessary to invoke — #3 alone explains the observation. #1 is a secondary contributor for direct yolo runs.

Related: [[framework-cli-shim]], [[state-transition-ipc]].

## 2026-05-18 verification (post-fix)

The three structural fixes for #211 landed in this session and were verified as follows:

**Phase 1 — shim worktree resolution.** `resolveTikiPath()` lifted to module scope in `packages/framework/scripts/state.mjs`. Walks upward from CWD, parses `.git` file pointers (both backslash and POSIX-style `/worktrees/<name>` segments), strips back to the main repo root. Falls through to `<cwd>/.tiki` when no `.git` ancestor exists. Emits `state.mjs: resolved tikiPath from worktree to <path>` on stderr when the resolved path differs from the naive one. 9 `node:test` cases at `packages/framework/__tests__/state.test.mjs` cover normal repo, deep nested CWD, worktree (both separator styles), `--tiki-path` override, non-repo fallback, plus 3 integration tests that spawn the shim with `cwd:` set to a synthetic worktree and assert state.json lands in the main repo. All pass (653ms cold).

Foreground bash before-and-after (this session, against the live repo):
- `state.json` mtime was frozen at 2026-05-15 14:30:06 (v0.6.4 finalize) for 3 days.
- First foreground `state.mjs transition issue:211 --to-step GET` advanced mtime to 2026-05-18 16:53:10.
- Subsequent transitions through REVIEW → PLAN → AUDIT → EXECUTE → SHIP each bumped mtime again and preserved merged GitHub metadata via field-level merge (shim does not full-entry-replace).

This confirms the foreground happy path was already working — the failure mode was strictly the worktree-CWD divergence under sub-agent dispatch from `/tiki:release`.

**Phase 2 — yolo.md prose tightening.** Replaced the single generic shim example in `<state-management>` of both `packages/framework/commands/yolo.md` and `.claude/commands/tiki/yolo.md` with 6 labeled copy-pasteable bash blocks (one per pipeline step). Added a `CRITICAL: Sub-agent dispatch must not drop pipeline transitions` subsection in `<sub-agent-strategy>` documenting Pattern A (Skill invocation — preferred, transition stays co-located with the step that owns it) and Pattern B (parent emits the shim call before+after a raw Agent/Task dispatch). Both files' `<state-management>` blocks are character-identical (md5 `438836f6...`). The vestigial `packages/framework/.claude/commands/tiki/yolo.md` was left untouched per the plan's explicit guard.

**Phase 3 — regression assertion.** Added `packages/framework/__tests__/command-transition-coverage.test.mjs` (97 lines). Pairs each `state.mjs transition` call with its `--to-step` value via a non-greedy 200-char-window regex so a stranded `--to-step EXECUTE` in prose or a table cannot satisfy the assertion when the actual shim call has been removed. `EXPECTED_STEPS` table maps file basename → required steps; adding a new pipeline step is a one-line change. Tested the negative case: deliberately replaced `--to-step EXECUTE` with `--to-step BOGUS` in yolo.md, re-ran, observed:
```
yolo.md: missing 'state.mjs transition ... --to-step EXECUTE' pairing
  (found steps: [AUDIT, BOGUS, GET, PLAN, REVIEW, SHIP], transition calls: 9)
```
— exactly the precise failure message the verification criterion required. Restored immediately.

**Phase 4 — observational live-Kanban test (deferred).** The full live `pnpm tauri:dev` + `/tiki:yolo` against a throwaway issue + 2-issue release fixture was deferred per the lightweight Phase 4 strategy. Rationale: foreground transitions are already proven, and the Phase 3 regression test is the durable guard against the prose-drift bug class. The next real release cascade will be the natural acceptance test, and the bug class is now prevented from silently regressing.

**Cleanup performed:** orphan directory at `.claude/worktrees/agent-a72b28b1673ebe5c8/` removed (2026-05-08, no `.git` inside, not in `git worktree list`, no `.tiki/state.json` inside — pure stale code copy).

**Follow-up worth filing:** `packages/framework/.claude/commands/tiki/yolo.md` is a 3-way mirror of `packages/framework/commands/yolo.md` and `.claude/commands/tiki/yolo.md`, currently drifted. Same pattern applies to other tiki commands. Worth either auto-syncing during `pnpm -C packages/framework install-commands` or collapsing the package-internal copy entirely. Out of scope for #211.
