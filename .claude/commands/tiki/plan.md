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
  <step>**Retrieve relevant research** from `.tiki/research/` before designing phases (see `<research-retrieval>` below). Surface findings under a `## Research Context` heading in the planning output.</step>
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

<research-retrieval>
**Before designing phases, check `.tiki/research/` for relevant prior findings.** This step grounds planning in knowledge captured by earlier `/tiki:review`, `/tiki:plan`, and `/tiki:research` runs.

Procedure:

1. **List** files matching `.tiki/research/*.md` using the Glob tool. If the directory does not exist or is empty, **skip silently** — no error, no output.
2. **Read the front-matter** of each file (just the YAML lines between the first two `---` delimiters — you do not need the body yet). Extract `topic`, `tags`, and `issues`.
3. **Determine relevance** for the current issue. A doc is relevant if any of these are true:
   - The doc's `issues` array contains the current issue number `{number}`.
   - The doc's `issues` array contains an issue number that is referenced in this issue's body or labels (e.g. "depends on #87").
   - One or more of the doc's `tags` matches a label, file path, technology, or domain term from the issue.
   - The `topic` slug clearly relates to the issue's subject matter.
4. **Read the full body** of each relevant doc.
5. **Surface findings** in a `## Research Context` block in the planning output, before phase design begins. List each relevant doc by topic with a 1-2 sentence takeaway, and quote any constraint that should shape phase boundaries.
6. **Use the findings** when defining phases — especially to avoid re-discovering known constraints, to honor existing patterns, and to set realistic verification criteria.

If no relevant docs are found, proceed without a Research Context block (do not output an empty heading).
</research-retrieval>

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

<research-capture>
**As a side-effect of PLAN, capture planning-relevant constraints discovered while designing phases.**

While exploring the codebase to design phase boundaries, you likely uncovered constraints that future plans (or future runs of this same plan) will benefit from — phase ordering rules, build-step dependencies, schema migration gotchas, framework command mirror requirements, "this must happen before that" knowledge, etc. Persist these by writing one or more research docs to `.tiki/research/<topic>.md`.

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
1. **Topic slug** is kebab-case derived from the constraint or pattern (e.g. `mirror-sync`, `phase-ordering`, `cargo-check-windows`).
2. **Tags** are 2-5 short lowercase strings reflecting the categorization (planning, build, schema, etc.).
3. **Issues** array includes the current issue number `[{number}]`.
4. **Created** is the current ISO 8601 timestamp.
5. **Skip** writing if the plan was straightforward and surfaced no constraints worth preserving — a trivial 2-phase plan that just edits one component does not need a research doc. Quality > quantity.
6. **Append, do not overwrite.** If `.tiki/research/<topic>.md` already exists, read it and append a new section under a `## YYYY-MM-DD findings` heading rather than replacing the file. Extend the front-matter `issues` array if the current issue is not already listed.
7. Focus on **planning-relevant** knowledge here — REVIEW captures domain understanding, PLAN captures the constraints that shaped phase boundaries.
</research-capture>

<early-state-update>
**REQUIRED — run this FIRST, before designing any phases.** Set the `issue:{number}` entry to `status: "planning"`, `pipelineStep: "PLAN"` so the desktop pipeline advances to PLAN immediately. Emit it unconditionally as the first action regardless of how this command was invoked; it is a safe no-op if already recorded (shim; see `yolo.md` for the legacy direct-write shape):

```bash
node packages/framework/scripts/state.mjs transition issue:{number} \
  --to-status planning --to-step PLAN --issue-number {number} --issue-title "{title}"
```
</early-state-update>

<plan-file-format>
**IMPORTANT:** The plan JSON file MUST use these exact field names. Do NOT use alternatives.

```json
{
  "schemaVersion": 1,
  "issue": {
    "number": 42,
    "title": "Issue title here",
    "url": "https://github.com/owner/repo/issues/42"
  },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "successCriteria": [
    {
      "id": "SC1",
      "category": "functionality",
      "description": "What must be true for success"
    }
  ],
  "phases": [
    {
      "number": 1,
      "title": "Phase title",
      "status": "pending",
      "content": "Detailed instructions for this phase...",
      "verification": [
        "Specific check 1",
        "Specific check 2"
      ],
      "addressesCriteria": ["SC1"],
      "files": ["path/to/file.ts"]
    }
  ],
  "coverageMatrix": {
    "SC1": [1, 2]
  }
}
```

**Field name rules:**
- Use `issue` object (NOT `issueNumber` as a bare number)
- Use `number` for phase number (NOT `id`)
- Use `title` for phase title (NOT `name`)
- Use `content` for phase body (NOT `description`)
- Use `verification` as an **array of strings** (NOT a single string)
- Use `addressesCriteria` (NOT `addresses_criteria`)
</plan-file-format>

<state-management>
After writing the plan, set phase progress (`current: 1`, `total: N`, `status: "pending"`). Keep work `status: "planning"` until audit passes.

```bash
node packages/framework/scripts/state.mjs transition issue:{number} \
  --to-status planning --to-step PLAN --phase-current 1 --phase-total {total} --phase-status pending
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
