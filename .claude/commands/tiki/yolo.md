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
## CRITICAL: State Updates at Each Pipeline Step

**You MUST update `.tiki/state.json` at each pipeline step.** The desktop app relies on this state to display progress in the Kanban board and Active Work panel.

### Required JSON Format

The state MUST match the `IssueWork` interface. Key requirements:
- `issue` MUST be an object with `number` and `title` (NOT top-level fields)
- `status` MUST be one of: `pending`, `reviewing`, `planning`, `executing`, `shipping`, `completed`, `failed`
- `pipelineStep` MUST be one of: `GET`, `REVIEW`, `PLAN`, `AUDIT`, `EXECUTE`, `SHIP`
- `lastActivity` MUST be updated on EVERY state change
- Do NOT add extra fields like `yolo`, `github`, `startedAt`, etc.

### State at Each Step

**1. GET Step** — After fetching the issue:
```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "issue": { "number": {number}, "title": "{title}" },
      "status": "pending",
      "pipelineStep": "GET",
      "createdAt": "{ISO timestamp}",
      "lastActivity": "{ISO timestamp}"
    }
  }
}
```

**2. REVIEW Step** — Starting analysis:
```json
"issue:{number}": {
  "type": "issue",
  "issue": { "number": {number}, "title": "{title}" },
  "status": "reviewing",
  "pipelineStep": "REVIEW",
  "createdAt": "{ISO timestamp}",
  "lastActivity": "{ISO timestamp}"
}
```

**3. PLAN Step** — Creating phases:
```json
"issue:{number}": {
  "type": "issue",
  "issue": { "number": {number}, "title": "{title}" },
  "status": "planning",
  "pipelineStep": "PLAN",
  "phase": { "current": 1, "total": {total phases}, "status": "pending" },
  "createdAt": "{ISO timestamp}",
  "lastActivity": "{ISO timestamp}"
}
```

**4. AUDIT Step** — Validating plan:
```json
"issue:{number}": {
  "type": "issue",
  "issue": { "number": {number}, "title": "{title}" },
  "status": "planning",
  "pipelineStep": "AUDIT",
  "phase": { "current": 1, "total": {total phases}, "status": "pending" },
  "createdAt": "{ISO timestamp}",
  "lastActivity": "{ISO timestamp}"
}
```

**5. EXECUTE Step** — Before EACH phase:
```json
"issue:{number}": {
  "type": "issue",
  "issue": { "number": {number}, "title": "{title}" },
  "status": "executing",
  "pipelineStep": "EXECUTE",
  "phase": { "current": {N}, "total": {T}, "status": "executing" },
  "createdAt": "{ISO timestamp}",
  "lastActivity": "{ISO timestamp}"
}
```

After completing a phase, update `phase.status` to `"completed"` and increment `phase.current` for the next phase.

**6. SHIP Step** — After all phases complete:
```json
"issue:{number}": {
  "type": "issue",
  "issue": { "number": {number}, "title": "{title}" },
  "status": "shipping",
  "pipelineStep": "SHIP",
  "createdAt": "{ISO timestamp}",
  "lastActivity": "{ISO timestamp}"
}
```

**7. Completion** — After shipping, remove from `activeWork` and add to `history`:
```json
{
  "activeWork": {},
  "history": {
    "lastCompletedIssue": {
      "number": {number},
      "title": "{title}",
      "completedAt": "{ISO timestamp}"
    },
    "recentIssues": [
      { "number": {number}, "title": "{title}", "completedAt": "{ISO timestamp}" },
      ...existing entries...
    ]
  }
}
```

### State Transition Summary

| Pipeline Step | `status` | `pipelineStep` | `phase` |
|---------------|----------|----------------|---------|
| GET | `pending` | `GET` | — |
| REVIEW | `reviewing` | `REVIEW` | — |
| PLAN | `planning` | `PLAN` | `{ current: 1, total: N, status: "pending" }` |
| AUDIT | `planning` | `AUDIT` | `{ current: 1, total: N, status: "pending" }` |
| EXECUTE (each phase) | `executing` | `EXECUTE` | `{ current: N, total: T, status: "executing" }` |
| SHIP | `shipping` | `SHIP` | — |
| Complete | (removed) | — | — |

### Critical Requirements

1. **Update state BEFORE starting each step** — The UI needs to show progress in real-time
2. **Always update `lastActivity`** — Use `new Date().toISOString()` for current timestamp
3. **Use correct `issue` format** — Must be `{ "number": N, "title": "..." }`, NOT top-level fields
4. **Track phase progress** — Update `phase.current`, `phase.total`, and `phase.status` during execution
5. **Clean up on completion** — Remove from `activeWork`, add to `history` (unless part of a release — see below)

### Parent Release Detection

Before creating the initial state entry (GET step), check if any `release:*` entry exists in `.tiki/state.json` whose `release.issues` array contains this issue number AND whose `status` is `"executing"`.

**If a parent release is found:**
1. Add `"parentRelease": "{version}"` to the issue's work entry at the GET step
2. The `parentRelease` field MUST persist through ALL pipeline steps (GET through SHIP)
3. On completion (step 7): do NOT remove the issue from `activeWork`. Instead, set `status` to `"completed"` and `pipelineStep` to `"SHIP"`. The parent release will handle final cleanup.
4. Still add the issue to `history.recentIssues` as normal.

**If no parent release is found:**
- Proceed normally (no `parentRelease` field, remove from `activeWork` on completion)

**Example state when issue #42 is part of release v1.2:**
```json
{
  "activeWork": {
    "release:v1.2": {
      "type": "release",
      "release": { "version": "v1.2", "issues": [41, 42, 43], "currentIssue": 42, "completedIssues": [41] },
      "status": "executing",
      "pipelineStep": "EXECUTE",
      "createdAt": "...",
      "lastActivity": "..."
    },
    "issue:42": {
      "type": "issue",
      "issue": { "number": 42, "title": "Add user profiles" },
      "status": "executing",
      "pipelineStep": "EXECUTE",
      "parentRelease": "v1.2",
      "phase": { "current": 2, "total": 3, "status": "executing" },
      "createdAt": "...",
      "lastActivity": "..."
    }
  }
}
```

**Completion when `parentRelease` is set (replaces step 7 behavior):**
```json
{
  "activeWork": {
    "release:v1.2": { "..." : "..." },
    "issue:42": {
      "type": "issue",
      "issue": { "number": 42, "title": "Add user profiles" },
      "status": "completed",
      "pipelineStep": "SHIP",
      "parentRelease": "v1.2",
      "createdAt": "...",
      "lastActivity": "{ISO timestamp}"
    }
  }
}
```
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
