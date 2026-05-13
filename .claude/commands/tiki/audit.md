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
  <step>Run the algorithmic checks in `<algorithmic-checks>` (coverage matrix + dependency cycle detection). These are deterministic checks that produce specific FAIL diagnostics, not subjective judgments.</step>
  <step>Report any warnings or failures</step>
  <step>If all checks pass, mark the plan as ready for execution</step>
  <step>If checks fail, offer options to fix or proceed anyway</step>
</instructions>

<audit-checklist>
**Completeness Checks:**
- [ ] All success criteria have at least one phase addressing them *(enforced by `<algorithmic-checks>` § Coverage)*
- [ ] Every phase has verification criteria
- [ ] Every phase lists the files it will modify
- [ ] No orphan phases (phases with unmet dependencies)

**Feasibility Checks:**
- [ ] Referenced files exist (for modifications) or parent directories exist (for new files)
- [ ] No obvious conflicts between phases modifying same files simultaneously
- [ ] Dependencies form a valid DAG (no circular dependencies) *(enforced by `<algorithmic-checks>` § Kahn's)*

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

<algorithmic-checks>
These two checks are deterministic — run them mechanically against the plan JSON and surface specific FAIL diagnostics. They catch problems that the prose-only checklist tends to miss.

### Coverage — successCriteria ↔ coverageMatrix bidirectional match

Schema reference: `successCriterion.id` is `^SC\d+$` (`plan.schema.json:117`); `coverageMatrix` maps criterion-IDs to arrays of phase numbers (`plan.schema.json:74`). For a plan to be coverage-complete, both directions must hold:

1. **Every criterion has coverage.** For each `sc` in `successCriteria`, `coverageMatrix[sc.id]` must exist and contain at least one phase number.
   - FAIL with `coverage gap: success criterion {id} ({description}) has no phases in coverageMatrix` for any missing key.
2. **Every coverageMatrix key references a real criterion.** For each key `k` in `coverageMatrix`, there must exist `sc` in `successCriteria` with `sc.id === k`.
   - FAIL with `coverage drift: coverageMatrix key '{k}' does not match any successCriterion id` for any stray key.
3. **Every phase number in `coverageMatrix[*]` exists in `phases`.** A dangling phase number means the matrix is out of date.
   - FAIL with `coverage drift: coverageMatrix['{k}'] references phase {n} which is not in the plan`.

If `successCriteria` is empty or absent, skip this check (no claims to verify) and surface a WARN: `plan has no successCriteria — coverage cannot be audited`.

If `coverageMatrix` is empty or absent but `successCriteria` has entries, FAIL: `plan has {N} successCriteria but no coverageMatrix`.

### Kahn's — phase dependencies form a DAG

This is the same algorithm `execute.md` runs before dispatching sub-agents (`<parallel-execution>` § Step 2). Running it here at plan-time surfaces cycles in seconds rather than after sub-agent dispatch has already started burning context.

```
remaining = { phase.number for phase in plan.phases }
ordered = []
while remaining is non-empty:
    ready = [ p for p in plan.phases
              if p.number in remaining
              and every dep in p.dependencies is NOT in remaining ]
    if ready is empty:
        FAIL — cycle detected. Surface the remaining set as
        "cycle in dependencies among phases: {remaining}" so the user
        can see exactly which phases are circular.
    remaining -= { p.number for p in ready }
    ordered += ready
PASS — phase order is a valid topological sort.
```

Additional dependency sanity checks performed during the same pass:

- For every `p`, every `d` in `p.dependencies` must be `< p.number`. If not, FAIL: `phase {p.number} depends on phase {d}, which is not strictly earlier — dependencies must point backwards`.
- For every `p`, every `d` in `p.dependencies` must reference a real phase number. If not, FAIL: `phase {p.number} depends on phase {d}, which is not in the plan`.

If any phase has no `dependencies` field, treat it as an empty list (no deps).
</algorithmic-checks>

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
Set `pipelineStep: "AUDIT"`. PASS → `status: "executing"`; WARN/FAIL → keep `planning`.

```bash
# PASS:
node packages/framework/scripts/state.mjs transition issue:{number} --to-status executing --to-step AUDIT
# WARN or FAIL:
node packages/framework/scripts/state.mjs transition issue:{number} --to-status planning --to-step AUDIT
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
