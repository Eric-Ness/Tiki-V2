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
