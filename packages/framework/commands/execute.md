---
name: execute
description: Execute plan phases for a GitHub issue
argument: <issue-number>
tools: Bash, Read, Write, Edit, Glob, Grep, Task, AskUserQuestion
---

# Execute Issue

Execute the phases of a planned issue. Each phase runs with focused context, producing a summary that carries forward to the next phase.

<instructions>
  <step>Load the plan from `.tiki/plans/issue-{number}.json`</step>
  <step>Load current state from `.tiki/state.json` to find current phase</step>
  <step>**CRITICAL: Update state.json with phase info BEFORE starting work** (see state-update-requirement below)</step>
  <step>For the current phase:
    1. Display phase details (title, files, verification criteria)
    2. Execute the phase content (the actual work)
    3. Run verification checks
    4. Generate a summary of what was accomplished
    5. Update phase status and save state
  </step>
  <step>If verification passes, advance to next phase or complete</step>
  <step>If verification fails, offer recovery options</step>
</instructions>

<state-update-requirement>
## CRITICAL: Phase State Updates

**You MUST update `.tiki/state.json` BEFORE starting work on each phase.**

This is not optional. The desktop app and other tooling rely on the `phase` object being kept current.

**BEFORE starting each phase, update state.json with:**
```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "issue": { "number": {N}, "title": "..." },
      "status": "executing",
      "pipelineStep": "EXECUTE",
      "phase": {
        "current": {phase number, 1-indexed},
        "total": {total phases from plan},
        "status": "executing"
      },
      "lastActivity": "{ISO timestamp}"
    }
  }
}
```

**AFTER completing each phase, update:**
- Set `phase.status` to `"completed"` or `"failed"`
- If advancing to next phase, increment `phase.current` and set `phase.status` to `"pending"`
- If all phases complete, set work `status` to `"shipping"`

**Example - Starting Phase 2 of 3:**
```json
"phase": {
  "current": 2,
  "total": 3,
  "status": "executing"
}
```

**Example - After completing Phase 2, ready for Phase 3:**
```json
"phase": {
  "current": 3,
  "total": 3,
  "status": "pending"
}
```
</state-update-requirement>

<parallel-execution>
## Parallel Phase Execution

Phases that have no shared file conflicts and whose dependencies are already satisfied can run concurrently in separate sub-agents. This section is the authoritative algorithm — follow it deterministically.

### When to parallelize

- **Default: ON.** Always attempt to parallelize independent phases.
- **Opt-out hook:** Read `.tiki/config.json`. If `workflow.parallel.enabled === false`, fall back to fully sequential execution. If the file or key is missing, treat it as `true`.
- **Edge case:** If a single-phase group emerges, run it as a single (non-parallel) phase using the existing single-phase code path. Do NOT set `parallelExecution`.

### Step 1 — Build the dependency graph

For each phase in the plan:
- `node = phase.number`
- `incoming edges = phase.dependencies` (numbers of phases that must complete first)
- `files = phase.files || []`

### Step 2 — Compute topological levels (Kahn's by levels)

```
remaining = set of all phase numbers
levels = []
while remaining is non-empty:
    ready = [p for p in remaining if all of p.dependencies are NOT in remaining]
    if ready is empty: ERROR — cycle in dependencies. Abort and surface.
    levels.append(ready)
    remaining -= ready
```

After this loop:
- `levels[0]` = phases with no unsatisfied deps
- `levels[i]` = phases whose deps are all in `levels[0..i-1]`
- Levels run **sequentially**: do not start level `i+1` until every phase in level `i` is `completed`.

### Step 3 — Within each level, split into file-conflict-free groups (greedy)

Within a single level, two phases can run in the same parallel group iff their `files` arrays have an empty intersection (set difference). Use this greedy algorithm:

```
groups = []
remaining_at_level = list of phases at this level (preserve plan order)
while remaining_at_level is non-empty:
    seed = remaining_at_level.pop_front()
    group = [seed]
    group_files = set(seed.files)
    leftover = []
    for p in remaining_at_level:
        if set(p.files).intersection(group_files) is empty:
            group.append(p)
            group_files = group_files.union(p.files)
        else:
            leftover.append(p)
    groups.append(group)
    remaining_at_level = leftover
```

Conservative rules:
- If `phase.files` is missing, empty, or null, treat the phase as conflicting with everything (assume worst case: it touches anything). Place it in its own group.
- **Groups within a level run sequentially.** Levels run sequentially.
- **Phases within a group run in parallel.**

### Step 4 — Dispatch the group

This is the parallelism mechanism. The Anthropic Agent (Task) tool runs concurrently when **multiple Task calls are emitted in a single assistant message**.

- **Group size 1:** Run as a normal single phase (existing single-phase code path). Do NOT set `parallelExecution`.
- **Group size N >= 2:** In ONE assistant message, emit N `Task` tool calls (one per phase in the group). Each Task uses `subagent_type: "general-purpose"` and the prompt template from `<sub-agent-protocol>` below. Each prompt MUST include the phase's files list and verification criteria so the sub-agent stays scoped to its files.

### Step 5 — State updates (`.tiki/state.json`)

**When starting a parallel group (size >= 2):** before dispatching the Task calls, write:

```json
"phase": {
  "current": <max(phase.number for phase in group)>,
  "total": <total phases in plan>,
  "status": "executing"
},
"parallelExecution": {
  "phases": [<all phase numbers in group, ascending>],
  "completedInGroup": [],
  "totalInGroup": <group size>,
  "startedAt": "<current ISO timestamp>"
}
```

`phase.current = max(...)` so old desktop clients that only read `phase` see a sensible "Phase X of Y" display while the group is in flight.

**As each phase in the group returns:**
- Append its number to `parallelExecution.completedInGroup` (or move to `failed` tracking if it failed).
- Update the per-phase status in `.tiki/plans/issue-N.json` immediately (don't batch — the file watcher relies on this).
- Do NOT advance `phase.current` while siblings are still running.

**When all phases in the group have returned:**
- Remove the `parallelExecution` field entirely (omit on serialize, or set to `null`).
- If any phase failed, see Failure Handling below.
- Otherwise, advance to the next group/level. If the next batch is also a parallel group of size >= 2, repeat from Step 4. If it's size 1, run sequentially without `parallelExecution`.

**When the entire plan is done:** set work `status` to `"shipping"` and clear `phase.status` to `"completed"`.

### Step 6 — Failure handling

When at least one sub-agent in a parallel group fails:

- **Do NOT cancel sibling sub-agents.** They are already in flight; cancellation is unsupported by the Agent tool and would only waste work. Let them run to completion.
- **Wait for all sub-agents to return.** Collect every result.
- **Surface all failures together.** Update the plan file: each failed phase gets `status: "failed"` with its error message. Successful siblings get `status: "completed"`.
- **Pause for manual recovery.** Set work `status` to `"failed"`, clear `parallelExecution`, and present the recovery options from `<next-actions>` (fix and retry, skip, pause, heal). Do NOT auto-advance to the next level.

### Step 7 — Backward compatibility

- A single-phase level emits a single Task call (or runs inline) and DOES NOT set `parallelExecution`. Old clients see the familiar `phase: { current, total, status }` and behave identically.
- Old state.json files lacking `parallelExecution` deserialize cleanly (the field is `Option<…>` with `#[serde(default)]` on the Rust side and optional in TypeScript).
- The whole feature degrades gracefully: if every level happens to contain phases that all conflict on files, the algorithm collapses to one phase per group, which is byte-identical to sequential execution.

### Worked example

Plan with 5 phases:
- P1: deps=[],     files=["a.rs"]
- P2: deps=[],     files=["b.ts"]
- P3: deps=[],     files=["a.rs"]   <-- conflicts with P1
- P4: deps=[1,2],  files=["c.css"]
- P5: deps=[3],    files=["a.rs"]

Levels:
- L0 = [P1, P2, P3]   (no deps)
- L1 = [P4, P5]       (deps satisfied by L0)

Groups:
- L0 split: seed P1 (files=a.rs). P2 (b.ts) joins (no overlap) → group=[P1,P2]. P3 (a.rs) conflicts with P1 → next group=[P3]. So L0 runs as: parallel{P1,P2} → then P3.
- L1 split: seed P4 (c.css). P5 (a.rs) has no overlap → group=[P4,P5]. So L1 runs as: parallel{P4,P5}.

Final execution order: parallel{P1,P2} → P3 → parallel{P4,P5}.
</parallel-execution>

<phase-execution>
**Before starting a phase:**
1. Read the phase content from the plan
2. Read any summaries from previous phases
3. Understand which files will be modified
4. Check dependencies are met

**During phase execution:**
1. Follow the phase instructions precisely
2. Create or modify only the specified files
3. Keep changes focused on phase goals
4. Note any unexpected issues

**After completing phase work:**
1. Run all verification checks
2. Run tests if applicable (`npm test`, `pnpm test`, etc.)
3. Run type checks if applicable (`tsc --noEmit`)
4. Run linting if applicable
5. Generate a concise summary (passed to next phase)

**Summary format:**
```
Phase {N} Summary:
- Created: {list of new files}
- Modified: {list of changed files}
- Key changes: {bullet points of what was done}
- Verification: {PASS/FAIL with details}
- Notes for next phase: {any context needed}
```
</phase-execution>

<sub-agent-protocol>
For complex phases or when context is getting long, use the Task tool to spawn a sub-agent:

```
Task tool parameters:
- subagent_type: "general-purpose"
- description: "Execute phase {N}: {title}"
- prompt: |
    You are executing Phase {N} of Issue #{number}: {issue title}

    ## Previous Phase Summaries
    {summaries from phases 1 to N-1}

    ## This Phase
    **Title:** {title}
    **Goal:** {content}
    **Files:** {file list}

    ## Verification Criteria
    {verification list}

    ## Instructions
    1. Execute the phase as described
    2. Verify your work against the criteria
    3. Return a summary in this format:
       - Files created/modified
       - Key changes made
       - Verification results
       - Notes for next phase
```

The sub-agent's response becomes the phase summary.
</sub-agent-protocol>

<output>
## Executing: Issue #{number}

### Current Progress
**Phase:** {current} of {total}
**Status:** {executing | completed | failed}

---

### Phase {N}: {title}

**Files:**
{file list}

**Instructions:**
{phase content}

**Verification:**
- [ ] {check 1}
- [ ] {check 2}

---

{After execution:}

### Phase {N} Results

**Status:** {PASS | FAIL}

**Summary:**
{generated summary}

**Verification Results:**
- [x] {check 1}: Passed
- [x] {check 2}: Passed

---

{If more phases remain:}
*Phase {N} complete. {remaining} phases remaining.*

{If all phases complete:}
*All phases complete! Ready to ship.*
</output>

<state-management>
During execution, update `.tiki/state.json`:

**Starting a phase:**
```json
{
  "phase": {
    "current": {N},
    "total": {total},
    "status": "executing"
  },
  "status": "executing",
  "pipelineStep": "EXECUTE",
  "lastActivity": "{ISO timestamp}"
}
```

**Completing a phase:**
- Update plan file: set phase status to "completed", add completedAt and summary
- Update state: increment current phase or set status to "shipping" if done
- Write phase summary for handoff to next phase

**On failure:**
- Update plan file: set phase status to "failed", add error details
- Update state: set phase.status to "failed", keep current phase number
- Do not advance to next phase
</state-management>

<errors>
  <error type="no-argument">
    No issue number provided. Please specify an issue number:
    ```
    /tiki:execute 42
    ```
  </error>
  <error type="no-plan">
    No plan found for issue #{number}. Please create a plan first:
    ```
    /tiki:plan {number}
    ```
  </error>
  <error type="not-audited">
    Plan has not been audited. Run audit first or use `--force` to skip:
    ```
    /tiki:audit {number}
    ```
  </error>
  <error type="verification-failed">
    Phase {N} verification failed:
    {list of failed checks}

    Options:
    - Fix the issues and retry
    - Skip this verification (risky)
    - Pause execution
  </error>
</errors>

<next-actions>
**After successful phase:**
- question: "Phase {N} complete. Continue to next phase?"
- options:
  - label: "Continue (Recommended)"
    description: "Execute the next phase"
  - label: "Pause"
    description: "Save progress and stop here"
  - label: "Review progress"
    description: "See what's been done so far"

**After all phases complete:**
- question: "All phases complete! Ready to ship?"
- options:
  - label: "Ship (Recommended)"
    description: "Commit, push, and close the issue"
  - label: "Review first"
    description: "Review all changes before shipping"
  - label: "Run tests"
    description: "Run full test suite before shipping"

**After failure:**
- question: "Phase {N} failed. How would you like to proceed?"
- options:
  - label: "Fix and retry"
    description: "Fix the issues and re-run this phase"
  - label: "Skip phase"
    description: "Mark as skipped and continue (risky)"
  - label: "Pause execution"
    description: "Stop here and investigate"
  - label: "Heal"
    description: "Auto-diagnose and attempt repair"
</next-actions>
