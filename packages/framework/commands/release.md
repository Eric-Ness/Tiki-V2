---
name: release
description: Execute a release - run all issues in dependency order, then tag and ship
argument: <version> [--dry-run] [--continue] [--no-tag] | status [version]
tools: Bash, Read, Write, Edit, Glob, Grep, Task, Skill
---

# Release Execution

Execute a multi-issue release pipeline. Loads a release definition, calculates issue dependency order, runs `/tiki:yolo` for each issue sequentially, then ships the release with a git tag.

<instructions>
  <step>**Parse arguments** to determine mode:
    - `release v1.2` - Execute release v1.2
    - `release v1.2 --dry-run` - Preview execution order
    - `release v1.2 --continue` - Resume interrupted release
    - `release status` - Show all release statuses
    - `release status v1.2` - Show specific release status
  </step>
  <step>**Load or create release definition** at `.tiki/releases/{version}.json`:
    - **If the file exists:** load it. Extract issue list and metadata. Check for linked milestone.
    - **If it does not exist:** create a minimal scaffold via the `Write` tool. (The framework cannot call `save_tiki_release` — that's a desktop-only Tauri IPC.) Derive the issue list in this order:
      1. From `--issues '147,148,149'` CLI flag if provided.
      2. From a matching GitHub milestone: `gh api repos/{owner}/{repo}/milestones --jq '.[] | select(.title=="{version}")'` — if present, use its issue list.
      3. If no `--issues` flag and no matching milestone, error with `release-not-found` (see <errors>). Releases must be defined either by CLI flag, GitHub milestone, or a pre-existing `.tiki/releases/{version}.json` (which the desktop app's Releases section creates).
    - Scaffold shape:
      ```json
      {
        "version": "{version}",
        "status": "active",
        "issues": [ { "number": 42, "title": "..." } ],
        "createdAt": "{ISO timestamp now}"
      }
      ```
    - Only error with `release-not-found` if all three derivation paths fail.
  </step>
  <step>**Fetch issue details** for dependency analysis:
    - For each issue in the release, fetch its body via `gh issue view`
    - Parse dependencies from issue bodies
  </step>
  <step>**Calculate dependency order** using topological sort:
    - Parse "depends on #N" patterns from issue bodies
    - Build dependency graph
    - Sort issues so dependencies execute first
    - Detect and report circular dependencies
  </step>
  <step>**Initialize state** in `.tiki/state.json`:
    - Create `release:{version}` work entry
    - Set status to `executing`
    - Initialize `currentIssue` and `completedIssues`
  </step>
  <step>**Execute issues by wave** (parallel dispatch via worktree sub-agents):
    - For each wave from the independence analysis:
      1. Update `release.currentIssues` in state (array of issue numbers in this wave).
      2. For each issue in the wave, spawn an Agent in parallel with:
         - description: `Run /tiki:yolo {N}`
         - subagent_type: `general-purpose`
         - isolation: `worktree`
         - prompt: `Run the /tiki:yolo {N} skill in this worktree. Report back the branch name, head SHA, and PR URL on completion. Pause and report any failure.`
      3. Wait for ALL Agents in the wave to return (block until all done).
      4. For each completed Agent, append the issue number to `release.completedIssues` and the worktree branch name to `release.completedBranches`.
      5. After the wave, in deterministic order (sort by issue number ascending), merge each completed branch into the main release branch via `git merge --no-ff origin/{branch-name}`. Abort the wave merge on the first conflict and surface the conflict to the user with both branches' names.
      6. Move to the next wave.

    **If any single Agent in a wave fails:**
    - Mark its issue as failed in state.
    - Wait for the OTHER Agents in the wave to finish (don't kill them — they may have produced useful work).
    - After the wave drains, pause the cascade and report which issue failed and where (worktree path, branch). Do not auto-continue.

    **Worktree merge order rule:** merge in ascending issue-number order within each wave. Deterministic across runs. If issues touch genuinely independent files (which they should — they're in the same wave because the analysis said no conflicts), order is just for reproducibility.

    **Failure modes:**
    1. **Agent reports phase failure** — that issue's worktree is left intact; user can `cd` into it to investigate. Wave continues until all Agents return; cascade then pauses.
    2. **Merge conflict during wave merge** — analysis missed a soft conflict. Abort the wave merge at the first conflict, leave the conflicting branches unmerged. Report the conflict path to the user and pause.
    3. **Worktree creation failure** (e.g. branch already exists from a prior run) — try `git worktree add -B {branch}` to force-recreate. If still failing, fall back to serial execution for that wave with a warning.

    Conservative default: when in doubt about independence, serialize.
  </step>
  <step>**Generate changelog** after all issues complete:
    - Read the release file from `.tiki/releases/{version}.json` to get issue list
    - For each issue, read `.tiki/plans/issue-{N}.json` to extract phase summaries
    - Run `git log --oneline` filtering for commits mentioning each issue number
    - Categorize changes by conventional commit prefix (feat/fix/refactor/docs/perf/chore)
    - Generate structured markdown changelog with issue references and links
    - Write to `.tiki/releases/{version}-changelog.md`
    - Write changelog to `.tiki/releases/{version}-changelog.md`. Continue directly to shipping — the file is committed to the repo (not just used for the GitHub Release body), so the user can amend it post-ship via a follow-up commit if needed.
    (See `<changelog-generation>` section for detailed format)
  </step>
  <step>**Ship the release** after changelog is approved:
    - Create and push git tag
    - Create GitHub release with changelog as body (`gh release create`)
    - Close GitHub milestone (if linked)
    - Archive release file
    - Update state history
  </step>
</instructions>

<dependency-parsing>
## Dependency Detection

Scan issue bodies for dependency declarations using these patterns:

**Supported patterns:**
- `depends on #42`
- `Depends on #42`
- `blocked by #42`
- `Blocked by #42`
- `requires #42`
- `after #42`

**Regex pattern:**
```
/(?:depends on|blocked by|requires|after)\s+#(\d+)/gi
```

**Example:**
```markdown
## Description
This feature adds user profiles.

Depends on #41 (authentication) and #43 (database schema).
```

Extracted dependencies: `[41, 43]`

**Dependency Resolution:**
1. Build adjacency list from all issues
2. Perform topological sort (Kahn's algorithm)
3. Issues with no dependencies execute first
4. If circular dependency detected, report error and halt

**Handling missing dependencies:**
- If a dependency is not in the release, warn but continue
- External dependencies are assumed to be satisfied
</dependency-parsing>

<independence-analysis>
## Independence Analysis

Before dispatching issues, compute which can run concurrently. Two signals:

### 1. Hard dependencies (already covered by <dependency-parsing>)

`depends on #N` / `blocked by #N` patterns force serial ordering. These are user-declared and authoritative.

### 2. Soft conflict heuristic (new)

For each issue, derive a likely-touched-files set from its body using these signals:

- **Explicit file paths** (e.g. `apps/desktop/src/components/Header.tsx`) — capture the path and its parent directory.
- **Component / area keywords** — map to directory globs:
  - `kanban` → `apps/desktop/src/components/sidebar/Kanban*` and `apps/desktop/src/stores/kanban*`
  - `terminal` → `apps/desktop/src/components/terminal/**` and `apps/desktop/src-tauri/src/terminal*`
  - `sidebar` → `apps/desktop/src/components/sidebar/**`
  - `footer` / `header` → `apps/desktop/src/components/Header.*`
  - `github API`, `gh CLI`, `rate limit` → `apps/desktop/src-tauri/src/github.rs`
  - `state.json`, `state shim`, `transition` → `.claude/tiki/scripts/state.mjs` and `apps/desktop/src-tauri/src/state*.rs`
  - `release.md`, `yolo.md`, `framework command` → `packages/framework/commands/**`
  - `detail panel`, `issue detail` → `apps/desktop/src/components/detail/**`
- **GitHub labels** — `desktop` widens scope to `apps/desktop/**`, `rust` narrows to `apps/desktop/src-tauri/**`, `framework` narrows to `packages/framework/**`.

Two issues **conflict** if their derived file sets share any path or directory at depth ≥ 1. When in doubt, mark conflicting (conservative default — false positives just serialize, false negatives cause merge conflicts).

### 3. Wave-based DAG

With hard deps + conflicts in hand, partition issues into **waves**:

- Wave 1: all issues with no unsatisfied hard deps AND no conflicts among themselves.
- Wave 2: all remaining issues whose hard deps are now satisfied AND no conflicts among themselves or with already-running issues.
- Repeat until all issues are placed.
- Cap each wave at 3 concurrent sub-agents (resource limit; configurable via `--max-parallel N` flag, default 3).

If two issues conflict but have no hard dep, place the larger one (more phases per its plan, if known) earlier so its scope is established before the smaller one rebases.

### 4. Output the analysis (narration, not blocking)

Before dispatching, print to chat:

```
## Execution Plan: {version}

Dependency edges: {count}
Conflict edges: {count}
Waves: {N}

Wave 1 (parallel): #{a}, #{b}, #{c}
  - #{a}: touches apps/desktop/src/components/Header.tsx (no conflicts)
  - #{b}: touches apps/desktop/src-tauri/src/github.rs (no conflicts)
  - #{c}: touches packages/framework/commands/release.md (no conflicts)
Wave 2 (parallel): #{d}, #{e}
  - #{d}: depends on #{a}; conflicts with #{e} on apps/desktop/src/components/sidebar/Kanban.tsx — placed first by phase count
  ...
```

This is informational. Do NOT prompt for confirmation. The user invoked the command — let them watch the analysis fly by; if it's wrong, they can interrupt and edit the release file.
</independence-analysis>

<release-flow>
```
/tiki:release v1.2
       |
       v
+----------------------------------+
| 1. Load .tiki/releases/v1.2.json |
| 2. Fetch issue bodies via gh CLI |
| 3. Parse dependencies            |
| 4. Topological sort              |
+----------------------------------+
       |
       v
+----------------------------------+
| 5. Initialize state.json         |
|    release:v1.2 = {              |
|      status: "executing",        |
|      currentIssue: null,         |
|      completedIssues: []         |
|    }                             |
+----------------------------------+
       |
       v
+----------------------------------+
| 6. For each issue in order:      |
|    +---------------------------+ |
|    | Update currentIssue       | |
|    | /tiki:yolo {issue}        |<-- Fresh context per issue
|    | (get->review->plan->      | |
|    |  audit->execute->ship)    | |
|    | Add to completedIssues    | |
|    +---------------------------+ |
+----------------------------------+
       |
       v
+----------------------------------+
| 7. Ship Release:                 |
|    - git tag v1.2 && git push    |<-- Triggers CI/CD
|    - Close GitHub milestone      |
|    - Archive release file        |
|    - Update state.json history   |
+----------------------------------+
       |
       v
     [DONE]
```
</release-flow>

<state-management>
Release lifecycle: **start** → **per-wave** → **ship**. See `yolo.md` `<state-management>` for the issue-side canonical shape.

Each lifecycle point starts with a `state.mjs journal` line (#272) — the drop-proof intent record: even if the transition after it is dropped, the reconciler reconstructs the release step from the journal. It never exits non-zero; emit it unconditionally, first.

```bash
# Start (cascade kickoff) — journal first, then transition:
node .claude/tiki/scripts/state.mjs journal release:{version} --step EXECUTE
node .claude/tiki/scripts/state.mjs transition release:{version} \
  --to-status executing --to-step EXECUTE --release-version {version} --release-issues "41,42,43"
# Per wave: update release.currentIssues (array; direct JSON write — shim does not edit nested release.* fields),
# spawn one Agent per issue with isolation: 'worktree', wait for the wave to drain, then
# append each completed issue number to release.completedIssues and each worktree branch
# name to release.completedBranches (also direct JSON writes).
# Ship (BEFORE tagging) — journal first, then transition:
node .claude/tiki/scripts/state.mjs journal release:{version} --step SHIP
node .claude/tiki/scripts/state.mjs transition release:{version} --to-status shipping --to-step SHIP
```

**Release state shape** (additive — `currentIssue` retained for back-compat with serial mode and is ignored when `currentIssues` is set):

```json
{
  "release": {
    "version": "{version}",
    "issues": [41, 42, 43],
    "currentIssue": null,        // legacy: serial mode only
    "currentIssues": [41, 42],   // new: array of issue numbers in the current wave
    "completedIssues": [],
    "completedBranches": []      // new: branch names from completed worktrees, in completion order
  }
}
```

Both `currentIssues` and `completedBranches` are direct-JSON nested edits. `state.mjs` does NOT need new flags — these follow the existing acknowledged exception for `release.currentIssue` (nested release.* fields are written directly to the JSON file by the framework command).

After shipping:

```bash
# Remove the release entry from activeWork:
node .claude/tiki/scripts/state.mjs remove release:{version}
# For EACH child issue with parentRelease == {version} (run the next two lines
# once per child): append it to history.recentIssues FIRST (so the desktop
# Kanban "Completed" column, which reads recentIssues, shows release-shipped
# issues — mirrors ship.md), THEN remove it from activeWork. append-history is
# idempotent on issue number, so this is safe even if ship.md already appended
# the child during the cascade.
node .claude/tiki/scripts/state.mjs append-history issue --number {number} --title "{issue title}"
node .claude/tiki/scripts/state.mjs remove issue:{number}
# Append the release completion record to history:
node .claude/tiki/scripts/state.mjs append-history release --version {version} --issues "41,42,43" --tag {version}
```

Then archive the release file: first set its `"status"` to `"shipped"` and add `"shipped": true` plus a `"completedAt"` ISO timestamp, then move it to `.tiki/releases/archive/` as a regular filesystem rename (no shim involvement — it's not a state.json mutation). Setting `status` matters: the desktop derives the "completed" badge from the archive LOCATION, but it falls back to the on-disk `status` if the location-derived `archived` flag is ever unavailable — leaving a stale `"status":"active"` in an archived file is the footgun that caused #258. Keep location and status in agreement.
</state-management>

<output>
## Release: {version}

### Configuration
**Version:** {version}
**Issues:** {count} issues
**Milestone:** {milestone or "None"}
**Flags:** {--dry-run, --continue, --no-tag if present}

### Dependency Order
| Order | Issue | Title | Dependencies |
|-------|-------|-------|--------------|
| 1 | #{N} | {title} | None |
| 2 | #{N} | {title} | #{dep1} |
| 3 | #{N} | {title} | #{dep1}, #{dep2} |

### Execution Progress

| Issue | Status | Duration |
|-------|--------|----------|
| #{N} {title} | {DONE/IN PROGRESS/PENDING/FAILED} | {time} |
| #{N} {title} | {DONE/IN PROGRESS/PENDING/FAILED} | {time} |

---

{During execution:}
### Currently Executing: Issue #{N}

{issue title}

Pipeline: GET -> REVIEW -> PLAN -> AUDIT -> EXECUTE -> SHIP
Current Step: {step}

---

{After all issues complete:}
### All Issues Complete

Ready to ship release {version}.

**Summary:**
- {count} issues completed
- {total changes} files changed
- Ready for tagging

---

{After shipping:}
### Release Shipped!

**Tag:** {version}
**Milestone:** {Closed | N/A}
**Archived:** .tiki/releases/archive/{version}.json

*Release {version} has been shipped successfully.*
</output>

<argument-parsing>
## Argument Parsing

Parse the command arguments to determine execution mode:

**Command patterns:**
```
/tiki:release <version>              # Execute release
/tiki:release <version> --dry-run    # Preview only
/tiki:release <version> --continue   # Resume interrupted
/tiki:release <version> --no-tag     # Skip git tag
/tiki:release status                 # Show all releases
/tiki:release status <version>       # Show specific release
```

**Flag definitions:**

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview execution order without running issues. Shows dependency graph and planned order. |
| `--continue` | Resume an interrupted release. Skips completed issues and continues from where it left off. |
| `--no-tag` | Complete release without creating a git tag. Useful for testing or when tag is managed externally. |

**Parsing logic:**
1. Split arguments on whitespace
2. First non-flag argument is either `status` or `<version>`
3. If `status`, check for optional version argument
4. Otherwise, extract version and collect flags
5. Validate version format matches release file naming

**Version validation:**
```
/^v?\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?$/
```
Supports: `v1.2`, `1.2`, `v1.2.3`, `v2.0.0-beta.1`
</argument-parsing>

<dry-run-mode>
## Dry Run Mode

When `--dry-run` is specified, preview the execution plan without making changes.

**Dry run behavior:**
1. Load release definition (same as normal)
2. Fetch issue details (same as normal)
3. Calculate dependency order (same as normal)
4. **STOP** - Do not initialize state or execute issues

**Dry run output:**
```
## Release: v1.2 (Dry Run)

### Configuration
**Version:** v1.2
**Issues:** 3 issues
**Milestone:** v1.2
**Mode:** DRY RUN - No changes will be made

### Dependency Analysis

**Issue #41: Add authentication**
- Dependencies: None
- Execution order: 1

**Issue #43: Add database schema**
- Dependencies: None
- Execution order: 2

**Issue #42: Add user profiles**
- Dependencies: #41, #43
- Execution order: 3

### Planned Execution Order

| Order | Issue | Title | Blocked By |
|-------|-------|-------|------------|
| 1 | #41 | Add authentication | - |
| 2 | #43 | Add database schema | - |
| 3 | #42 | Add user profiles | #41, #43 |

### Summary

**Total issues:** 3
**Estimated pipeline runs:** 3 (one /tiki:yolo per issue)
**Dependencies detected:** 2

---

*This is a dry run. No issues were executed.*
*Run `/tiki:release v1.2` to execute for real.*
```

**Dry run checks:**
- Validates all issues exist in GitHub
- Detects circular dependencies
- Warns about issues not in release that are listed as dependencies
- Shows estimated execution order
</dry-run-mode>

<resume-logic>
## Resume Logic (--continue)

When `--continue` is specified, resume an interrupted release from where it left off.

**Resume detection:**
1. Check `.tiki/state.json` for existing `release:{version}` entry
2. If found, extract `completedIssues` array
3. Skip issues already in `completedIssues`
4. Continue with next issue in dependency order

**Resume scenarios:**

**Scenario 1: Release partially complete**
```json
{
  "activeWork": {
    "release:v1.2": {
      "release": {
        "issues": [41, 42, 43],
        "currentIssue": 42,
        "completedIssues": [41]
      },
      "status": "executing"
    }
  }
}
```
Resume action: Skip #41, start with #42

**Scenario 2: Issue failed mid-execution**
```json
{
  "activeWork": {
    "release:v1.2": {
      "release": {
        "issues": [41, 42, 43],
        "currentIssue": 42,
        "completedIssues": [41]
      },
      "status": "failed",
      "error": {
        "message": "Phase 3 verification failed",
        "phase": 3,
        "issue": 42
      }
    }
  }
}
```
Resume action: Re-attempt issue #42 with `--continue` on the issue itself

**Scenario 3: No existing state**
```
No state found for release:v1.2
Starting fresh execution...
```
Resume action: Start from beginning (same as without --continue)

**Resume output:**
```
## Resuming Release: v1.2

**Previous progress found:**
- Completed: #41 (Add authentication)
- Failed/Interrupted: #42 (Add user profiles)
- Remaining: #43 (Add database schema)

**Resuming from issue #42...**
```

**State update on resume:**
- Set status back to `executing`
- Clear any error state
- Keep `completedIssues` intact
- Update `lastActivity` timestamp
</resume-logic>

<errors>
  <error type="no-argument">
    No version or subcommand provided. Usage:
    ```
    /tiki:release v1.2              # Execute release
    /tiki:release v1.2 --dry-run    # Preview execution
    /tiki:release v1.2 --continue   # Resume interrupted
    /tiki:release status            # Show all releases
    ```
  </error>
  <error type="release-not-found">
    Release file not found and no issue list could be derived: `.tiki/releases/{version}.json`

    `/tiki:release` will auto-create the file when invoked with one of:
    - `--issues '42,43,44'` flag listing issue numbers
    - A matching GitHub milestone titled `{version}` containing at least one issue
    - An interactive issue list provided when prompted

    If none of the above is available, create the file manually:
    1. Use the desktop app's Releases section, or
    2. Write the file directly with this structure:
    ```json
    {
      "version": "{version}",
      "status": "active",
      "issues": [
        { "number": 42, "title": "Issue title" }
      ],
      "createdAt": "2026-02-03T10:00:00.000Z"
    }
    ```
  </error>
  <error type="no-issues">
    Release {version} has no issues defined.

    Add issues to the release via the desktop app or edit the release file directly.
  </error>
  <error type="all-complete">
    All issues in release {version} are already complete.

    **Completed issues:**
    {list of completed issues}

    To re-execute, remove the release from state:
    1. Edit `.tiki/state.json`
    2. Remove the `release:{version}` entry from `activeWork`
    3. Run `/tiki:release {version}` again
  </error>
  <error type="circular-dependency">
    Circular dependency detected in release {version}:

    {dependency cycle visualization}

    Example: #41 -> #42 -> #43 -> #41

    Please resolve the circular dependency by:
    1. Removing one of the dependency declarations
    2. Or splitting into multiple releases
  </error>
  <error type="issue-not-found">
    Issue #{number} referenced in release but not found in GitHub.

    Options:
    - Remove issue from release
    - Create the missing issue
    - Check if issue number is correct
  </error>
  <error type="invalid-flags">
    Invalid flag combination: {flags}

    `--dry-run` cannot be combined with `--continue`.
    Use one or the other.
  </error>
  <error type="no-state-to-resume">
    No interrupted release found for {version}.

    The release either:
    - Has not been started yet
    - Has already completed

    Run without `--continue` to start fresh:
    ```
    /tiki:release {version}
    ```
  </error>
  <error type="tag-exists">
    Git tag {version} already exists.

    Options:
    - Delete existing tag: `git tag -d {version} && git push origin :refs/tags/{version}`
    - Use a different version
    - Use `--no-tag` to skip tagging
  </error>
  <error type="push-failed">
    Failed to push tag to remote:
    {error message}

    Common causes:
    - No push permission
    - Network error
    - Protected tag rules

    Try pushing manually: `git push origin {version}`
  </error>
  <error type="milestone-not-found">
    GitHub milestone "{milestone}" not found.

    The release will complete but the milestone won't be closed.
    You can close it manually via GitHub UI.
  </error>
</errors>

<status-subcommand>
## Status Subcommand

Show release status information.

**Commands:**
- `/tiki:release status` - Show all releases
- `/tiki:release status v1.2` - Show specific release

**All releases output:**
```
## Release Status

### Active Releases

| Version | Status | Progress | Current Issue |
|---------|--------|----------|---------------|
| v1.2 | executing | 2/5 issues | #43 |
| v1.3 | pending | 0/3 issues | - |

### Recent Releases

| Version | Completed | Issues |
|---------|-----------|--------|
| v1.1 | 2026-02-01 | 4 issues |
| v1.0 | 2026-01-15 | 6 issues |

---

*Use `/tiki:release status <version>` for details.*
```

**Specific release output:**
```
## Release Status: v1.2

**Version:** v1.2
**Status:** executing
**Milestone:** v1.2 (open)
**Created:** 2026-02-03T10:00:00Z

### Issues (3 total)

| # | Title | Status | Completed |
|---|-------|--------|-----------|
| #41 | Add authentication | DONE | 2026-02-03T10:30:00Z |
| #42 | Add user profiles | IN PROGRESS | - |
| #43 | Add settings page | PENDING | - |

### Progress

**Completed:** 1 of 3 (33%)
**Current:** #42 (Add user profiles)
**Remaining:** 2 issues

### Dependency Graph

```
#41 (auth) ──┐
             ├──> #42 (profiles)
#43 (settings)
```

---

*Resume with `/tiki:release v1.2 --continue`*
```

**Status detection:**
1. Check `.tiki/state.json` for active `release:{version}` entries
2. Scan `.tiki/releases/*.json` for release definitions
3. Check `.tiki/releases/archive/` for completed releases
4. Cross-reference to build complete status picture
</status-subcommand>

<changelog-generation>
## Changelog Generation

Generate a structured changelog before shipping the release.

**Step 1: Gather data**

For each issue in the release:
1. Read plan file: `.tiki/plans/issue-{N}.json`
   - Extract phase titles and `summary` fields from completed phases
2. Run git log for commits related to the issue:
   ```bash
   git log --oneline --grep="#{N}" --grep="issue-{N}" --all-match
   ```
   Also check for commits with conventional commit prefixes mentioning the issue.

**Step 2: Categorize changes**

Map each issue to a changelog category based on its commits or labels:

| Commit Prefix | Changelog Category |
|---------------|-------------------|
| `feat:` | Features |
| `fix:` | Bug Fixes |
| `refactor:` | Refactoring |
| `docs:` | Documentation |
| `perf:` | Performance |
| `chore:`, `test:`, other | Other Changes |

If an issue has multiple commit types, use the most prominent one.
If no conventional commits found, categorize by issue labels:
- `enhancement` -> Features
- `bug` -> Bug Fixes
- Otherwise -> Other Changes

**Step 3: Generate changelog markdown**

```markdown
# {version}

## Features
- {Issue title} (#{number}) - {brief summary from phase summaries}

## Bug Fixes
- {Issue title} (#{number}) - {brief summary}

## Refactoring
- {Issue title} (#{number}) - {brief summary}

## Other Changes
- {Issue title} (#{number}) - {brief summary}

**Full Changelog**: https://github.com/{owner}/{repo}/compare/{previous_tag}...{version}
```

Omit empty categories. Determine `{previous_tag}` with:
```bash
git describe --tags --abbrev=0 HEAD
```

**Step 4: Check for custom config**

If `.tiki/config.json` exists with a `changelog` section, apply customizations:
```json
{
  "changelog": {
    "template": ".tiki/changelog-template.md",
    "categories": {
      "feat": "New Features",
      "fix": "Bug Fixes",
      "refactor": "Code Improvements",
      "default": "Other Changes"
    },
    "includeCommitHashes": false,
    "includeAuthors": false
  }
}
```

If `template` path is specified and exists, use it with these placeholders:
`{{version}}`, `{{date}}`, `{{features}}`, `{{fixes}}`, `{{refactoring}}`, `{{other}}`, `{{full_changelog_url}}`

If custom `categories` are specified, use those display names instead of defaults.

**Step 5: Write and review**

1. Write the changelog to `.tiki/releases/{version}-changelog.md`
2. Continue directly to shipping. The changelog is now in the repo and travels with the release commit; downstream edits land via the normal commit/PR flow.
</changelog-generation>

<release-shipping>
## Release Shipping

After all issues complete and changelog is approved, ship the release:

**Shipping steps:**

1. **Verify completion**
   - All issues in `completedIssues`
   - No failed issues
   - All issue branches merged

2. **Back up state before destructive changes**
   ```bash
   mkdir -p .tiki/backups
   cp .tiki/state.json ".tiki/backups/state.$(date -u +%Y-%m-%dT%H-%M-%S).json"
   ```

   **Release-readiness gate (#265) — REQUIRED, run AFTER version-bump + changelog, BEFORE tagging:**
   ```bash
   node scripts/check-release-readiness.mjs {version}
   ```
   If this exits non-zero, **HALT** — do NOT tag or push. The gate verifies every release issue has an archived + `audited` plan and is in `history.recentIssues`, version parity across the 5 version files, a `{version}-changelog.md`, and zero reconcile drift. Surface the failures, fix them, and re-run. (CI also runs this gate in `release.yml`'s pre-deploy job, so a release that skips it locally still cannot build installers.)

3. **Create git tag**
   ```bash
   git tag -a {version} -m "Release {version}"
   git push origin {version}
   ```
   Skip if `--no-tag` flag was provided.

4. **Create GitHub release with changelog**
   ```bash
   gh release create {version} --title "{version}" \
     --notes-file .tiki/releases/{version}-changelog.md
   ```
   If a release already exists for the tag:
   ```bash
   gh release edit {version} \
     --notes-file .tiki/releases/{version}-changelog.md
   ```

5. **Close GitHub milestone** (if linked)
   ```bash
   gh api repos/{owner}/{repo}/milestones/{milestone_number} \
     -X PATCH -f state=closed
   ```
   Find milestone number first:
   ```bash
   gh api repos/{owner}/{repo}/milestones \
     --jq '.[] | select(.title=="{milestone}") | .number'
   ```

6. **Archive release file**
   - Create `.tiki/releases/archive/` if needed
   - Set the file's `"status"` to `"shipped"` (do NOT leave it `"active"` — the desktop
     falls back to this field for the completed badge if the location-derived `archived`
     flag is unavailable; a stale `"active"` here is the #258 footgun)
   - Add `completedAt` and `shipped: true` to archived file
   - Move `.tiki/releases/{version}.json` to archive

7. **Prune wave worktrees** — after the tag is pushed and state finalized, remove all per-issue worktrees created during wave dispatch:
   ```bash
   for branch in $(jq -r '.completedBranches[]?' .tiki/releases/{version}.json 2>/dev/null); do
     git worktree remove --force ".git/worktrees/release-{version}-issue-${branch##*-}" 2>/dev/null || true
   done
   ```
   Worktrees may also be enumerated via `git worktree list --porcelain | grep release-{version}-issue-` and removed individually. Pruning is best-effort — a leftover worktree is recoverable via `git worktree prune`.

8. **Update state.json**
   - Remove `release:{version}` from `activeWork`
   - Remove ALL child `issue:N` entries from `activeWork` where `parentRelease` matches this release version
   - Add to `history.recentReleases`:
   ```json
   {
     "history": {
       "recentReleases": [
         {
           "version": "v1.2",
           "issues": [41, 42, 43],
           "completedAt": "2026-02-03T12:00:00.000Z",
           "tag": "v1.2"
         }
       ]
     }
   }
   ```

**Shipping output:**
```
## Shipping Release: v1.2

### Pre-Ship Verification

| Check | Status |
|-------|--------|
| All issues complete | PASS (3/3) |
| No failed issues | PASS |
| Changelog generated | PASS |
| Git working tree clean | PASS |

### Shipping...

- [x] Backing up state.json...
- [x] Creating git tag v1.2...
- [x] Pushing tag to origin...
- [x] Creating GitHub release with changelog...
- [x] Closing milestone "v1.2"...
- [x] Archiving release file...
- [x] Updating state...

### Release Shipped!

**Tag:** v1.2
**Commit:** abc1234
**Milestone:** Closed
**GitHub Release:** https://github.com/{owner}/{repo}/releases/tag/v1.2
**Archived:** .tiki/releases/archive/v1.2.json

**Issues shipped:**
- #41: Add authentication
- #42: Add user profiles
- #43: Add settings page

---

*Release v1.2 has been shipped successfully!*
```
</release-shipping>

<post-actions>
## After successful execution (all issues complete)

Proceed automatically to changelog generation, pre-tag verification, tag, and ship. No user confirmation required.

## After successful shipping

Report the shipped tag and links. End the cascade. The user can run `/tiki:release status` later to see history; that's an explicit, separate command — not a follow-up prompt.

## After issue failure

Pause and report the failure (which step, which issue, what verification failed). Do NOT prompt for next-action — wait for the user to read the error and decide. They can:
- Re-invoke `/tiki:release {version} --continue` after fixing
- Manually run `/tiki:yolo {failed-issue}` to retry just that one
- Investigate via `/tiki:get`, `/tiki:plan`, etc.

This is the only acceptable pause — diagnostic, not ceremonial.

## After paused (interrupted) state

Same as failure: report the state (`{completed}/{total} issues complete`, last successful issue, currently paused issue). Do NOT prompt — exit and let the user decide.
</post-actions>
