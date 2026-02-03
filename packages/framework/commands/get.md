---
name: get
description: Fetch and display a GitHub issue
argument: <issue-number>
tools: Bash, Read, Write, AskUserQuestion
---

# Get Issue

Fetch a GitHub issue and display it in a readable format. This is typically the first step in the Tiki workflow.

<instructions>
  <step>Parse the issue number from the argument. If no argument provided, ask the user for an issue number.</step>
  <step>Verify the GitHub CLI is authenticated by running `gh auth status`</step>
  <step>Fetch the issue using the GitHub CLI:
    ```bash
    gh issue view {number} --json number,title,body,state,labels,milestone,assignees,url
    ```
  </step>
  <step>Display the issue in the formatted output template below</step>
  <step>Initialize or update the Tiki state file (`.tiki/state.json`) to track this issue</step>
  <step>Offer next actions to the user via AskUserQuestion</step>
</instructions>

<state-management>
When getting an issue, update `.tiki/state.json`:

1. If the file doesn't exist, create it with the initial schema
2. Add or update the work entry with key `issue:{number}`
3. Set status to `pending` (issue fetched but not yet being worked on)

```json
{
  "schemaVersion": 1,
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "issue": {
        "number": {number},
        "title": "{title}",
        "url": "{url}"
      },
      "status": "pending",
      "pipelineStep": "GET",
      "createdAt": "{ISO timestamp}",
      "lastActivity": "{ISO timestamp}"
    }
  }
}
```
</state-management>

<output>
## Issue #{number}: {title}

**State:** {state}
**Labels:** {labels as comma-separated list, or "None"}
**Milestone:** {milestone or "None"}
**Assignees:** {assignees as comma-separated list, or "Unassigned"}
**URL:** {url}

---

### Description

{body}

---

*Issue loaded into Tiki. Ready for next step.*
</output>

<errors>
  <error type="no-argument">
    No issue number provided. Please specify an issue number:
    ```
    /tiki:get 42
    ```
  </error>
  <error type="not-found">
    Issue #{number} not found. Please check:
    - The issue number is correct
    - You have access to this repository
    - The repository has GitHub Issues enabled
  </error>
  <error type="no-gh-cli">
    GitHub CLI not found or not authenticated. Please run:
    ```bash
    gh auth login
    ```
  </error>
  <error type="no-repo">
    Not in a git repository or no remote configured. Please run this command from within a git repository that has a GitHub remote.
  </error>
</errors>

<next-actions>
After displaying the issue, offer these options:

1. **Review issue** - Analyze the issue before planning (`/tiki:review {number}`)
2. **Plan issue** - Break into executable phases (`/tiki:plan {number}`)
3. **Research first** - Research a topic before planning (`/tiki:research {topic}`)
4. **Get another issue** - Fetch a different issue

Present these using AskUserQuestion with:
- question: "What would you like to do next?"
- header: "Next step"
- options:
  - label: "Review issue"
    description: "Analyze requirements and complexity before planning"
  - label: "Plan issue"
    description: "Break the issue into executable phases"
  - label: "Research first"
    description: "Research a domain or technology before planning"
  - label: "Get another issue"
    description: "Fetch a different GitHub issue"
</next-actions>
