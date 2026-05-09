---
name: audit
description: Validate a plan before execution
argument: <issue-number>
tools: Read, Glob, Grep, AskUserQuestion
---

# Audit Plan

Validate a plan before execution to catch issues early. This step checks for completeness, feasibility, and potential problems.

<instructions>
  <step>**Immediately** update `.tiki/state.json` to set `status: "planning"` and `pipelineStep: "AUDIT"` so the issue appears in the Audit step on the kanban right away (see early-state-update below)</step>
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

<early-state-update>
**Before running any audit checks**, update `.tiki/state.json` so the issue appears in the Audit step immediately. Without this write, the kanban card stays in the Plan state for the entire duration of audit validation, making AUDIT invisible to the user.

1. Read the current `.tiki/state.json`
2. Update the `issue:{number}` entry in `activeWork` to set `status: "planning"` and `pipelineStep: "AUDIT"`:

```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "issue": { "number": {number}, "title": "{title}" },
      "status": "planning",
      "pipelineStep": "AUDIT",
      "phase": { "current": 1, "total": {total phases}, "status": "pending" },
      "createdAt": "{existing createdAt}",
      "lastActivity": "{ISO timestamp}"
    }
  }
}
```

This ensures the desktop app shows the issue in the Audit step as soon as validation begins, not after it completes.
</early-state-update>

<state-management>
After audit:
- Keep `pipelineStep` as `"AUDIT"` and `status` as `"planning"` regardless of outcome
- If PASS: add `"auditPassed": true` to the issue's work entry. Do NOT set `status: "executing"` here — that transition is owned by `tiki:execute`, which writes its own state before each phase. Setting `executing` from audit causes the kanban card to jump to the Execute column before any phase has actually started, hiding the AUDIT step from the user.
- If WARN: add `"auditPassed": true` and record warnings in state (e.g., as a `auditWarnings` array)
- If FAIL: add `"auditPassed": false`, execution blocked until fixed

```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "issue": { "number": {number}, "title": "{title}" },
      "status": "planning",
      "pipelineStep": "AUDIT",
      "phase": { "current": 1, "total": {total phases}, "status": "pending" },
      "auditPassed": true,
      "createdAt": "{existing createdAt}",
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
