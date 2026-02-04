---
name: audit
description: Validate a plan before execution
argument: <issue-number>
tools: Read, Glob, Grep, AskUserQuestion
---

# Audit Plan

Validate a plan before execution to catch issues early. This step checks for completeness, feasibility, and potential problems.

<instructions>
  <step>Load the plan from `.tiki/plans/issue-{number}.json`</step>
  <step>Run all audit checks from the checklist below</step>
  <step>Report any warnings or failures</step>
  <step>If all checks pass, mark the plan as ready for execution</step>
  <step>If checks fail, offer options to fix or proceed anyway</step>
</instructions>

<audit-checklist>
**Completeness Checks:**
- [ ] All success criteria have at least one phase addressing them
- [ ] Every phase has verification criteria
- [ ] Every phase lists the files it will modify
- [ ] No orphan phases (phases with unmet dependencies)

**Feasibility Checks:**
- [ ] Referenced files exist (for modifications) or parent directories exist (for new files)
- [ ] No obvious conflicts between phases modifying same files simultaneously
- [ ] Dependencies form a valid DAG (no circular dependencies)

**Quality Checks:**
- [ ] Phase count is reasonable for complexity (not too many, not too few)
- [ ] Phase titles are descriptive and distinct
- [ ] Verification criteria are specific and testable
- [ ] Early phases don't depend on later phases

**Risk Checks:**
- [ ] High-risk files (config, auth, payments) have explicit verification
- [ ] Breaking changes are isolated to specific phases
- [ ] Rollback path is clear if execution fails mid-way
</audit-checklist>

<output>
## Audit: Issue #{number}

### Summary
**Plan:** {issue title}
**Phases:** {count}
**Status:** {PASS | WARN | FAIL}

### Checklist Results

#### Completeness
| Check | Status | Notes |
|-------|--------|-------|
| All criteria covered | {PASS/FAIL} | {details} |
| Verification defined | {PASS/FAIL} | {details} |
| Files specified | {PASS/FAIL} | {details} |
| Dependencies valid | {PASS/FAIL} | {details} |

#### Feasibility
| Check | Status | Notes |
|-------|--------|-------|
| Files exist | {PASS/WARN/FAIL} | {details} |
| No conflicts | {PASS/WARN} | {details} |
| Valid DAG | {PASS/FAIL} | {details} |

#### Quality
| Check | Status | Notes |
|-------|--------|-------|
| Phase count | {PASS/WARN} | {details} |
| Titles clear | {PASS/WARN} | {details} |
| Verification testable | {PASS/WARN} | {details} |

#### Risks
| Check | Status | Notes |
|-------|--------|-------|
| High-risk verified | {PASS/WARN/N/A} | {details} |
| Changes isolated | {PASS/WARN} | {details} |

---

### {Overall Assessment}

{Summary paragraph about the plan's readiness}

{If warnings exist: list them with suggestions}
{If failures exist: list them with required fixes}
</output>

<state-management>
After audit:
- Set `pipelineStep` to `"AUDIT"`
- If PASS: Update state status to `executing`, ready for execute
- If WARN: Keep status as `planning`, note warnings in state
- If FAIL: Keep status as `planning`, execution blocked until fixed

```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "status": "executing",
      "pipelineStep": "AUDIT",
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
    /tiki:audit 42
    ```
  </error>
  <error type="no-plan">
    No plan found for issue #{number}. Please create a plan first:
    ```
    /tiki:plan {number}
    ```
  </error>
</errors>

<next-actions>
After audit completes:

**If PASS:**
- question: "Audit passed. Ready to execute?"
- options:
  - label: "Execute (Recommended)"
    description: "Start phase-by-phase execution"
  - label: "Review plan again"
    description: "Take another look at the phases"

**If WARN:**
- question: "Audit found warnings. How would you like to proceed?"
- options:
  - label: "Execute anyway"
    description: "Proceed despite warnings"
  - label: "Fix warnings"
    description: "Address the warnings before executing"
  - label: "Re-plan"
    description: "Create a new plan"

**If FAIL:**
- question: "Audit failed. The plan needs fixes before execution."
- options:
  - label: "Fix issues"
    description: "Address the failures"
  - label: "Re-plan"
    description: "Create a new plan from scratch"
  - label: "Force execute (risky)"
    description: "Proceed despite failures (not recommended)"
</next-actions>
