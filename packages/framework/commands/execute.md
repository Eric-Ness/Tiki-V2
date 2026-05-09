---
name: execute
description: Execute plan phases for a GitHub issue
argument: <issue-number>
tools: Bash, Read, Write, Edit, Glob, Grep, Task, AskUserQuestion
---

# Execute Issue

Execute the phases of a planned issue. Each phase runs with focused context, producing a summary that carries forward to the next phase.

<instructions>
  <step>Load the plan from `.tiki/plans/issue-{number}.json`</step>
  <step>Load current state from `.tiki/state.json` to find current phase</step>
  <step>**Retrieve relevant research** from `.tiki/research/` before dispatching any sub-agent (see `<research-retrieval>` below). Research content must be included in every sub-agent prompt under a `## Research Context` heading.</step>
  <step>**CRITICAL: Update state.json with phase info BEFORE starting work** (see state-update-requirement below)</step>
  <step>For the current phase:
    1. Display phase details (title, files, verification criteria)
    2. Execute the phase content (the actual work)
    3. Run verification checks
    4. Run test integration (see `<test-integration>` block) before declaring verification passed
    5. Generate a summary of what was accomplished (include `testResults` if tests ran)
    6. Update phase status and save state
  </step>
  <step>If verification passes, advance to next phase or complete</step>
  <step>If verification fails (including test failures), follow `<auto-heal>` (when enabled in `.tiki/config.json`) before offering manual recovery options</step>
</instructions>

<research-retrieval>
**Before dispatching any sub-agent task, check `.tiki/research/` for relevant prior findings.** Sub-agents start with fresh context and rely on the parent prompt for any domain knowledge — research docs are the channel that carries hard-won learnings from REVIEW and PLAN into EXECUTE.

Procedure:

1. **List** files matching `.tiki/research/*.md` using the Glob tool. If the directory does not exist or is empty, **skip silently** — no error, no output.
2. **Read the front-matter** of each file (just the YAML lines between the first two `---` delimiters). Extract `topic`, `tags`, and `issues`.
3. **Determine relevance** for the current issue and phase. A doc is relevant if any of these are true:
   - The doc's `issues` array contains the current issue number `{number}`.
   - One or more of the doc's `tags` matches a label, file path, technology, or domain term from the issue or the current phase content.
   - The `topic` slug clearly relates to the files this phase will touch.
4. **Read the full body** of each relevant doc.
5. **Surface findings** in a `## Research Context` section in the parent execute output before sub-agent dispatch.
6. **Pass research content into every sub-agent prompt.** When constructing the Task prompt (see `<sub-agent-protocol>`), include a `## Research Context` heading near the top with the body of each relevant research doc (front-matter stripped). Sub-agents have no other way to see this content — if you do not pass it through, the knowledge is lost.
7. If no relevant docs are found, omit the `## Research Context` section entirely (do not include an empty heading in the sub-agent prompt).
</research-retrieval>

<state-update-requirement>
## CRITICAL: Phase State Updates

**You MUST update `.tiki/state.json` BEFORE starting work on each phase.**

This is not optional. The desktop app and other tooling rely on the `phase` object being kept current.

**BEFORE starting each phase, update state.json with:**
```json
{
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "issue": { "number": {N}, "title": "..." },
      "status": "executing",
      "pipelineStep": "EXECUTE",
      "phase": {
        "current": {phase number, 1-indexed},
        "total": {total phases from plan},
        "status": "executing"
      },
      "lastActivity": "{ISO timestamp}"
    }
  }
}
```

**AFTER completing each phase, update:**
- Set `phase.status` to `"completed"` or `"failed"`
- If advancing to next phase, increment `phase.current` and set `phase.status` to `"pending"`
- If all phases complete, set work `status` to `"shipping"`

**Example - Starting Phase 2 of 3:**
```json
"phase": {
  "current": 2,
  "total": 3,
  "status": "executing"
}
```

**Example - After completing Phase 2, ready for Phase 3:**
```json
"phase": {
  "current": 3,
  "total": 3,
  "status": "pending"
}
```
</state-update-requirement>

<phase-execution>
**Before starting a phase:**
1. Read the phase content from the plan
2. Read any summaries from previous phases
3. Understand which files will be modified
4. Check dependencies are met

**During phase execution:**
1. Follow the phase instructions precisely
2. Create or modify only the specified files
3. Keep changes focused on phase goals
4. Note any unexpected issues

**After completing phase work:**
1. Run all verification checks
2. Run tests if applicable (`npm test`, `pnpm test`, etc.)
3. Run type checks if applicable (`tsc --noEmit`)
4. Run linting if applicable
5. Generate a concise summary (passed to next phase)

**Summary format:**
```
Phase {N} Summary:
- Created: {list of new files}
- Modified: {list of changed files}
- Key changes: {bullet points of what was done}
- Verification: {PASS/FAIL with details}
- Notes for next phase: {any context needed}
```
</phase-execution>

<sub-agent-protocol>
For complex phases or when context is getting long, use the Task tool to spawn a sub-agent:

```
Task tool parameters:
- subagent_type: "general-purpose"
- description: "Execute phase {N}: {title}"
- prompt: |
    You are executing Phase {N} of Issue #{number}: {issue title}

    ## Research Context
    {bodies of relevant .tiki/research/*.md docs, front-matter stripped — omit this entire section if no relevant docs were found in <research-retrieval>}

    ## Previous Phase Summaries
    {summaries from phases 1 to N-1}

    ## This Phase
    **Title:** {title}
    **Goal:** {content}
    **Files:** {file list}

    ## Verification Criteria
    {verification list}

    ## Instructions
    1. Execute the phase as described
    2. Verify your work against the criteria
    3. Return a summary in this format:
       - Files created/modified
       - Key changes made
       - Verification results
       - Notes for next phase
```

The sub-agent's response becomes the phase summary.
</sub-agent-protocol>

<output>
## Executing: Issue #{number}

### Current Progress
**Phase:** {current} of {total}
**Status:** {executing | completed | failed}

---

### Phase {N}: {title}

**Files:**
{file list}

**Instructions:**
{phase content}

**Verification:**
- [ ] {check 1}
- [ ] {check 2}

---

{After execution:}

### Phase {N} Results

**Status:** {PASS | FAIL}

**Summary:**
{generated summary}

**Verification Results:**
- [x] {check 1}: Passed
- [x] {check 2}: Passed

---

{If more phases remain:}
*Phase {N} complete. {remaining} phases remaining.*

{If all phases complete:}
*All phases complete! Ready to ship.*
</output>

<state-management>
During execution, update `.tiki/state.json`:

**Starting a phase:**
```json
{
  "phase": {
    "current": {N},
    "total": {total},
    "status": "executing"
  },
  "status": "executing",
  "pipelineStep": "EXECUTE",
  "lastActivity": "{ISO timestamp}"
}
```

**Completing a phase:**
- Update plan file: set phase status to "completed", add completedAt and summary
- Update state: increment current phase or set status to "shipping" if done
- Write phase summary for handoff to next phase

**On failure:**
- Update plan file: set phase status to "failed", add error details
- Update state: set phase.status to "failed", keep current phase number
- Do not advance to next phase
</state-management>

<errors>
  <error type="no-argument">
    No issue number provided. Please specify an issue number:
    ```
    /tiki:execute 42
    ```
  </error>
  <error type="no-plan">
    No plan found for issue #{number}. Please create a plan first:
    ```
    /tiki:plan {number}
    ```
  </error>
  <error type="not-audited">
    Plan has not been audited. Run audit first or use `--force` to skip:
    ```
    /tiki:audit {number}
    ```
  </error>
  <error type="verification-failed">
    Phase {N} verification failed:
    {list of failed checks}

    Options:
    - Fix the issues and retry
    - Skip this verification (risky)
    - Pause execution
  </error>
</errors>

<test-integration>
## Test Framework Integration

After phase work completes, run the project's test suite as part of verification. Test results are surfaced in the phase summary as `testResults`.

> Hook-based override is out of scope for v1; use `.tiki/config.json`.

### 1. Read configuration

Read `.tiki/config.json` and look for `workflow.tests`. Defaults if file/section is absent:

```json
{
  "enabled": true,
  "command": null,
  "runOnEachPhase": false,
  "runBeforeShip": true,
  "timeoutSeconds": 300
}
```

If `workflow.tests.enabled` is `false`, skip this block entirely (record `{ status: "skipped", reason: "tests disabled in config" }`).

### 2. Decide whether to run

Run tests for this phase only if **either** is true:
- `workflow.tests.runOnEachPhase` is `true`, OR
- The current phase's `verification` array explicitly mentions a test step — any entry whose lowercased text contains one of: `vitest`, `jest`, `pnpm test`, `npm test`, `cargo test`, `go test`, `pytest`, or the bare token `test` (word boundary).

Otherwise, skip with `{ status: "skipped", reason: "phase verification does not require tests" }`.

### 3. Resolve the test command

If `workflow.tests.command` is set (non-null string), use it directly — this overrides detection.

Otherwise, auto-detect by checking project files in this priority order:

1. **`package.json` with `scripts.test`** → use `pnpm test` if `pnpm-lock.yaml` exists, else `npm test`
2. **`package.json` with `vitest` in deps/devDeps** → `pnpm vitest run` (or `npx vitest run` if no pnpm lockfile)
3. **`package.json` with `jest` in deps/devDeps** → `pnpm jest` (or `npx jest`)
4. **`Cargo.toml` present** → `cargo test`
5. **`go.mod` present** → `go test ./...`
6. **`pytest.ini` OR `pyproject.toml` containing `[tool.pytest]` OR a `tests/` directory containing `.py` files** → `pytest`

If none match, record `{ status: "skipped", reason: "no framework detected" }` and continue.

### 4. Run

Run the resolved command from the project root with a timeout of `workflow.tests.timeoutSeconds` (default 300). Capture stdout, stderr, exit code, and elapsed time.

### 5. Parse output

Best-effort grep the combined stdout/stderr for these patterns. Always set `framework` to the detected/configured framework name (`vitest`, `jest`, `pytest`, `cargo`, `go`, `npm`, `unknown`).

- **vitest:** `Test Files  N passed`, `Tests  N passed` (also `failed`, `skipped`)
- **jest:** `Tests:  N passed, N total` (also `failed`, `skipped`)
- **pytest:** `N passed in N.NNs` (also `N failed`, `N skipped`)
- **cargo:** `test result: ok. N passed; N failed` (also `N ignored`)
- **go:** `PASS\nok ...` per package; `--json` output gives structured pass/fail counts (optional)

If parsing fails, fall back to exit code: `0 → status: "passed"` with counts unknown, non-zero → `status: "failed"`.

### 6. Surface in phase summary

Add a `testResults` field to the phase summary:

```typescript
testResults: {
  framework: string;       // "vitest" | "jest" | "pytest" | "cargo" | "go" | "npm" | "unknown"
  command: string;         // the command actually run
  passed: number;          // 0 if unknown
  failed: number;
  skipped: number;
  durationMs: number;
  status: "passed" | "failed" | "skipped";
}
```

### 7. On test failure

If `testResults.status === "failed"`:
1. Mark phase verification as failed.
2. Include the failing test output (last ~50 lines of stdout/stderr) in the phase error output BEFORE falling through to the standard `verification-failed` recovery flow.
3. Do not advance to the next phase.

The recovery options under `<next-actions>` (Fix and retry / Skip / Pause / Heal) apply normally — auto-heal hooks (if installed by a future issue) can pick up `testResults` to drive repair.
</test-integration>

<auto-heal>
## Auto-Heal: Automatic Recovery on Verification Failure

When a phase's verification step fails, Tiki can attempt to repair the failure automatically before falling back to the manual recovery options in `<next-actions>`. Auto-heal is **opt-in** and is driven entirely by these instructions — there is no Rust code that runs the heal loop.

### Opt-in check

Before attempting auto-heal, read `.tiki/config.json` (it may not exist).

```json
{
  "workflow": {
    "autoHeal": {
      "enabled": false,
      "maxAttempts": 3,
      "categories": ["build-error", "type-error", "test-failure", "lint-error"]
    }
  }
}
```

- If the file is missing, treat `enabled` as `false` and skip auto-heal entirely (use the manual `<next-actions>` failure flow).
- If `workflow.autoHeal.enabled !== true`, skip auto-heal.
- `maxAttempts` defaults to `3` when missing.
- `categories` is the allow-list of error categories you may attempt to heal. If the categorized error is not in this list, skip auto-heal and fall through to manual recovery.

### Heal loop

When verification fails AND auto-heal is enabled:

1. **Capture the error output** verbatim (build stderr, failing test names, type errors, lint diagnostics, etc.). Trim aggressively but preserve filenames, line numbers, and the diagnostic message.
2. **Categorize the error** using the heuristics below. Pick exactly one category:
   - `build-error` — TypeScript `tsc -b` / `pnpm build` compilation failures, Rust `cargo check` / `cargo build` failures (non-type)
   - `type-error` — TS-only type narrowing, missing properties on types, discriminated-union narrowing issues
   - `test-failure` — vitest, jest, or `cargo test` failed assertions or runtime errors during tests
   - `lint-error` — ESLint, clippy diagnostics
   - `other` — anything else (e.g., missing file, permission error, network failure)
3. **Read prior attempts** for this phase from `.tiki/state.json`. Look at `activeWork["issue:{N}"].phase.healAttempts` (treat as `[]` if missing). Let `attempts = healAttempts.length`.
4. **Stop conditions** — fall through to manual `<next-actions>` recovery if any of these are true:
   - `attempts >= config.workflow.autoHeal.maxAttempts`
   - The categorized error is not in `config.workflow.autoHeal.categories`
   - The same error has already been seen on the previous attempt with no progress (heal is looping)
5. **Otherwise, attempt a targeted fix** based on category (see "Healing strategies" below). Apply the fix as a normal edit, then **re-run the same verification command** that originally failed.
6. **Append a `HealAttempt` record** to `phase.healAttempts` in `.tiki/state.json` regardless of outcome:
   ```json
   {
     "attempt": {1-indexed},
     "timestamp": "{ISO timestamp}",
     "errorCategory": "type-error",
     "errorSummary": "{one-line summary, ~120 chars}",
     "fixApplied": "{one-line description of the change}",
     "outcome": "success" | "failure"
   }
   ```
7. **On success**, clear the failure state and continue to the next phase normally. Include the heal attempts in the phase summary so they are visible.
8. **On failure**, loop back to step 1 with the new error output. The next iteration's `attempt` count increments naturally because the prior record was appended.

### Healing strategies (per category)

These are guidance, not prescriptions — judge each error on its merits.

- **build-error** — Read the offending file at the reported line. If the failure references a missing import/export, fix the import path. If a function signature mismatch, align the call site or the declaration based on which is canonical (prefer matching the type definition). For Rust, common fixes are missing `use` statements, missing `#[serde(default)]` on optional fields, or trait bound issues — try the smallest mechanical fix first.
- **type-error** — Re-read the type definitions involved. For TS discriminated-union narrowing, prefer extracting fields via direct ternary (per project memory: `const x = work.type === "issue" ? work.issue.number : undefined;`) rather than intermediate booleans. Add explicit type assertions only as a last resort.
- **test-failure** — Read the failing test, then re-read the implementation. Decide whether the test's expectation or the implementation is correct. Fix the side that diverges from the phase's stated goal. If the failing assertion is unrelated to this phase's changes, flag as `other` and bail to manual recovery.
- **lint-error** — Apply the lint rule's suggested fix. For ESLint, prefer auto-fixable rules (`pnpm lint --fix` if available); for clippy, apply the suggested replacement.
- **other** — Do not attempt auto-heal. Fall through to manual recovery and let the user decide.

### Falling back to manual recovery

When auto-heal exhausts its attempts (or refuses to start), present the manual `<next-actions>` failure flow with one important addition: **include a summary of all heal attempts** so the user knows what was tried. Format:

```
Auto-heal attempted {N} fixes for Phase {N} but verification still fails.

Attempts:
1. [type-error] Fixed discriminated-union narrowing in WorkCard.tsx → still failing (different error)
2. [type-error] Added explicit type assertion → still failing (same error)
3. [build-error] Reverted assertion, fixed import path → still failing

Latest error:
{error output}
```

Then fire the existing `AskUserQuestion` from `<next-actions>` "After failure".

### Where to record attempts

`HealAttempt` records live in `.tiki/state.json` under the active work item's `phase.healAttempts` array. The Rust state schema treats this loosely (no validation), so you can write the array directly. Do not create a separate file.
</auto-heal>

<next-actions>
**After successful phase:**
- question: "Phase {N} complete. Continue to next phase?"
- options:
  - label: "Continue (Recommended)"
    description: "Execute the next phase"
  - label: "Pause"
    description: "Save progress and stop here"
  - label: "Review progress"
    description: "See what's been done so far"

**After all phases complete:**
- question: "All phases complete! Ready to ship?"
- options:
  - label: "Ship (Recommended)"
    description: "Commit, push, and close the issue"
  - label: "Review first"
    description: "Review all changes before shipping"
  - label: "Run tests"
    description: "Run full test suite before shipping"

**After failure:**
- question: "Phase {N} failed. How would you like to proceed?"
- options:
  - label: "Fix and retry"
    description: "Fix the issues and re-run this phase"
  - label: "Skip phase"
    description: "Mark as skipped and continue (risky)"
  - label: "Pause execution"
    description: "Stop here and investigate"
  - label: "Heal"
    description: "Auto-diagnose and attempt repair"
</next-actions>
