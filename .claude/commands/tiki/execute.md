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
  <step>**Fire the `pre-execute` lifecycle hook** before the first phase (see `<lifecycle-hooks>`). If it BLOCKS (non-zero exit), pause and stop — do not run any phase.</step>
  <step>For the current phase:
    1. Display phase details (title, files, verification criteria)
    2. **Fire the `phase-start` hook** (see `<lifecycle-hooks>`)
    3. Execute the phase content (the actual work)
    4. Run verification checks
    5. Run test integration (see `<test-integration>` block) before declaring verification passed
    6. Generate a summary of what was accomplished (include `testResults` if tests ran)
    7. Update phase status and save state
    8. **Fire the `phase-complete` hook** with the phase's final status (see `<lifecycle-hooks>`)
  </step>
  <step>**Fire the `post-execute` hook** after all phases finish (see `<lifecycle-hooks>`), before transitioning to `shipping`.</step>
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

Update `.tiki/state.json` BEFORE each phase. On failure, set `phase.status: "failed"` and do NOT advance `current`. When all phases finish, transition to `shipping`. (Canonical shape: see `yolo.md`.)

```bash
# Before phase N:
node packages/framework/scripts/state.mjs transition issue:{number} \
  --to-status executing --to-step EXECUTE --phase-current {N} --phase-total {T} --phase-status executing
# All phases done:
node packages/framework/scripts/state.mjs transition issue:{number} --to-status shipping --to-step SHIP
```
</state-update-requirement>

<lifecycle-hooks>
## Lifecycle Hooks (`.tiki/hooks/`)

EXECUTE fires four lifecycle hooks via the hook runner. Hooks are **opt-in** — the runner reads `.tiki/hooks/hooks.json`, and if a hook is missing, absent, or `enabled !== true` it prints nothing and exits 0, so this section is a no-op on projects without configured hooks. See `docs/HOOKS.md` for the registry shape, the `.ps1`-vs-`.sh` resolution, and the failure policy.

**Fire points (run the runner with the Bash tool):**

```bash
# Once, BEFORE the first phase (after computing the total phase count):
node packages/framework/scripts/run-hook.mjs pre-execute \
  --env TIKI_ISSUE={number} --env TIKI_TITLE="{issue title}" --env TIKI_TOTAL_PHASES={T}

# Immediately BEFORE starting each phase N (after the state.mjs transition):
node packages/framework/scripts/run-hook.mjs phase-start \
  --env TIKI_ISSUE={number} --env TIKI_PHASE={N} --env TIKI_PHASE_TITLE="{phase title}"

# Immediately AFTER each phase N returns (status is "completed" | "failed" | "skipped"):
node packages/framework/scripts/run-hook.mjs phase-complete \
  --env TIKI_ISSUE={number} --env TIKI_PHASE={N} --env TIKI_PHASE_STATUS="{phase status}"

# Once, AFTER all phases finish (before the shipping transition):
node packages/framework/scripts/run-hook.mjs post-execute \
  --env TIKI_ISSUE={number} --env TIKI_PHASES_COMPLETED={count of completed phases}
```

**Failure policy:** a non-zero exit from a `pre-*` hook (here `pre-execute`) is BLOCKING — the runner exits non-zero. When that happens, **PAUSE the pipeline**: set work `status` to `"paused"`, leave `pipelineStep` as `"EXECUTE"`, surface the hook's output, and stop before running any phase. The non-blocking hooks (`phase-start`, `phase-complete`, `post-execute`) only warn on failure (runner exits 0); log the warning and continue.
</lifecycle-hooks>

<parallel-execution>
## Parallel Phase Execution

Phases that have no shared file conflicts and whose dependencies are already satisfied can run concurrently in separate sub-agents. This section is the authoritative algorithm — follow it deterministically.

### When to parallelize

- **Default: ON.** Always attempt to parallelize independent phases.
- **Opt-out hook:** Read `.tiki/config.json`. If `workflow.parallel.enabled === false`, fall back to fully sequential execution. If the file or key is missing, treat it as `true`.
- **Edge case:** If a single-phase group emerges, run it as a single (non-parallel) phase using the existing single-phase code path. Do NOT set `parallelExecution`.

### Step 1 — Build the dependency graph

For each phase in the plan:
- `node = phase.number`
- `incoming edges = phase.dependencies` (numbers of phases that must complete first)
- `files = phase.files || []`

### Step 2 — Compute topological levels (Kahn's by levels)

```
remaining = set of all phase numbers
levels = []
while remaining is non-empty:
    ready = [p for p in remaining if all of p.dependencies are NOT in remaining]
    if ready is empty: ERROR — cycle in dependencies. Abort and surface.
    levels.append(ready)
    remaining -= ready
```

After this loop:
- `levels[0]` = phases with no unsatisfied deps
- `levels[i]` = phases whose deps are all in `levels[0..i-1]`
- Levels run **sequentially**: do not start level `i+1` until every phase in level `i` is `completed`.

### Step 3 — Within each level, split into file-conflict-free groups (greedy)

Within a single level, two phases can run in the same parallel group iff their `files` arrays have an empty intersection (set difference). Use this greedy algorithm:

```
groups = []
remaining_at_level = list of phases at this level (preserve plan order)
while remaining_at_level is non-empty:
    seed = remaining_at_level.pop_front()
    group = [seed]
    group_files = set(seed.files)
    leftover = []
    for p in remaining_at_level:
        if set(p.files).intersection(group_files) is empty:
            group.append(p)
            group_files = group_files.union(p.files)
        else:
            leftover.append(p)
    groups.append(group)
    remaining_at_level = leftover
```

Conservative rules:
- If `phase.files` is missing, empty, or null, treat the phase as conflicting with everything (assume worst case: it touches anything). Place it in its own group.
- **Groups within a level run sequentially.** Levels run sequentially.
- **Phases within a group run in parallel.**

### Step 4 — Dispatch the group

This is the parallelism mechanism. The Anthropic Agent (Task) tool runs concurrently when **multiple Task calls are emitted in a single assistant message**.

- **Group size 1:** Run as a normal single phase (existing single-phase code path). Do NOT set `parallelExecution`.
- **Group size N >= 2:** In ONE assistant message, emit N `Task` tool calls (one per phase in the group). Each Task uses `subagent_type: "general-purpose"` and the prompt template from `<sub-agent-protocol>` below. Each prompt MUST include the phase's files list and verification criteria so the sub-agent stays scoped to its files.

### Step 5 — State updates (`.tiki/state.json`)

**When starting a parallel group (size >= 2):** before dispatching the Task calls, write:

```json
"phase": {
  "current": <max(phase.number for phase in group)>,
  "total": <total phases in plan>,
  "status": "executing"
},
"parallelExecution": {
  "phases": [<all phase numbers in group, ascending>],
  "completedInGroup": [],
  "totalInGroup": <group size>,
  "startedAt": "<current ISO timestamp>"
}
```

`phase.current = max(...)` so old desktop clients that only read `phase` see a sensible "Phase X of Y" display while the group is in flight.

**As each phase in the group returns:**
- Append its number to `parallelExecution.completedInGroup` (or move to `failed` tracking if it failed).
- Update the per-phase status in `.tiki/plans/issue-N.json` immediately (don't batch — the file watcher relies on this).
- Do NOT advance `phase.current` while siblings are still running.

**When all phases in the group have returned:**
- Remove the `parallelExecution` field entirely (omit on serialize, or set to `null`).
- If any phase failed, see Failure Handling below.
- Otherwise, advance to the next group/level. If the next batch is also a parallel group of size >= 2, repeat from Step 4. If it's size 1, run sequentially without `parallelExecution`.

**When the entire plan is done:** set work `status` to `"shipping"` and clear `phase.status` to `"completed"`.

### Step 6 — Failure handling

When at least one sub-agent in a parallel group fails:

- **Do NOT cancel sibling sub-agents.** They are already in flight; cancellation is unsupported by the Agent tool and would only waste work. Let them run to completion.
- **Wait for all sub-agents to return.** Collect every result.
- **Surface all failures together.** Update the plan file: each failed phase gets `status: "failed"` with its error message. Successful siblings get `status: "completed"`.
- **Pause for manual recovery.** Set work `status` to `"failed"`, clear `parallelExecution`, and present the recovery options from `<next-actions>` (fix and retry, skip, pause, heal). Do NOT auto-advance to the next level.

### Step 7 — Backward compatibility

- A single-phase level emits a single Task call (or runs inline) and DOES NOT set `parallelExecution`. Old clients see the familiar `phase: { current, total, status }` and behave identically.
- Old state.json files lacking `parallelExecution` deserialize cleanly (the field is `Option<…>` with `#[serde(default)]` on the Rust side and optional in TypeScript).
- The whole feature degrades gracefully: if every level happens to contain phases that all conflict on files, the algorithm collapses to one phase per group, which is byte-identical to sequential execution.

### Worked example

Plan with 5 phases:
- P1: deps=[],     files=["a.rs"]
- P2: deps=[],     files=["b.ts"]
- P3: deps=[],     files=["a.rs"]   <-- conflicts with P1
- P4: deps=[1,2],  files=["c.css"]
- P5: deps=[3],    files=["a.rs"]

Levels:
- L0 = [P1, P2, P3]   (no deps)
- L1 = [P4, P5]       (deps satisfied by L0)

Groups:
- L0 split: seed P1 (files=a.rs). P2 (b.ts) joins (no overlap) → group=[P1,P2]. P3 (a.rs) conflicts with P1 → next group=[P3]. So L0 runs as: parallel{P1,P2} → then P3.
- L1 split: seed P4 (c.css). P5 (a.rs) has no overlap → group=[P4,P5]. So L1 runs as: parallel{P4,P5}.

Final execution order: parallel{P1,P2} → P3 → parallel{P4,P5}.
</parallel-execution>

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
See `<state-update-requirement>` for state.json. For the plan file: when a phase completes, set its `status: "completed"` with `completedAt` + `summary` in `.tiki/plans/issue-{number}.json`; on failure use `status: "failed"` + error details. For parallel groups, write `parallelExecution` directly in JSON (shim does not expose this yet — see `<parallel-execution>`).

**After each phase completes, also update `successCriteria` verification** in the same plan file (`.tiki/plans/issue-{number}.json`), applying the "all covering phases complete" rule:

- For each criterion in `successCriteria`, look up its covering phase numbers in `coverageMatrix[criterion.id]` (treat a missing or empty entry as no coverage).
- If the criterion has at least one covering phase AND **every** covering phase now has `status: "completed"` in `phases[]` (matched by `phase.number`), set `verified: true` and `verifiedAt: "{ISO timestamp}"` on that criterion (preserve an existing `verifiedAt` if already set).
- Otherwise leave the criterion unverified (`verified: false`, no `verifiedAt`).

This is the same rule implemented by `deriveCriteriaVerification` in `@tiki/shared`; the desktop checklist derives the live state from phase completion, but persisting it here keeps the plan file authoritative once EXECUTE finishes. (Direct-JSON write is acknowledged — `successCriteria` is not exposed by the state shim.)
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
