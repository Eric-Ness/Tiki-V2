---
name: release
description: Execute a release - run all issues in dependency order, then tag and ship
argument: <version> [--dry-run] [--continue] [--no-tag] | status [version]
tools: Bash, Read, Write, Edit, Glob, Grep, Task, Skill, AskUserQuestion
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
  <step>**Load release definition** from `.tiki/releases/{version}.json`:
    - Validate the file exists
    - Extract issue list and metadata
    - Check for linked milestone
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
  <step>**Execute issues sequentially**:
    - For each issue in dependency order:
      1. Update `currentIssue` in state
      2. Call `/tiki:yolo {issue}` via Skill tool
      3. Wait for completion
      4. Add to `completedIssues`
      5. Continue to next issue
    - If an issue fails, pause and offer recovery options
  </step>
  <step>**Ship the release** after all issues complete:
    - Create and push git tag
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
## State Management

When starting a release, create the work entry in `.tiki/state.json`:

```json
{
  "activeWork": {
    "release:v1.2": {
      "type": "release",
      "release": {
        "version": "v1.2",
        "issues": [41, 42, 43],
        "currentIssue": null,
        "completedIssues": [],
        "milestone": "v1.2"
      },
      "status": "executing",
      "pipelineStep": "EXECUTE",
      "createdAt": "2026-02-03T10:00:00.000Z",
      "lastActivity": "2026-02-03T10:00:00.000Z"
    }
  }
}
```

**During execution**, update as each issue progresses. Note: each child issue also gets its own `issue:N` entry in `activeWork` (created by `/tiki:yolo` with `parentRelease` set via automatic detection):

```json
{
  "activeWork": {
    "release:v1.2": {
      "type": "release",
      "release": {
        "version": "v1.2",
        "issues": [41, 42, 43],
        "currentIssue": 42,
        "completedIssues": [41],
        "milestone": "v1.2"
      },
      "status": "executing",
      "pipelineStep": "EXECUTE",
      "createdAt": "2026-02-03T10:00:00.000Z",
      "lastActivity": "2026-02-03T10:30:00.000Z"
    },
    "issue:41": {
      "type": "issue",
      "issue": { "number": 41, "title": "Add authentication" },
      "status": "completed",
      "pipelineStep": "SHIP",
      "parentRelease": "v1.2",
      "createdAt": "2026-02-03T10:00:00.000Z",
      "lastActivity": "2026-02-03T10:20:00.000Z"
    },
    "issue:42": {
      "type": "issue",
      "issue": { "number": 42, "title": "Add user profiles" },
      "status": "executing",
      "pipelineStep": "EXECUTE",
      "parentRelease": "v1.2",
      "phase": { "current": 2, "total": 3, "status": "executing" },
      "createdAt": "2026-02-03T10:20:00.000Z",
      "lastActivity": "2026-02-03T10:30:00.000Z"
    }
  }
}
```

**After all issues complete**, transition to shipping:

```json
{
  "activeWork": {
    "release:v1.2": {
      "type": "release",
      "release": {
        "version": "v1.2",
        "issues": [41, 42, 43],
        "currentIssue": null,
        "completedIssues": [41, 42, 43],
        "milestone": "v1.2"
      },
      "status": "shipping",
      "pipelineStep": "SHIP",
      "lastActivity": "2026-02-03T11:00:00.000Z"
    },
    "issue:41": { "type": "issue", "status": "completed", "parentRelease": "v1.2", "..." : "..." },
    "issue:42": { "type": "issue", "status": "completed", "parentRelease": "v1.2", "..." : "..." },
    "issue:43": { "type": "issue", "status": "completed", "parentRelease": "v1.2", "..." : "..." }
  }
}
```

**After shipping completes**:
1. Remove `release:{version}` from `activeWork`
2. Remove ALL child `issue:N` entries from `activeWork` where `parentRelease` matches this release version
3. Add to `history.recentReleases`
4. Archive release file to `.tiki/releases/archive/`
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
    Release file not found: `.tiki/releases/{version}.json`

    To create a release:
    1. Use the desktop app's Releases section
    2. Or create the file manually with this structure:
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

<release-shipping>
## Release Shipping

After all issues complete, ship the release:

**Shipping steps:**

1. **Verify completion**
   - All issues in `completedIssues`
   - No failed issues
   - All issue branches merged

2. **Create git tag**
   ```bash
   git tag -a {version} -m "Release {version}"
   git push origin {version}
   ```
   Skip if `--no-tag` flag was provided.

3. **Close GitHub milestone** (if linked)
   ```bash
   gh api repos/{owner}/{repo}/milestones/{milestone_number} \
     -X PATCH -f state=closed
   ```
   Find milestone number first:
   ```bash
   gh api repos/{owner}/{repo}/milestones \
     --jq '.[] | select(.title=="{milestone}") | .number'
   ```

4. **Archive release file**
   - Create `.tiki/releases/archive/` if needed
   - Move `.tiki/releases/{version}.json` to archive
   - Add `completedAt` and `shipped: true` to archived file

5. **Update state.json**
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
| Git working tree clean | PASS |

### Shipping...

- [x] Creating git tag v1.2...
- [x] Pushing tag to origin...
- [x] Closing milestone "v1.2"...
- [x] Archiving release file...
- [x] Updating state...

### Release Shipped!

**Tag:** v1.2
**Commit:** abc1234
**Milestone:** Closed
**Archived:** .tiki/releases/archive/v1.2.json

**Issues shipped:**
- #41: Add authentication
- #42: Add user profiles
- #43: Add settings page

---

*Release v1.2 has been shipped successfully!*
```
</release-shipping>

<next-actions>
**After successful execution (all issues complete):**
Present using AskUserQuestion:
- question: "All issues complete! Ready to ship release {version}?"
- header: "Ship release"
- options:
  - label: "Ship release (Recommended)"
    description: "Create tag, close milestone, archive release"
  - label: "Ship without tag"
    description: "Complete release but skip git tag"
  - label: "Review first"
    description: "Check all changes before shipping"
  - label: "Pause"
    description: "Save progress and stop here"

**After successful shipping:**
Present using AskUserQuestion:
- question: "Release {version} shipped! What's next?"
- header: "Next step"
- options:
  - label: "Start another release"
    description: "Execute another release version"
  - label: "View release history"
    description: "See completed releases"
  - label: "Done"
    description: "End the session"

**After issue failure:**
Present using AskUserQuestion:
- question: "Issue #{number} failed during release {version}. How would you like to proceed?"
- header: "Issue failed"
- options:
  - label: "Fix and retry"
    description: "Fix the issue and re-run with --continue"
  - label: "Skip issue"
    description: "Mark as skipped and continue (risky)"
  - label: "Pause release"
    description: "Stop and investigate"
  - label: "Abort release"
    description: "Cancel the release entirely"

**After partial completion (paused):**
Present using AskUserQuestion:
- question: "Release {version} paused. {completed}/{total} issues complete."
- header: "Paused"
- options:
  - label: "Resume"
    description: "Continue from where we left off"
  - label: "View status"
    description: "See detailed progress"
  - label: "Abort"
    description: "Cancel the release"
</next-actions>
