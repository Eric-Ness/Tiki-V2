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
YOLO uses the same state management as individual commands, tracking progress through:

```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "status": "{current stage}",
      "yolo": true,
      "startedAt": "{timestamp}",
      ...
    }
  }
}
```

The `yolo: true` flag indicates automated pipeline mode.
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
