---
topic: github-api
tags: [github, api, integration]
issues: []
created: 2026-05-08T00:00:00.000Z
---

# GitHub API access in Tiki V2

Tiki V2 talks to GitHub exclusively through the `gh` CLI rather than the REST/GraphQL APIs directly. This avoids managing tokens in the framework code and reuses whatever authentication the user has already set up.

## Common patterns

- **Fetching an issue:** `gh issue view <N> --json number,title,body,state,labels,milestone,assignees,url,createdAt,updatedAt`. The `--json` flag returns a stable JSON shape that the framework commands parse directly.
- **Auth check:** `gh auth status` is run defensively at the start of any command that hits GitHub. If it fails, surface the `no-gh-cli` error rather than letting the underlying call fail with a less helpful message.
- **PR creation:** `gh pr create --title "..." --body "..."` from within the worktree; the active branch is used as the PR source.

## Gotchas

- On Windows, paths inside `gh` invocations should be quoted; the framework wraps them in double quotes when constructing commands from the Bash tool.
- `gh issue view` returns the issue body with `\r\n` line endings on Windows — strip them before parsing markdown.
