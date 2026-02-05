---
name: plan
description: Break a GitHub issue into executable phases
argument: <issue-number>
tools: Bash, Read, Write, Glob, Grep, AskUserQuestion
---

# Plan Issue

Break a GitHub issue into a sequence of executable phases. Each phase should be small enough to execute with fresh context while maintaining progress toward the success criteria.

<instructions>
  <step>Load the issue and any existing review from state:
    - Check `.tiki/state.json` for `issue:{number}`
    - If the issue is NOT in state.json, fetch it via `gh issue view {number} --json number,title,body,state,url,labels,createdAt,updatedAt` and create the activeWork entry
    - If review was done, use its success criteria and complexity assessment
    - If no review exists, perform a quick analysis first
  </step>
  <step>**Immediately** update `.tiki/state.json` to set `status: "planning"` and `pipelineStep: "PLAN"` so the issue appears in Active Work right away (see early-state-update below)</step>
  <step>Design phases following the planning principles below</step>
  <step>For each phase, define:
    - Clear title and description
    - Specific files to create or modify
    - Verification criteria (how to know it's done)
    - Which success criteria it addresses
    - Dependencies on other phases (if any)
  </step>
  <step>Build a coverage matrix ensuring all success criteria are addressed</step>
  <step>Write the plan to `.tiki/plans/issue-{number}.json`</step>
  <step>Present the plan summary and ask for approval</step>
</instructions>

<planning-principles>
**Phase Size:**
- Each phase should be completable in a single focused session
- Aim for 1-3 files per phase maximum
- Prefer smaller phases over larger ones
- A sub-agent should be able to execute it with minimal context

**Phase Independence:**
- Each phase should produce a working (if incomplete) state
- Avoid phases that leave the codebase broken
- Tests should pass after each phase (if applicable)

**Phase Ordering:**
- Foundation first: types, interfaces, schemas
- Core logic second: main functionality
- Integration third: connecting pieces
- Polish last: error handling, edge cases, docs

**Verification:**
- Every phase needs clear "done" criteria
- Prefer automated verification (tests, type checks, builds)
- Manual verification only when necessary
</planning-principles>

<phase-template>
For each phase, capture:

```json
{
  "number": 1,
  "title": "Short descriptive title",
  "status": "pending",
  "content": "Detailed instructions for what to do in this phase...",
  "verification": [
    "Specific check 1",
    "Specific check 2"
  ],
  "addressesCriteria": ["SC1", "SC2"],
  "files": [
    "path/to/file1.ts",
    "path/to/file2.ts"
  ],
  "dependencies": []
}
```
</phase-template>

<output>
## Plan: Issue #{number}

### Overview
**Issue:** {title}
**Complexity:** {Low | Medium | High}
**Total Phases:** {count}

### Success Criteria Coverage
| Criterion | Phases |
|-----------|--------|
| SC1: {description} | {phase numbers} |
| SC2: {description} | {phase numbers} |
| ... | ... |

### Phases

#### Phase 1: {title}
**Files:** {file list}
**Addresses:** {criteria IDs}

{Brief description of what this phase accomplishes}

**Verification:**
- [ ] {check 1}
- [ ] {check 2}

---

#### Phase 2: {title}
...

---

*Plan written to `.tiki/plans/issue-{number}.json`*
</output>

<early-state-update>
**Before doing any planning work**, update `.tiki/state.json` so the issue appears in Active Work immediately:

1. Read the current `.tiki/state.json` (create it if it doesn't exist with `schemaVersion: 1, activeWork: {}, history: {}`)
2. Add or update the `issue:{number}` entry in `activeWork`:

```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "issue": {
        "number": {number},
        "title": "{title}",
        "url": "{url}",
        "state": "{state}",
        "labels": [{labels}],
        "createdAt": "{issue createdAt}",
        "updatedAt": "{issue updatedAt}"
      },
      "status": "planning",
      "pipelineStep": "PLAN",
      "createdAt": "{existing createdAt or new ISO timestamp}",
      "lastActivity": "{ISO timestamp}"
    }
  }
}
```

This ensures the desktop app shows the issue in the Active Work panel as soon as planning begins.
</early-state-update>

<state-management>
After the plan is fully written:

1. Write plan file to `.tiki/plans/issue-{number}.json`:
```json
{
  "schemaVersion": 1,
  "issue": {
    "number": {number},
    "title": "{title}",
    "url": "{url}"
  },
  "createdAt": "{ISO timestamp}",
  "successCriteria": [...],
  "phases": [...],
  "coverageMatrix": {...}
}
```

2. Update `.tiki/state.json` again with phase info:
- Set `phase.total` to the number of phases
- Set `phase.current` to 1
- Set `phase.status` to `pending`
- Keep `status` as `planning` until audit passes

```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "status": "planning",
      "pipelineStep": "PLAN",
      "phase": {
        "current": 1,
        "total": {total phases},
        "status": "pending"
      },
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
    /tiki:plan 42
    ```
  </error>
  <error type="not-found">
    Issue #{number} not found on GitHub. Please check:
    - The issue number is correct
    - You have access to this repository
  </error>
  <error type="no-requirements">
    Cannot create a plan without clear requirements. Please either:
    - Add more detail to the GitHub issue
    - Run `/tiki:review {number}` to analyze the issue first
  </error>
</errors>

<next-actions>
After presenting the plan, offer these options:

1. **Audit plan** - Validate the plan before execution (`/tiki:audit {number}`)
2. **Edit plan** - Modify phases or criteria
3. **Execute now** - Skip audit and start execution (`/tiki:execute {number}`)
4. **Start over** - Discard plan and re-review

Present using AskUserQuestion with:
- question: "Plan created. What would you like to do?"
- header: "Next step"
- options:
  - label: "Audit plan (Recommended)"
    description: "Validate the plan before execution"
  - label: "Edit plan"
    description: "Modify phases, criteria, or dependencies"
  - label: "Execute now"
    description: "Skip audit and start phase execution"
  - label: "Start over"
    description: "Discard this plan and re-analyze the issue"
</next-actions>
