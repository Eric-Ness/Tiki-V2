---
name: research
description: Capture domain knowledge or findings into a research document
argument: <topic>
tools: Bash, Read, Write, Glob, AskUserQuestion
---

# Research Topic

Capture domain knowledge, architecture findings, API conventions, or any non-trivial learning into a `.tiki/research/<topic>.md` document. Research docs are surfaced automatically during planning and execution to give Claude (and sub-agents) the context they need.

<instructions>
  <step>Parse the arguments:
    - First positional argument is the **topic slug** (required, kebab-case, e.g. `github-api`, `auth-flow`).
    - Optional `--issue N` flag attaches the doc to a specific GitHub issue (sets the `issues` field to `[N]`).
    - If no topic is provided, ask the user via AskUserQuestion (or surface the no-argument error below).
  </step>
  <step>Validate the topic slug:
    - Must be lowercase kebab-case (letters, digits, hyphens only).
    - Must not contain `/` or `..` (path-traversal guard).
    - Surface the `invalid-topic-slug` error if it fails validation.
  </step>
  <step>Determine the body content:
    - If content was piped in (e.g. via stdin or a prior message), use it verbatim.
    - Otherwise, use the conversation context: Claude already knows what the user wants captured from prior messages, so write the doc directly.
    - If the topic is genuinely ambiguous, ask the user a single clarifying question before writing.
  </step>
  <step>Infer tags:
    - Pick 2-5 short tags reflecting the topic (e.g. `[github, api, integration]`, `[auth, security]`, `[tauri, ipc]`).
    - If unclear, ask the user via AskUserQuestion.
  </step>
  <step>Check for an existing doc at `.tiki/research/<topic>.md`:
    - If it exists, read it and present an AskUserQuestion offering **Merge** (append a new `## YYYY-MM-DD findings` section to the existing body, preserving the original front-matter — but extend `issues` and `tags` arrays with new values, and update `created` only if missing) vs. **Overwrite** (replace the file entirely) vs. **Cancel**.
    - If it does not exist, proceed to write a fresh file.
  </step>
  <step>Write `.tiki/research/<topic>.md` with the front-matter schema below, then the markdown body. Create the `.tiki/research/` directory if it does not exist.</step>
  <step>Confirm to the user with the path and a one-line summary.</step>
</instructions>

<front-matter-schema>
Every research doc starts with this YAML front-matter block:

```yaml
---
topic: <kebab-case-slug>
tags: [tag1, tag2, tag3]
issues: [42, 87]
created: <ISO 8601 timestamp>
---
```

Field rules:
- `topic`: same as the filename slug (without `.md`).
- `tags`: a JSON-style array of short lowercase strings.
- `issues`: a JSON-style array of integer issue numbers. Empty (`[]`) if not tied to a specific issue.
- `created`: ISO 8601 timestamp at write time, e.g. `2026-05-08T17:42:00.000Z`.

After the closing `---` delimiter, the rest of the file is free-form markdown.
</front-matter-schema>

<output>
## Research Captured: {topic}

**File:** `.tiki/research/{topic}.md`
**Tags:** {tag1, tag2, ...}
**Issues:** {[N] or "none"}

---

{First ~80 chars of the body as a preview...}

---

*Research saved. It will surface automatically during `/tiki:plan` and `/tiki:execute` when relevant.*
</output>

<example-output>
For `/tiki:research github-api --issue 102`:

## Research Captured: github-api

**File:** `.tiki/research/github-api.md`
**Tags:** github, api, integration
**Issues:** [102]

---

This codebase uses the `gh` CLI for all GitHub Issue and PR access. Auth is checked via `gh auth status`...

---

*Research saved. It will surface automatically during `/tiki:plan` and `/tiki:execute` when relevant.*
</example-output>

<errors>
  <error type="no-argument">
    No topic provided. Please specify a topic slug:
    ```
    /tiki:research github-api
    /tiki:research auth-flow --issue 42
    ```
  </error>
  <error type="invalid-topic-slug">
    Topic slug "{topic}" is invalid. Must be lowercase kebab-case (letters, digits, hyphens only) and must not contain `/` or `..`. Examples: `github-api`, `auth-flow`, `tauri-ipc`.
  </error>
  <error type="write-failed">
    Failed to write `.tiki/research/{topic}.md`: {error message}. Check that the working directory is writable and that `.tiki/` exists.
  </error>
</errors>

<next-actions>
After saving the research doc, offer these options:

1. **Plan the linked issue** - Continue with planning (`/tiki:plan {N}`) — only if `--issue N` was given.
2. **Capture another topic** - Run `/tiki:research <other-topic>` again.
3. **View the doc** - Open the new file for review.
4. **Done** - Return to the previous workflow step.

Present using AskUserQuestion with:
- question: "Research saved. What's next?"
- header: "Next step"
- options:
  - label: "Plan linked issue"
    description: "Continue with /tiki:plan for the attached issue"
  - label: "Capture another topic"
    description: "Run /tiki:research again with a different topic"
  - label: "View the doc"
    description: "Open the new research file"
  - label: "Done"
    description: "Return to the previous step"
</next-actions>
