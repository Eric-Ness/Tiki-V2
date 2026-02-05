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

<state-management>
Update `.tiki/state.json` after review:
- Change status from `pending` to `reviewing`
- Set `pipelineStep` to `"REVIEW"`
- Update `lastActivity` timestamp

```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "status": "reviewing",
      "pipelineStep": "REVIEW",
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
