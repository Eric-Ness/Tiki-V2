---
name: ship
description: Commit changes, push, and close a GitHub issue
argument: <issue-number>
tools: Bash, Read, Write, AskUserQuestion
---

# Ship Issue

Finalize an issue by committing changes, pushing to remote, and closing the GitHub issue. This includes verification that all success criteria were met.

<instructions>
  <step>Load state and plan for issue #{number}</step>
  <step>Verify all phases are complete (or skipped with acknowledgment)</step>
  <step>Run final verification:
    - All success criteria marked as verified
    - Tests pass
    - Build succeeds
    - No uncommitted changes from unrelated work
  </step>
  <step>Run the full test suite (see `<pre-ship-tests>` block) before committing. Halt and prompt the user if tests fail.</step>
  <step>**Fire the `pre-ship` lifecycle hook** before staging/committing (see `<lifecycle-hooks>`). If it BLOCKS (non-zero exit), pause and stop — do not commit.</step>
  <step>Stage and commit changes with a descriptive message</step>
  <step>Push to remote</step>
  <step>**Fire the `post-ship` lifecycle hook** after a successful push, passing the commit SHA (see `<lifecycle-hooks>`).</step>
  <step>Close the GitHub issue with a summary comment</step>
  <step>**Back up state before destructive changes:** Before modifying `activeWork`, create a timestamped backup of `state.json`:
    ```bash
    mkdir -p .tiki/backups
    cp .tiki/state.json ".tiki/backups/state.$(date -u +%Y-%m-%dT%H-%M-%S).json"
    ```
    This ensures state can be recovered if the ship operation corrupts data. Keep the last 10 backups and delete older ones.
  </step>
  <step>Update `activeWork` in `.tiki/state.json` (see state-management section). If the issue has a `parentRelease` field, keep it in `activeWork` with `status: "completed"`. Otherwise, remove it from `activeWork`. In both cases, add to `history`.</step>
  <step>Archive the plan file</step>
</instructions>

<pre-ship-verification>
Before shipping, verify:

**Execution Complete:**
- [ ] All phases marked as completed or intentionally skipped
- [ ] No phases in failed state

**Success Criteria Met:**
- [ ] All success criteria have been addressed
- [ ] Criteria verification documented in phase summaries

**Code Quality:**
- [ ] Tests pass (if applicable)
- [ ] Build succeeds (if applicable)
- [ ] Linting passes (if applicable)
- [ ] No TypeScript errors (if applicable)

**Git State:**
- [ ] All changes related to this issue are staged
- [ ] No unrelated changes mixed in
- [ ] Working directory is clean after commit
</pre-ship-verification>

<pre-ship-tests>
## Pre-Ship Test Run

Before staging and committing, run the full project test suite. This catches regressions that phase-level verification may have missed.

### 1. Read configuration

Read `.tiki/config.json` and look for `workflow.tests`. Defaults if file/section is absent:

```json
{
  "enabled": true,
  "command": null,
  "runBeforeShip": true,
  "timeoutSeconds": 300
}
```

If `workflow.tests.enabled` is `false` OR `workflow.tests.runBeforeShip` is `false`, skip this block (record `{ status: "skipped", reason: "pre-ship tests disabled" }` in the ship report and continue).

### 2. Resolve the test command

Same logic as `execute.md`'s `<test-integration>` block:

- If `workflow.tests.command` is set, use it directly.
- Otherwise auto-detect in priority order: `package.json scripts.test` → vitest → jest → `Cargo.toml` → `go.mod` → pytest. If none match, record `{ status: "skipped", reason: "no framework detected" }` and continue (do not block ship).

### 3. Run the full suite

Run the resolved command from the project root with timeout `workflow.tests.timeoutSeconds` (default 300). Unlike phase tests, this is the **full** suite — do not pass any phase-scoped filters.

### 4. Parse and report

Parse output using the same patterns described in `<test-integration>`. Surface a `testResults` block in the ship report:

```typescript
testResults: {
  framework: string;
  command: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  status: "passed" | "failed" | "skipped";
}
```

### 5. On test failure — halt and prompt

If `testResults.status === "failed"`, **do not commit**. Surface the failing test output (last ~50 lines) and present an `AskUserQuestion`:

- question: "Pre-ship tests failed. How would you like to proceed?"
- options:
  - label: "Pause to fix tests (Recommended)"
    description: "Stop the ship and fix the failing tests before committing"
  - label: "Skip tests and ship anyway"
    description: "Proceed with commit despite failing tests (risky)"
  - label: "Abort ship"
    description: "Cancel the ship operation entirely"

Behavior by choice:
- **Pause**: Set work `status` to `"paused"`, leave `pipelineStep` as `"SHIP"`, and exit. User fixes tests and re-runs `/tiki:ship`.
- **Skip and ship anyway**: Continue to commit. Note the override in the commit body and the GitHub close comment.
- **Abort**: Set work `status` back to `"executing"` and exit without committing.
</pre-ship-tests>

<lifecycle-hooks>
## Lifecycle Hooks (`.tiki/hooks/`)

SHIP fires two lifecycle hooks via the hook runner. Hooks are **opt-in** — the runner reads `.tiki/hooks/hooks.json`, and if a hook is missing, absent, or `enabled !== true` it prints nothing and exits 0, so this section is a no-op on projects without configured hooks. See `docs/HOOKS.md` for the registry shape, the `.ps1`-vs-`.sh` resolution, and the failure policy.

**Fire points (run the runner with the Bash tool):**

```bash
# BEFORE staging/committing (after pre-ship tests pass):
node packages/framework/scripts/run-hook.mjs pre-ship \
  --env TIKI_ISSUE={number} --env TIKI_TITLE="{issue title}"

# AFTER a successful push (capture the commit SHA first):
SHA=$(git rev-parse HEAD)
node packages/framework/scripts/run-hook.mjs post-ship \
  --env TIKI_ISSUE={number} --env TIKI_COMMIT_SHA="$SHA"
```

**Failure policy:** a non-zero exit from `pre-ship` is BLOCKING — the runner exits non-zero. When that happens, **PAUSE the pipeline**: set work `status` to `"paused"`, leave `pipelineStep` as `"SHIP"`, surface the hook's output, and do NOT commit. `post-ship` is non-blocking — a non-zero exit only warns (runner exits 0); the issue is already pushed, so log the warning and continue to close the issue.
</lifecycle-hooks>

<commit-format>
Generate a commit message following this format:

```
{type}: {short description} (#{issue-number})

{Longer description if needed, explaining what was done}

{Bulleted list of major changes}

Closes #{issue-number}
```

**Type prefixes:**
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code restructuring
- `docs:` - Documentation
- `test:` - Tests
- `chore:` - Maintenance

**Example:**
```
feat: Add user authentication (#{number})

Implements login, logout, and session management with JWT tokens.

- Add auth middleware
- Create login/logout endpoints
- Add session storage
- Include auth tests

Closes #42
```
</commit-format>

<github-close-comment>
Post a comment when closing the issue:

```markdown
## Completed

This issue has been implemented and shipped.

### Summary
{Brief description of what was done}

### Changes
{List of files created or modified}

### Verification
All success criteria verified:
{List of criteria with check marks}

---
*Shipped via Tiki*
```
</github-close-comment>

<output>
## Ship: Issue #{number}

### Pre-Ship Verification

| Check | Status |
|-------|--------|
| All phases complete | {PASS/FAIL} |
| Success criteria met | {PASS/FAIL} |
| Tests pass | {PASS/SKIP/FAIL} |
| Build succeeds | {PASS/SKIP/FAIL} |
| Git state clean | {PASS/FAIL} |

### Changes to Commit

**Files ({count}):**
{list of files}

**Commit Message:**
```
{generated commit message}
```

---

{After commit and push:}

### Shipped!

**Commit:** {short SHA}
**Branch:** {branch name}
**Issue:** Closed

*Issue #{number} has been shipped successfully.*
</output>

<state-management>
Shipping is two state-machine steps. See `yolo.md` `<state-management>` for the canonical shape and the parent-release contract.

```bash
# 1. Mark shipping:
node packages/framework/scripts/state.mjs transition issue:{number} --to-status shipping --to-step SHIP
# 2a. Release child (entry stays in activeWork; parentRelease preserved):
node packages/framework/scripts/state.mjs transition issue:{number} --to-status completed --to-step SHIP
# 2b. Standalone: remove the issue:{number} key from activeWork:
node packages/framework/scripts/state.mjs remove issue:{number}
# 3. In both cases, append the completion record to history:
node packages/framework/scripts/state.mjs append-history issue --number {number} --title "{issue title}"
```

The plan file at `.tiki/plans/issue-{number}.json` is moved to `.tiki/plans/archive/` as a regular filesystem rename (no shim involvement — it's not a state.json mutation).
</state-management>

<errors>
  <error type="no-argument">
    No issue number provided. Please specify an issue number:
    ```
    /tiki:ship 42
    ```
  </error>
  <error type="not-complete">
    Cannot ship issue #{number}: execution not complete.

    Incomplete phases: {list}

    Please complete execution first:
    ```
    /tiki:execute {number}
    ```
  </error>
  <error type="verification-failed">
    Pre-ship verification failed:
    {list of failed checks}

    Please fix these issues before shipping.
  </error>
  <error type="tests-failed">
    Tests are failing. Please fix before shipping:
    ```
    {test output summary}
    ```
  </error>
  <error type="push-failed">
    Failed to push to remote:
    {error message}

    Please resolve and try again.
  </error>
</errors>

<next-actions>
**Before shipping (verification failed):**
- question: "Pre-ship verification failed. How would you like to proceed?"
- options:
  - label: "Fix issues"
    description: "Address the verification failures"
  - label: "Ship anyway (risky)"
    description: "Proceed despite failures"
  - label: "Review changes"
    description: "See what will be committed"

**After successful ship:**
- question: "Issue #{number} shipped! What's next?"
- options:
  - label: "Get next issue"
    description: "Fetch another GitHub issue"
  - label: "View history"
    description: "See recently completed issues"
  - label: "Done for now"
    description: "End the session"
</next-actions>
