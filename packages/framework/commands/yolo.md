---
name: yolo
description: Full automated pipeline - get, review, plan, audit, execute, ship
argument: <issue-number>
tools: Bash, Read, Write, Edit, Glob, Grep, Task, AskUserQuestion
---

# YOLO Mode

Execute the complete Tiki pipeline for an issue in one command: get → review → plan → audit → execute → ship.

YOLO mode is designed for well-defined issues where you trust the automated workflow. Each step runs with fresh context to avoid context limit issues.

<instructions>
  <step>**GET**: Fetch the issue from GitHub and initialize state</step>
  <step>**REVIEW**: Analyze requirements and derive success criteria</step>
  <step>**PLAN**: Break into executable phases</step>
  <step>**AUDIT**: Validate the plan (auto-proceed if PASS, pause if FAIL)</step>
  <step>**EXECUTE**: Run all phases sequentially</step>
  <step>**SHIP**: Commit, push, and close the issue</step>
</instructions>

<yolo-flow>
```
┌─────────┐   ┌────────┐   ┌──────┐   ┌───────┐   ┌─────────┐   ┌──────┐
│   GET   │──▶│ REVIEW │──▶│ PLAN │──▶│ AUDIT │──▶│ EXECUTE │──▶│ SHIP │
└─────────┘   └────────┘   └──────┘   └───────┘   └─────────┘   └──────┘
     │             │            │          │            │           │
     ▼             ▼            ▼          ▼            ▼           ▼
  Fetch        Analyze      Create     Validate     Run all      Commit
  issue        & derive     phases     before       phases       & close
               criteria                starting
```

**Automatic Progression Rules:**
- GET → REVIEW: Always proceed
- REVIEW → PLAN: Always proceed
- PLAN → AUDIT: Always proceed
- AUDIT → EXECUTE: Only if PASS or WARN (pause on FAIL)
- EXECUTE phases: Continue while phases pass (pause on failure)
- EXECUTE → SHIP: Only if all phases complete
</yolo-flow>

<pause-conditions>
YOLO mode will pause and ask for input when:

1. **Audit fails** - Plan has blocking issues
2. **Phase fails** - Verification didn't pass
3. **Tests fail** - Before shipping
4. **Push fails** - Git issues
5. **Ambiguous requirements** - Can't derive clear success criteria

When paused, you can:
- Fix the issue and resume
- Skip the problematic step
- Abort the pipeline
</pause-conditions>

<sub-agent-strategy>
For context management, YOLO uses sub-agents strategically:

**Run in main context:**
- GET (quick, needs to set up state)
- AUDIT (quick validation)

**Run as sub-agent (fresh context):**
- REVIEW (may need codebase exploration)
- PLAN (benefits from fresh reasoning)
- Each EXECUTE phase (isolated work)
- SHIP (quick, needs final state)

Sub-agent calls pass summaries forward:
```
Phase 1 summary → Phase 2 context
Phase 2 summary → Phase 3 context
...
Final summary → SHIP context
```

## CRITICAL: Always emit the per-step transition from the parent

The kanban board only reflects pipeline progress if `state.mjs transition` runs for each step. **Do NOT make emission conditional on how you dispatch the step** — that branch ("the skill will emit it, so I won't") is exactly how transitions get dropped and the board freezes.

**The rule, with no exceptions:** BEFORE dispatching each step — whether via `Skill(...)`, a raw `Agent` / `Task`, or by doing the work inline — run the matching per-step shim block from `<state-management>` below from the parent context.

Re-emitting a transition that a skill ALSO emits is a safe no-op: same-status transitions are always legal (`state.mjs` validates and idempotently rewrites). So "the parent emitted it and the skill emitted it again" is harmless; "neither emitted it" freezes the board. When in doubt, emit.
</sub-agent-strategy>

<output>
## YOLO: Issue #{number}

### Pipeline Progress

| Step | Status | Notes |
|------|--------|-------|
| GET | {DONE/...} | {summary} |
| REVIEW | {DONE/...} | {summary} |
| PLAN | {DONE/...} | {phase count} |
| AUDIT | {DONE/...} | {PASS/WARN/FAIL} |
| EXECUTE | {DONE/IN PROGRESS/...} | Phase {N}/{total} |
| SHIP | {DONE/...} | {commit SHA} |

---

{Current step output}

---

{If completed:}
### YOLO Complete!

Issue #{number} has been fully processed:
- Fetched and reviewed
- Planned into {N} phases
- All phases executed
- Committed and pushed
- Issue closed on GitHub

**Commit:** {SHA}
**Time:** {elapsed}
</output>

<state-management>
## CRITICAL: Update state.json BEFORE each pipeline step

The desktop kanban board reads `.tiki/state.json` to render pipeline progress. If you skip a transition, the card freezes on the prior step and the user sees a stale pipeline. **Run the per-step shim invocation below BEFORE dispatching each step, every time.** Bump `lastActivity` on every change. Use nested `issue: { number, title }`, never top-level fields.

### Transition table

| Step    | `status`    | `pipelineStep` | `phase`                                         |
|---------|-------------|----------------|-------------------------------------------------|
| GET     | `pending`   | `GET`          | —                                               |
| REVIEW  | `reviewing` | `REVIEW`       | —                                               |
| PLAN    | `planning`  | `PLAN`         | `{ current: 1, total: N, status: "pending" }`   |
| AUDIT   | `planning`  | `AUDIT`        | `{ current: 1, total: N, status: "pending" }`   |
| EXECUTE | `executing` | `EXECUTE`      | `{ current: N, total: T, status: "executing" }` |
| SHIP    | `shipping`  | `SHIP`         | —                                               |
| Done    | `completed` | `SHIP`         | (cleared)                                       |

### Per-step shim invocations (REQUIRED)

Run the matching block BEFORE dispatching that step. The shim validates transitions, atomic-writes, and preserves `parentRelease`.

**If the shim path does not resolve** (e.g. a plugin-only project where `.claude/tiki/scripts/` was not installed, so `node .claude/tiki/scripts/state.mjs` errors with "Cannot find module"), DO NOT skip the state update — fall back to the direct-JSON write in **Legacy: direct JSON** below. (The reconciler hook still corrects state from artifacts, but emitting the transition keeps the kanban live mid-step.)

**Before GET** (fresh issue — initializes the entry; pass `--issue-number` + `--issue-title` so the work item materializes):

```bash
node .claude/tiki/scripts/state.mjs transition issue:{number} \
  --to-status pending --to-step GET \
  --issue-number {number} --issue-title "{title}"
```

**Before REVIEW**:

```bash
node .claude/tiki/scripts/state.mjs transition issue:{number} \
  --to-status reviewing --to-step REVIEW
```

**Before PLAN** (phase total `N` is provisional — re-emit after plan.md writes the real count):

```bash
node .claude/tiki/scripts/state.mjs transition issue:{number} \
  --to-status planning --to-step PLAN \
  --phase-current 1 --phase-total {N} --phase-status pending
```

**Before AUDIT** (same `status: planning`, but `pipelineStep` advances to `AUDIT`):

```bash
node .claude/tiki/scripts/state.mjs transition issue:{number} \
  --to-status planning --to-step AUDIT \
  --phase-current 1 --phase-total {N} --phase-status pending
```

**Before EXECUTE** (each phase — `{current}` is the phase about to run, `{total}` is the plan's phase count):

```bash
node .claude/tiki/scripts/state.mjs transition issue:{number} \
  --to-status executing --to-step EXECUTE \
  --phase-current {current} --phase-total {total} --phase-status executing
```

**Before SHIP** (after all phases pass):

```bash
node .claude/tiki/scripts/state.mjs transition issue:{number} \
  --to-status shipping --to-step SHIP
```

Run the matching block above before dispatching each step, **regardless of how you dispatch it** (Skill, raw Agent/Task, or inline). Double-emission is a safe no-op (same-status transitions are legal); omission freezes the kanban on the prior step. Never skip the parent emit on the assumption that something downstream will do it.

### Legacy: direct JSON

Match the canonical shape. Atomic write (`.tmp` + rename).

```json
{ "activeWork": { "issue:{number}": {
  "type": "issue",
  "issue": { "number": {number}, "title": "{title}" },
  "status": "executing", "pipelineStep": "EXECUTE",
  "phase": { "current": 2, "total": 3, "status": "executing" },
  "createdAt": "{ISO}", "lastActivity": "{ISO}"
} } }
```

### Parent release detection & preservation

At GET, if any `release:*` entry has `status: "executing"` and contains this issue number in `release.issues`, set `parentRelease: "{version}"` on the issue entry. **It MUST persist through every step.**

### Completion

| `parentRelease`? | After SHIP |
|------------------|------------|
| **No** | Remove `issue:{number}` from `activeWork`. Add to `history.recentIssues` + `history.lastCompletedIssue`. |
| **Yes** | Keep entry: set `status: "completed"`, `pipelineStep: "SHIP"`, preserve `parentRelease`. Still add to history. The release's ship cleans up children. |
</state-management>

<errors>
  <error type="no-argument">
    No issue number provided. Please specify an issue number:
    ```
    /tiki:yolo 42
    ```
  </error>
  <error type="already-in-progress">
    Issue #{number} is already being worked on.

    Current status: {status}
    Current phase: {phase}

    Options:
    - Resume: `/tiki:execute {number}`
    - Start over: `/tiki:yolo {number} --force`
  </error>
  <error type="pipeline-paused">
    YOLO pipeline paused at {step}:
    {reason}

    To continue: Fix the issue and run `/tiki:yolo {number} --resume`
    To abort: `/tiki:yolo {number} --abort`
  </error>
</errors>

<next-actions>
**On successful completion:**
- question: "YOLO complete! Issue #{number} shipped. What's next?"
- options:
  - label: "YOLO another issue"
    description: "Run the full pipeline on another issue"
  - label: "Get an issue"
    description: "Fetch an issue without full automation"
  - label: "Done"
    description: "End the session"

**On pause:**
- question: "YOLO paused at {step}. How would you like to proceed?"
- options:
  - label: "Fix and resume"
    description: "Address the issue and continue"
  - label: "Skip this step"
    description: "Move to the next step (if possible)"
  - label: "Abort pipeline"
    description: "Stop and clean up"
  - label: "Switch to manual"
    description: "Continue with individual commands"
</next-actions>
