---
name: review
description: Analyze a GitHub issue before planning
argument: <issue-number>
tools: Bash, Read, Glob, Grep, AskUserQuestion
---

# Review Issue

Analyze a GitHub issue to understand its requirements, complexity, and what needs to be true for it to be considered complete. This step helps create better plans.

<instructions>
  <step>Load the issue from state or fetch it if not present:
    - Check `.tiki/state.json` for `issue:{number}`
    - If not found, run the equivalent of `tiki:get {number}` first
  </step>
  <step>Analyze the issue description to identify:
    - **Core requirements**: What must be built or changed
    - **Success criteria**: What needs to be true when done (backward planning)
    - **Acceptance criteria**: Any explicit criteria in the issue
    - **Technical scope**: Files, systems, or areas likely affected
    - **Dependencies**: External dependencies or prerequisites
    - **Risks**: Potential blockers or unknowns
  </step>
  <step>Explore the codebase to understand the current state:
    - Search for related files, functions, or patterns
    - Identify existing code that will be modified
    - Note any architectural patterns to follow
  </step>
  <step>Estimate complexity using the provided rubric</step>
  <step>Present the review summary and ask for confirmation before planning</step>
</instructions>

<complexity-rubric>
Rate the issue complexity as **Low**, **Medium**, or **High**:

**Low Complexity:**
- Single file or localized change
- Clear requirements, no ambiguity
- No new dependencies
- Follows existing patterns exactly
- 1-2 phases expected

**Medium Complexity:**
- Multiple files but within one system/feature
- Some requirements need clarification
- May need minor architectural decisions
- Mostly follows existing patterns
- 3-5 phases expected

**High Complexity:**
- Cross-cutting changes across multiple systems
- Significant ambiguity or unknowns
- New patterns or architecture needed
- External dependencies or integrations
- 5+ phases expected
- May benefit from research first
</complexity-rubric>

<success-criteria-extraction>
Frame success criteria as: **"What needs to be true for this to be done?"**

For each requirement, derive a testable criterion:
- Functional: "Users can {action}" or "{Feature} works when {condition}"
- Testing: "Tests pass for {scope}" or "Coverage includes {area}"
- Performance: "{Operation} completes in under {time}"
- Security: "{Data} is protected by {mechanism}"
- Documentation: "{Feature} is documented in {location}"

Prefix each with an ID: SC1, SC2, SC3, etc.
</success-criteria-extraction>

<output>
## Review: Issue #{number}

### Summary
{One-sentence summary of what this issue is about}

### Core Requirements
{Bulleted list of what must be built or changed}

### Success Criteria
| ID | Category | Criterion |
|----|----------|-----------|
| SC1 | {category} | {What needs to be true} |
| SC2 | {category} | {What needs to be true} |
| ... | ... | ... |

### Technical Scope
**Files likely affected:**
{List of files or patterns that will be modified}

**Existing patterns to follow:**
{Relevant patterns or conventions found in the codebase}

### Dependencies & Risks
**Prerequisites:**
{Any dependencies or things that must be true before starting}

**Risks/Unknowns:**
{Potential blockers or areas needing clarification}

### Complexity Assessment
**Rating:** {Low | Medium | High}
**Reasoning:** {Brief explanation}
**Estimated phases:** {number}

---

*Review complete. Ready to plan.*
</output>

<research-capture>
**As a side-effect of REVIEW, capture domain understanding from codebase exploration.**

While analyzing the codebase to understand this issue, you likely uncovered non-trivial knowledge — architecture patterns, API conventions, hidden constraints, data models, important file conventions, auth flows, IPC contracts, etc. Persist anything that future planning or execution might need by writing one or more research docs to `.tiki/research/<topic>.md`.

Each research doc uses this YAML front-matter schema, then a free-form markdown body:

```yaml
---
topic: <kebab-case-slug>
tags: [tag1, tag2, tag3]
issues: [{number}]
created: <ISO 8601 timestamp>
---
```

Rules:
1. **Topic slug** is kebab-case derived from the subject (e.g. `auth-flow`, `tauri-watcher`, `state-schema`).
2. **Tags** are 2-5 short lowercase strings reflecting the categorization.
3. **Issues** array includes the current issue number `[{number}]`.
4. **Created** is the current ISO 8601 timestamp.
5. **Skip** writing if the issue is purely a one-line bug fix or has no meaningful domain learning. Quality > quantity — do not pad output with shallow notes.
6. **Append, do not overwrite.** If `.tiki/research/<topic>.md` already exists, read it and append a new section under a `## YYYY-MM-DD findings` heading rather than replacing the file. Extend the front-matter `issues` array if the current issue is not already listed.
7. Multiple research docs are fine if findings span distinct topics — write one file per coherent topic rather than a single grab-bag.
</research-capture>

<state-management>
**REQUIRED — run this FIRST, before analyzing the issue.** Record the `pending → reviewing` transition through the validated shim so the desktop pipeline advances to REVIEW immediately. Do NOT defer it to the end of the step or make it conditional on how this command was invoked — emit it unconditionally as the first action. The shim creates the `issue:{number}` entry if missing, updates status/`pipelineStep`/`lastActivity`, preserves `parentRelease`, and is a safe no-op if the step was already recorded.

```bash
node packages/framework/scripts/state.mjs transition issue:{number} \
  --to-status reviewing --to-step REVIEW --issue-number {number} --issue-title "{title}"
```
</state-management>

<errors>
  <error type="no-argument">
    No issue number provided. Please specify an issue number:
    ```
    /tiki:review 42
    ```
  </error>
  <error type="not-loaded">
    Issue #{number} not found in Tiki state. Fetching it first...
    (Then proceed to fetch and review)
  </error>
</errors>

<next-actions>
After presenting the review, offer these options:

1. **Plan issue** - Create execution phases based on this review (`/tiki:plan {number}`)
2. **Research first** - Deep dive into a specific topic (`/tiki:research {topic}`)
3. **Clarify requirements** - Ask questions about unclear items
4. **Update review** - Revise the analysis

Present using AskUserQuestion with:
- question: "Review complete. What would you like to do?"
- header: "Next step"
- options:
  - label: "Plan issue (Recommended)"
    description: "Create executable phases based on this review"
  - label: "Research first"
    description: "Deep dive into a technology or domain"
  - label: "Clarify requirements"
    description: "Ask questions about unclear requirements"
  - label: "Update review"
    description: "Revise the analysis with new information"
</next-actions>
