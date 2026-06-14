---
name: scaffold
description: Interview a greenfield project into a brief + draft epic/issue spine, then push to GitHub
argument: [one-line project description]
tools: Bash, Read, Write, AskUserQuestion
---

# Scaffold a Greenfield Project

The conversational front door for a brand-new project. Interview the user about what they
want to build, synthesize a **project brief** plus a project-wide **"what needs to be true"**
requirements list, and hand off toward the draft spine. Scaffold never drives the Tiki
pipeline (no transitions, no issue numbers exist yet) — it captures intent and emits a brief.

This command authors the brief. The downstream draft spine and the gated GitHub push are
separate capabilities that append to this same flow; this stage ends with a clean handoff.

<instructions>
  ## Stage 0 — Preflight (no interview questions yet)

  <step>**Resume detection.** Check whether `.tiki/onboarding/draft/manifest.json` already exists.
    - If it exists, a prior scaffold draft is in progress. The draft-spine capability owns that file, so for now simply **note** to the user that a draft already exists and ask (one AskUserQuestion) whether to **Continue the existing brief/draft** or **Start over** (which will overwrite). Do not delete or rewrite the draft here.
    - If it does not exist, proceed.
  </step>

  <step>**Greenfield readiness probe (WARN, never abort).** Run, via Bash:
    ```bash
    gh auth status
    git remote -v
    ```
    The only capability gated by these is the eventual GitHub push (a later stage). If `gh` is unauthenticated, or `git remote -v` shows no remote, **warn** the user that pushing issues to GitHub will be unavailable until they finish project setup (point them at the project-skeleton readiness checklist), and then **continue**. The interview and the local brief always proceed regardless — never stop the command because of these checks.
  </step>

  <step>**Derive and validate the project slug.** Choose a `<slug>` for the brief filename:
    - Lowercase kebab-case (letters, digits, hyphens only), derived from the project name once you know it (you may defer the final slug until after Q1/Q2, but validate before writing).
    - Must not contain `/` or `..` (path-traversal guard).
    - Surface the `invalid-slug` error if a derived slug fails validation; ask the user for a clean name.
  </step>

  <step>**Existing-brief gate.** If `.tiki/research/<slug>-brief.md` already exists, read it and present one AskUserQuestion offering **Merge** (append a new `## YYYY-MM-DD revision` section, preserving the original front-matter but extending `tags`) vs. **Overwrite** (replace entirely) vs. **Cancel**. This gate runs only at write time (after Q8), so an early abort never touches the file.
  </step>

  <step>**Seed context.** Fold the `argument` (the one-line project description) AND anything the user already said in this conversation into Q1, so the interview never re-asks what is already known. The `argument` pre-fills Q1 for confirm/edit rather than asking it cold.
  </step>

  ## The interview arc (adaptive, bounded — target ≤ 8 turns)

  Driving principle: **infer and propose, then ask for correction.** Proposing a best guess and letting the user trim is cheaper than open interrogation and is the only way to stay under budget. Each stage below is **one** AskUserQuestion; allow free-text via an "Other" option wherever it helps.

  **HARD convergence imperatives (obey all):**
  - Ask **at most 8 turns** total. Never exceed the Q1–Q8 budget.
  - **Skip any stage already answered** — if the `argument` or earlier answers already cover a later stage, collapse it into the proposal instead of asking. If Q1/Q3 are rich, fold Q5 into the proposal directly.
  - If you have already asked **6 or more** questions, **force the Q8 synthesis checkpoint immediately** with your best-guess scope filled in — do not keep interviewing.
  - On any **"you decide" / "no preference" / "whatever you think"** answer, **STOP asking about that gap**, fill it yourself with a sensible default, and **surface the assumption explicitly at Q8** so the user can correct it there.
  - **Q8 is the SINGLE write-gate.** NOTHING is written to disk before the user approves at Q8. Bailing out at any point before Q8 leaves the filesystem untouched.

  <step>**Q1 — Vision.** AskUserQuestion (pre-filled from `argument` if present): "In a sentence or two, what do you want to build?" Capture the 1–2 sentence "what." Offer "Other" for free-text edit. If the `argument` already states this clearly, present it for confirm/edit rather than asking blank.</step>

  <step>**Q2 — Project type.** AskUserQuestion, single-select (drives stack + epic shape): **Web app · API / service · CLI · Library / SDK · Desktop · Other** (free-text). Skip if Q1 already pins the type unambiguously (and confirm your inference at Q8).</step>

  <step>**Q3 — Users & core job.** AskUserQuestion, free-text: "Who uses it, and the one job it must do well?" This elicits the MVP slice. Offer "Other" for free-text.</step>

  <step>**Q4 — Stack & hard constraints.** AskUserQuestion, multi-select + "Other": language / framework, must-use technologies, compliance, deadlines. **Include a "You pick / no preference" option** so the LLM is authorized to recommend a stack (surface the recommendation at Q8).</step>

  <step>**Q5 — Must-have set for v0.1 (the spine).** Do NOT ask open-endedly. **PROPOSE 3–6 candidate capabilities** inferred from Q1–Q3, presented via AskUserQuestion (multi-select) so the user **trims / confirms**. This enforces a *small spine* — steer toward the smallest set that delivers the core job, and resist scope creep. Offer "Other" to add a capability.</step>

  <step>**Q6 — Non-functional priorities.** AskUserQuestion, multi-select (maps to success-criteria categories later): **testing · security · performance · documentation · not yet**. "Not yet" is a valid answer.</step>

  <step>**Q7 — Ordering.** Do NOT ask open-endedly. **PROPOSE the build ordering / dependency shape** ("auth before billing," "scaffolding first") via AskUserQuestion, and let the user **confirm or adjust**. This is what later becomes dependency edges.</step>

  <step>**Q8 — Synthesis checkpoint (the write-gate).** Summarize back, in chat, the full synthesized scope: vision, type & stack, users & core job, the trimmed must-have set, the ordering, the non-functional priorities, AND **every assumption you filled in** for "you decide" gaps. Then AskUserQuestion, single-select: **Draft it** (approve → write the brief) · **Adjust scope** (loop back to Q5) · **Change ordering** (loop back to Q7) · **Add / remove a capability** (loop back to the relevant stage). Only **Draft it** unlocks the write step below. Until then, nothing is written.</step>

  ## Brief emission (only after Q8 "Draft it")

  <step>**Write the brief with the Write tool** to `.tiki/research/<slug>-brief.md` (create `.tiki/research/` if absent). Use the research-doc front-matter schema below, then the section skeleton below. If the existing-brief gate above selected **Merge**, append a `## YYYY-MM-DD revision` section instead of replacing. Surface the `write-failed` error if the write does not succeed. Then confirm the path and a one-line summary, and **continue into the draft-spine stage below** (the interview flows straight into decomposition; the user gets one more review gate before anything leaves the machine).</step>

  ## The draft spine (after the brief is written)

  The brief captured *intent*; this stage turns it into a **small, reviewable spine** of epics → first-wave issues, staged locally under `.tiki/onboarding/draft/`. `.tiki/onboarding/` is **transient scratch** — nothing here is outward-facing, and the whole directory is safe to discard. No issue numbers exist yet, so dependencies are **symbolic** (local ids), never `#N`. Scaffold drives no pipeline here: it writes draft files, renders the tree, and gates on one review question. Pushing to GitHub is a separate downstream capability that this stage hands off to.

  **`/tiki:scaffold resume`** re-enters this stage directly: if `.tiki/onboarding/draft/manifest.json` already exists, skip the interview and brief, read the staged draft, and jump straight to the **render + review gate** step (so a user who chose "Edit a draft," edited the markdown by hand, and re-ran can review the amended spine without re-interviewing).

  <step>**Decompose into a small spine.** From the brief's *Scope*, *What needs to be true*, and *Proposed epics & first wave* sections, derive:
    - **2–4 epics.** **Epic 1 is almost always Foundation/scaffolding** (repo skeleton, CI, the first walking-skeleton slice). The remaining 1–3 epics are the core capability(ies) from Q5 plus, if Q6 warranted it, one supporting concern (e.g. testing/CI, security). Each epic gets a `key` (kebab, e.g. `foundation`), a `title`, and a `label` (e.g. `epic:foundation`).
    - **~3–8 first-wave issues TOTAL across all epics.** This is a **HARD small-spine cap: converge, do NOT exhaust.** Generate the smallest spine that delivers the core job and lets the user *start*; the user pulls more issues later. If you find yourself drafting a ninth issue, stop and fold it back — favor a tight walking skeleton over a complete backlog. Resist scope creep here exactly as you did at Q5.
    - For each issue, decide: a `title`, a body (rendered below), `labels` (include its epic label), an `epicKey` (one of the epic keys above), and **SYMBOLIC `dependsOn`** — a list of OTHER issues' `localId`s (kebab strings like `scaffold-repo`), **NEVER `#N`** (real issue numbers do not exist yet). Foundation issues typically have no dependencies; later-wave issues depend on the foundation slice. Keep the dependency shape consistent with the ordering the user confirmed at Q7.
  </step>

  <step>**Stage the manifest with the Write tool.** Create `.tiki/onboarding/draft/` if absent, then **Write** `.tiki/onboarding/draft/manifest.json` following the `<draft-manifest-schema>` below. Every issue carries a stable `localId` (the symbolic key used for edges before `#N` exist), its `epicKey`, `labels`, a symbolic `dependsOn` array, and a `bodyFile` naming its per-issue body file.</step>

  <step>**Stage each issue body with the Write tool.** For every issue in the manifest, **Write** `.tiki/onboarding/draft/issue-<localId>.md` following the `<draft-issue-body>` skeleton below. The body has `## Context` / `## Scope` / `## Success criteria` / `## Dependencies`. Success-criteria lines use the form `- [functional] SC1: <what needs to be true>` — the category token is one of `functional` / `testing` / `security` / `performance` / `documentation`, and the functional category is spelled **`functional`** (NEVER `functionality`). Dependency lines use the **placeholder token form** `Depends on {{localId}}` — a literal double-brace token, **NOT `#N`** — which the downstream push stage swaps for the real `Depends on #N` once issues are created.</step>

  <step>**Validate the dependency graph before rendering.** For every issue, check that **each `localId` in its `dependsOn` resolves to an existing issue in the manifest** (i.e. some manifest issue has that `localId`). If any `dependsOn` entry names a `localId` that is not present, surface the `dangling-dependency` error and fix the manifest before continuing — a dangling symbolic id would leave a stranded `{{token}}` in the body after the downstream push stage performs its token swap. Likewise confirm each `{{localId}}` placeholder written into an issue body matches an entry in that issue's `dependsOn`. Do not proceed to the review gate until every symbolic edge resolves.</step>

  <step>**Render the tree, then the review gate.** In chat, render the staged spine as a tree: each **epic** (key + title + label), its **issues** (title + labels), each issue's **dependencies** (as `localId → localId` edges, since `#N` don't exist yet), and the **target release** (the manifest `version` / `milestone`). Then present **one** AskUserQuestion review gate per `<review-gate>` below:
    - **Push to GitHub** — hand off to the downstream push capability (see the handoff note below). This stage does NOT itself call `gh` or create issues.
    - **Edit a draft** — point the user at the draft file(s) under `.tiki/onboarding/draft/`, tell them to edit the markdown/JSON by hand, and re-run **`/tiki:scaffold resume`** to re-render and re-review.
    - **Save draft & exit** — leave the draft staged under `.tiki/onboarding/draft/` and stop. The draft persists for a later `resume`.
    - **Discard** — remove the `.tiki/onboarding/draft/` directory (via Bash) so no stale scratch lingers, and stop.
    Nothing has touched GitHub at this point. Only **Push to GitHub** crosses into outward-facing work.
  </step>

  ## The gated push (two-pass GitHub create) — only on "Push to GitHub"

  This is the final stage. It runs ONLY when the user chose **Push to GitHub** at the review gate (or **Push the spine to GitHub** in the `<next-actions>` follow-on). It reads the staged draft under `.tiki/onboarding/draft/`, creates real GitHub issues in two passes (create, then inject resolved dependency edges), groups them into a release so the dependency graph renders them, backfills the brief, and moves the draft to `.tiki/onboarding/pushed/` so a resume can never double-create. Scaffold still drives no pipeline here — no `transition`, no journal; issue numbers come into existence only as `gh` returns them.

  **Idempotency contract (a push interrupted mid-flight must be safely re-runnable).** The danger is a PARTIAL push: creates succeed for issues 1..k, then issue k+1 (or the network) fails. A naive re-run would create issue 1..k a second time. Two safeguards prevent that, and BOTH are mandatory:
  - **Persist the `localId → #N` map incrementally.** Maintain `.tiki/onboarding/draft/idmap.json` — a JSON object mapping each `localId` to its created issue number. **Write it with the Write tool after EACH successful create**, not once at the end. If the run dies after issue k, the map on disk already records issues 1..k.
  - **Probe before every create.** BEFORE creating any issue in Pass A, check whether it already exists: (a) if its `localId` is already a key in `idmap.json`, it was created on a prior run — SKIP it and reuse the recorded `#N`; (b) otherwise probe GitHub for an exact title match via `gh issue list --search "<title> in:title" --json number,title` and, if a row's `title` matches exactly, record that number into `idmap.json` and SKIP the create. Only create when neither check finds the issue. This makes Pass A converge to the same `localId → #N` map whether it runs once cleanly or resumes after a mid-push failure.

  <step>**Preflight auth (abort on failure).** Run, via Bash, `gh auth status`. If it exits non-zero, **abort the push** (the local draft is untouched and still resumable) and tell the user to run `gh auth login`, then re-run **`/tiki:scaffold resume`** and choose **Push to GitHub** again. Surface the `push-auth-failed` error. Do NOT attempt any `gh issue create` while unauthenticated.</step>

  <step>**Load the draft and resolve the repo.** Read `.tiki/onboarding/draft/manifest.json` for the epics, issues, `version`, and `milestone`. Read each issue's `bodyFile` (`issue-<localId>.md`). Read `.tiki/onboarding/draft/idmap.json` if it exists (a prior partial push) into the in-memory `localId → #N` map; otherwise start with an empty map. Determine `{owner}/{repo}` from the current repo (`gh repo view --json owner,name --jq '.owner.login + "/" + .name'`) for the milestone API call below.</step>

  <step>**Optional milestone.** If `manifest.milestone` is set (non-null) and a milestone with that title does not already exist, create it:
    ```bash
    gh api repos/{owner}/{repo}/milestones -f title="{milestone}" -f state=open
    ```
    Check existence first with `gh api repos/{owner}/{repo}/milestones --jq '.[] | select(.title=="{milestone}") | .number'`; only create when absent (so a re-run does not duplicate the milestone). If `manifest.milestone` is null/absent, skip this step and omit `--milestone` from the creates below.</step>

  <step>**Pass A — create the issues.** Process the manifest's `issues` in order. For EACH issue:
    1. **Existence probe (idempotency).** If the issue's `localId` is already a key in the in-memory `idmap` (loaded from `idmap.json`), SKIP creation and keep the recorded `#N`. Otherwise run `gh issue list --search "<title> in:title" --json number,title` and, if any returned row's `title` exactly equals this issue's `title`, record that row's `number` into the map and SKIP creation. Only if neither finds it do you create.
    2. **Create.** `gh issue create --title "<title>" --body-file .tiki/onboarding/draft/issue-<localId>.md --label "<label>" [--label "<label>" …] [--milestone "{milestone}"]` — one `--label` per label in the issue's `labels`, and `--milestone` only when `manifest.milestone` is set. `gh issue create` prints the new issue's URL to stdout on success.
    3. **Parse the number.** Take the last path segment of that URL (split on `/`, take the final component — mirroring how the desktop's `create_github_issue` parses the number via `rsplit('/').next()` in `apps/desktop/src-tauri/src/github/issues.rs`) and parse it as the integer `#N`.
    4. **Persist immediately.** Record `localId → #N` into the in-memory map AND **Write `.tiki/onboarding/draft/idmap.json` with the Write tool right now** (after THIS create), before moving to the next issue. This incremental persist is what makes a mid-push failure resumable without duplicates.

    After Pass A, the `idmap` covers every manifest issue (`localId → #N`).</step>

  <step>**Pass B — inject the resolved dependency edges.** For every manifest issue that has a non-empty `dependsOn`, re-render its body: replace each `{{localId}}` placeholder token with `Depends on #<resolved>`, where `<resolved>` is `idmap[localId]` (the dependency's real number). Per the edge-direction rule, the dependency line lives in the DEPENDENT issue's body, so injecting `Depends on #<dep>` into issue X's body yields the graph edge `dep → X`. Then push the rewritten body:
    ```bash
    gh issue edit <#N> --body-file <rerendered-body-file>
    ```
    where `<#N>` is the dependent issue's own number (`idmap[its localId]`). Issues whose `dependsOn` is empty keep their `## Dependencies` `None` body and need no edit. Re-running Pass B is safe — re-applying the same resolved bodies is idempotent.</step>

  <step>**Write the release definition file with the Write tool.** Group every created issue into one release so the dependency graph renders them — the graph only shows issues grouped into a release; ungrouped issues are not even nodes. **Write `.tiki/releases/{version}.json` with the Write tool** (`{version}` = the manifest's `version`; create `.tiki/releases/` if absent), with this shape:
    ```json
    {
      "version": "{version}",
      "status": "active",
      "issues": [
        { "number": 101, "title": "Stand up the project skeleton" }
      ],
      "createdAt": "{ISO 8601 timestamp now}"
    }
    ```
    Include EVERY issue from the manifest, each as a `{ number, title }` object using the resolved `#N` from `idmap` and the manifest title. This release grouping is REQUIRED — without it the dependency edges injected in Pass B have no graph to render in. (The framework cannot call `save_tiki_release` — that's a desktop-only Tauri IPC — so author this file with the Write tool, exactly as `release.md` does when no release file exists yet.)</step>

  <step>**Backfill the brief front-matter.** Edit `.tiki/research/<slug>-brief.md` so its `issues: []` front-matter key lists the real created numbers, e.g. `issues: [101, 102, 103]` (ascending). This closes the loop the front-matter schema's `# backfilled with real #N after the spine is pushed` comment promised, so the brief surfaces the live issues during `/tiki:plan` and `/tiki:execute`.</step>

  <step>**Move the draft to `pushed/` (LAST, after the release file and backfill are done).** Only after the release definition is written AND the brief is backfilled, move the staged draft out of the way so a later `resume` cannot re-enter the push and double-create:
    ```bash
    mkdir -p .tiki/onboarding
    mv .tiki/onboarding/draft .tiki/onboarding/pushed
    ```
    Ordering matters: if the run is interrupted BEFORE this move, the draft (with its incrementally-persisted `idmap.json`) stays under `draft/` and a `resume` re-enters the push, skips the already-created issues via the existence probe, and completes the remaining steps. The move is the commit point that marks the push complete.</step>

  <step>**Hand off via `<next-actions>`.** The spine is now live on GitHub, grouped into `{version}`, with dependency edges resolved. Present the `<next-actions>` follow-on so the user can start work: `/tiki:get <first-issue>` to begin the first issue, `/tiki:release {version}` to drive the whole wave, or open the desktop board to see the dependency graph.</step>
</instructions>

<front-matter-schema>
The brief reuses the research-doc front-matter (so it surfaces during `/tiki:plan` and `/tiki:execute`), plus two machine-readable keys consumed by downstream tooling. The research-doc front-matter parser ignores keys it does not recognize, so the extra `type:` / `stack:` keys are safe to include.

```yaml
---
topic: <slug>-brief
tags: [<type>, greenfield, scaffold]
issues: []            # backfilled with real #N after the spine is pushed
created: <ISO 8601 timestamp>
type: <web|api|cli|library|desktop|other>   # machine-readable project type (Q2)
stack: [<lang/framework>, <key tech>, ...]   # machine-readable stack list (Q4)
---
```

Field rules:
- `topic`: `<slug>-brief`, matching the filename (without `.md`).
- `tags`: JSON-style array of short lowercase strings; lead with the project `<type>`.
- `issues`: JSON-style array of integer issue numbers — empty (`[]`) until a spine is pushed.
- `created`: ISO 8601 timestamp at write time, e.g. `2026-06-14T17:42:00.000Z`.
- `type`: single lowercase token mirroring Q2 (for #293/#294 tooling).
- `stack`: JSON-style array mirroring Q4's chosen stack (for #293/#294 tooling).
</front-matter-schema>

<brief-skeleton>
After the closing `---`, write these sections (markdown). Fill each from the mapped interview answers; keep it tight.

```markdown
# <Project> — Project Brief

## Overview
(Q1 — the 1–2 sentence vision)

## Users & problem
(Q3 — who uses it and the one job it must do well)

## Type & stack
(Q2 + Q4 — project type, language/framework, must-use tech)

## Scope: in / out
(Q5 — the trimmed must-have set, AND explicit non-goals: what v0.1 deliberately omits)

## Constraints
(Q4 — compliance, deadlines, hard requirements)

## What needs to be true
(The project-wide requirements list — the "if this is the app, then these must hold."
 These are the cross-cutting truths that do not belong to a single issue. Per-issue
 requirements become success criteria in individual issue bodies later.)

## Proposed epics & first wave
(Q5 + Q7 — the small spine: 2–4 epics, ~3–8 first-wave capabilities, in the confirmed
 ordering. This mirrors the draft manifest the next stage will produce.)

## Assumptions & open questions
(Every "you decide" gap you filled in, plus anything still unresolved for the user to revisit.)
```
</brief-skeleton>

<draft-manifest-schema>
The draft manifest is the machine-readable spine staged at `.tiki/onboarding/draft/manifest.json`. It is transient scratch (not committed state, not a `.tiki/` schema object) — the downstream push capability reads it to create issues and resolve edges.

```json
{
  "version": "v0.1.0",
  "slug": "<slug>",
  "createdAt": "<ISO 8601 timestamp>",
  "milestone": "v0.1.0",
  "epics": [
    { "key": "foundation", "title": "Foundation & scaffolding", "label": "epic:foundation" }
  ],
  "issues": [
    {
      "localId": "scaffold-repo",
      "title": "Stand up the project skeleton",
      "epicKey": "foundation",
      "labels": ["epic:foundation"],
      "dependsOn": [],
      "bodyFile": "issue-scaffold-repo.md"
    },
    {
      "localId": "auth-api",
      "title": "User auth endpoints",
      "epicKey": "core",
      "labels": ["epic:core"],
      "dependsOn": ["scaffold-repo"],
      "bodyFile": "issue-auth-api.md"
    }
  ]
}
```

Field rules:
- `version`: target release tag for the first wave (e.g. `v0.1.0`); mirrors `milestone` unless the user picked a different milestone.
- `slug`: the same kebab `<slug>` as the brief.
- `createdAt`: ISO 8601 timestamp at draft-write time.
- `milestone`: optional GitHub milestone title; omit or `null` if the user did not want one.
- `epics`: 2–4 entries; each `{ key, title, label }`. Epic 1 is the Foundation epic. `key` is kebab; `label` is `epic:<key>`.
- `issues`: 3–8 entries total (the small-spine cap). Each `{ localId, title, epicKey, labels, dependsOn, bodyFile }`.
  - `localId`: stable kebab symbolic id, unique within the manifest; used for dependency edges before `#N` exist.
  - `epicKey`: one of the `epics[].key` values.
  - `labels`: JSON array of label strings; include the issue's epic label.
  - `dependsOn`: JSON array of OTHER issues' `localId`s — symbolic, NEVER `#N`. May be empty.
  - `bodyFile`: `issue-<localId>.md`, the per-issue body file in the same draft directory.
</draft-manifest-schema>

<draft-issue-body>
Each issue body is staged at `.tiki/onboarding/draft/issue-<localId>.md`. Render these four sections (markdown), filled from the brief and the issue's role in the spine:

```markdown
## Context
(1–2 lines tying this issue to the brief — why it exists, what slice it delivers.)

## Scope
(What this ONE issue does, and what it explicitly does not — in / out for this issue.)

## Success criteria
- [functional] SC1: <what must be true when this issue is done>
- [testing] SC2: <a verifiable test/behavior, if Q6 warranted testing>

## Dependencies
Depends on {{scaffold-repo}}
```

Body rules:
- **Success-criteria category** is one of `functional` / `testing` / `security` / `performance` / `documentation`. The functional category is spelled **`functional`** — NEVER `functionality`. Number criteria `SC1`, `SC2`, … sequentially.
- **Dependencies** use the literal placeholder token `Depends on {{localId}}` — double-brace, one line per dependency — matching the issue's `dependsOn` array. The downstream push stage swaps each `{{localId}}` for the real `Depends on #N`. If the issue has no dependencies, write `None` under the `## Dependencies` heading (no `{{...}}` token).
</draft-issue-body>

<review-gate>
After rendering the spine tree in chat, present exactly ONE AskUserQuestion. Nothing has touched GitHub yet; this is the single gate before anything outward-facing.

- question: "Draft spine staged at .tiki/onboarding/draft/. What now?"
- header: "Review draft"
- options:
  - label: "Push to GitHub"
    description: "Hand off the staged spine to the push capability — create the issues, resolve {{deps}} to #N, group the release"
  - label: "Edit a draft"
    description: "Edit the markdown/JSON under .tiki/onboarding/draft/ by hand, then run /tiki:scaffold resume to re-review"
  - label: "Save draft & exit"
    description: "Leave the draft staged for a later /tiki:scaffold resume — nothing pushed"
  - label: "Discard"
    description: "Remove .tiki/onboarding/draft/ (transient scratch) and stop"

Branch behavior:
- **Push to GitHub** → run the gated two-pass push stage above (preflight auth, create issues, inject resolved edges, write the release definition, backfill the brief, move the draft to `pushed/`), then present the `<next-actions>` follow-on.
- **Edit a draft** → point at the draft files and instruct `/tiki:scaffold resume` after editing.
- **Save draft & exit** → stop with the draft intact.
- **Discard** → remove the draft directory with Bash (`rm -rf .tiki/onboarding/draft`) and stop.
</review-gate>

<output>
## Draft Spine Staged: {slug}

**Brief:** `.tiki/research/{slug}-brief.md`
**Draft:** `.tiki/onboarding/draft/` (manifest.json + {M} issue body files)
**Type:** {type}
**Stack:** {stack as comma-separated list}
**Spine:** {N} epics, {M} first-wave issues, target {version}

---

{Rendered tree: epics → issues → symbolic deps → labels → target release...}

---

*Draft staged locally. Nothing has been pushed to GitHub yet — choose **Push to GitHub** at the review gate to hand off the spine.*
</output>

<errors>
  <error type="no-confirmation">
    Scope was not approved at the synthesis checkpoint (Q8), so nothing was written. Re-run `/tiki:scaffold` to resume the interview, or choose **Draft it** at Q8 to write the brief.
  </error>
  <error type="invalid-slug">
    Project slug "{slug}" is invalid. Must be lowercase kebab-case (letters, digits, hyphens only) and must not contain `/` or `..`. Examples: `task-tracker`, `weather-api`, `notes-cli`. Pick a clean project name and retry.
  </error>
  <error type="write-failed">
    Failed to write `.tiki/research/{slug}-brief.md`: {error message}. Check that the working directory is writable and that `.tiki/` exists.
  </error>
  <error type="draft-write-failed">
    Failed to write the draft spine under `.tiki/onboarding/draft/`: {error message}. Check that the working directory is writable. The brief at `.tiki/research/{slug}-brief.md` is already saved — re-run `/tiki:scaffold resume` to retry the draft stage.
  </error>
  <error type="dangling-dependency">
    Issue "{localId}" lists a dependency on "{missingLocalId}", which is not an issue in the draft manifest. Every `dependsOn` entry must resolve to another issue's `localId`, or the downstream push stage will leave a stranded `{{token}}` in the body. Fix `.tiki/onboarding/draft/manifest.json` (add the missing issue or correct the id) and re-render before reviewing.
  </error>
  <error type="push-auth-failed">
    `gh auth status` failed, so the GitHub push cannot proceed. The staged draft under `.tiki/onboarding/draft/` is untouched and still resumable — nothing was created. Run `gh auth login`, then re-run `/tiki:scaffold resume` and choose **Push to GitHub** again. (If a prior push got partway, its `idmap.json` records what was already created — the re-run probes for and skips those, so no duplicates.)
  </error>
</errors>

<next-actions>
This follow-on runs AFTER the gated push stage has completed: the issues are live on GitHub, the `{{localId}}` tokens are resolved to `Depends on #N`, the issues are grouped into `.tiki/releases/{version}.json`, the brief's `issues:` front-matter is backfilled, and the draft has moved to `.tiki/onboarding/pushed/`. Present this so the user can start work:

- question: "Spine pushed to GitHub and grouped into {version}. What next?"
- header: "Spine pushed"
- options:
  - label: "Start the first issue"
    description: "Run /tiki:get <first-issue> to begin the foundation slice"
  - label: "Drive the whole release"
    description: "Run /tiki:release {version} to execute every issue in dependency order"
  - label: "Open the board"
    description: "Open the desktop app to see the new issues and the dependency graph for {version}"

The push has already happened by this point — the issues exist, the edges are resolved, and the release is grouped. These actions move from scaffolding into the normal Tiki pipeline.
</next-actions>
