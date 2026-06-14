---
topic: greenfield-onboarding
tags: [greenfield, onboarding, init, scaffold, v1.0.0]
issues: []
created: 2026-06-13T00:00:00.000Z
---

# Greenfield Onboarding — Research Notes (toward v1.0.0)

Goal: let a user point the desktop app at a **blank folder** and end up with a working,
pipeline-runnable Tiki project — then optionally run a conversational interview that scopes
the project into a draft tree of epics → issues (with success criteria + dependency edges)
that can be pushed to GitHub on explicit confirmation.

Decided framing: **two distinct mechanisms**, not one "init" button:
- **Skeleton** (Epic A): deterministic, idempotent, Rust/Tauri side. Makes the folder *valid + runnable*.
- **Scoping** (Epic B): generative, conversational, LLM/terminal side. Decides *what to build*.
- **Templates + CLAUDE.md** (Epic C): separate/later; *fed by* B's brief (must not re-interview).

This is the v0.9.4 → v1.0.0 milestone.

---

## Research findings (3 parallel agents, 2026-06-13)

### A. Skeleton / desktop init mechanics — ~80% already exists

- The only thing blocking a blank folder is `validate_tiki_directory` (commands.rs:217), a pure
  `.tiki` exists+is_dir check. `handleAddProject` dead-ends on false (ProjectsSection.tsx:110-114).
- `install_framework` (commands.rs:715-765) already writes: `.claude/commands/tiki/*.md`,
  `.claude/tiki/scripts/*.mjs`, the reconciler hook in `.claude/settings.json`
  (`ensure_reconciler_hook` :772-832), and `.tiki/.framework-version`.
  It does **NOT**: seed `state.json`, create git, `.gitignore`, or any GitHub remote.
  It's only reachable *after* validate passes → chicken-and-egg for blank folders.
- Reusable primitive for state seeding: `fs_utils::write_fresh_state` / the `write_fresh_state`
  Tauri command (commands.rs:693-697) emit exactly `{"schemaVersion":1,"activeWork":{}}`.
  **GOTCHA:** it backs up + overwrites an existing state.json (fs_utils.rs:327-334) — init must
  guard to **only seed if absent** (idempotency / don't reset activeWork).
- Minimal valid state = `{schemaVersion:1, activeWork:{}}`; `.tiki` subdirs (plans/releases/research)
  are all created lazily, never required up front. Watcher tolerates late file creation
  (watcher.rs:88-124) — but seed state then call `switch_project` to (re)attach cleanly.
- **Big find — a full git/gh layer already exists** in `apps/desktop/src-tauri/src/github/`:
  - `hidden_command(program)` (github/mod.rs:21-33) — the ONLY allowed raw `Command::new`; adds
    Windows `CREATE_NO_WINDOW`. A build-failing source-scan guard enforces routing through it.
    **Any new git/gh spawn MUST use it** or the build breaks.
  - `check_gh_auth` (github/auth.rs:131-145) → runs `gh auth status` → the "gh authed?" row, ready.
  - `check_claude_cli` / `resolve_claude_cli` (github/auth.rs:110-126) — robust Windows PATH probe.
  - `get_current_branch` / `list_git_branches` (github/git.rs) → "is this a git repo?" signal exists
    (NotAGitRepo error class). Error classification in github/mod.rs:40-88.
- **Diagnostics checklist pattern is a near-perfect template to reuse:** backend `tiki_doctor`
  (commands.rs:856-939) → `DiagnosticsReport` struct (state.rs:637-676); frontend `DiagnosticsPanel.tsx`
  + pure reducer `utils/diagnosticsSummary.ts` render one row per finding **with a per-row Fix
  button** (`Finding.action`, DiagnosticsPanel.tsx:56-95). Clone this for a greenfield readiness
  checklist (git? remote? gh auth? .gitignore? framework? state?).
- Embedded assets via `include_dir!` (commands.rs:18,24). Adding a `templates/` dir (or hardcoding
  tiny `.gitignore`/state strings) is trivial.
- **Split recommendation:** Rust for *detection* + *local-only mutations* (`git init`, `.gitignore`,
  seed state — deterministic, no console flash). Keep `gh auth login` + `gh repo create`
  **terminal-driven** (OAuth device flow / interactive prompts).

### B. Framework command + artifact model

- Command = single `.md` (YAML frontmatter `name/description/argument/tools` + Markdown body with
  semantic XML blocks). New `scaffold.md` must declare `tools: Bash, Read, Write, AskUserQuestion`.
- **Process gotchas for a new command:** after adding `scaffold.md`, run `node packages/framework/install.js`
  to regenerate the dogfood copy or `commands-sync.test.mjs` fails. Avoid the forbidden phrases the
  `command-transition-coverage.test.mjs:242-269` source scan bans ("direct-JSON write acknowledged").
- **Scaffold should NOT drive the pipeline / not call `state.mjs transition`** — no issue number exists
  during the interview. Emit drafts, hand off to `/tiki:get N`. Keeps it off the transition-coverage
  tables (zero test churn) and respects "GitHub as source of truth."
- **Success criteria = exact fit for "what needs to be true":** `SuccessCriterion {id:'SC1', category?,
  description, verified?}` (shared/src/types/plan.ts:9-32). REVIEW already frames them as "What needs to
  be true for this to be done?" Categories: functional|testing|performance|security|documentation|other.
  (Latent bug: plan.md/createCriterion emit `"functionality"`; the enum is `"functional"` — emit the enum.)
- **"Epic" has NO native artifact** anywhere in the schema. Inventing `epic.json` = new TS type + JSON
  schema + Rust mirror + parity tests (per the two-mirrors rule). **Avoid.** Model an epic as: a heading
  in the research brief + (optionally) a GitHub tracking issue + a local release grouping.
- Reuse-as-is artifacts: research brief → `.tiki/research/*.md`; per-issue plan → `.tiki/plans/issue-N.json`
  (TikiPlan shape, plan.ts:91-118); grouping → `.tiki/releases/{version}.json`.
- No precedent for a sustained multi-turn interview, but `AskUserQuestion` (the bounded Q&A primitive,
  used inline + in `<next-actions>` menus) composes into one. Novel but within the documented tool surface.

### C. GitHub integration / issue generation

- All GitHub access = `gh` CLI. `create_github_issue` exists (issues.rs:72-141) — single issue,
  title/body/labels, parses #N from the returned URL. From a modal only. **No batch / tree creation,
  no `--milestone`/`--assignee` on create** → net-new for onboarding.
- **Dependency-edge text convention (exact, case-insensitive)** — parseDependencies.ts:47-68:
  - Hard: `depends on #N` | `blocked by #N` | `requires #N` | `after #N`
  - Soft: `related to #N` | `see also #N`, or a `## Related`-ish heading then `#N` bullets.
  - **HARD CONSTRAINT:** edges only render if **both** issues are in the **same release's issue set**
    (`releaseIssueNumbers` filter, parseDependencies.ts:70-72). So generated issues MUST be grouped into
    a `.tiki/releases/{version}.json` for the dependency graph to show their edges.
- **No GitHub native sub-issue / epic hierarchy is modeled** — zero structural detection. Don't rely on it.
- Releases grouping is **local-first** (`.tiki/releases/*.json`); GitHub only gets tag + Release +
  closed milestone on ship. Release-def `issues` are `[{number,title}]` objects (NOT the bare `number[]`
  used in state.json's ReleaseInfo — don't confuse the two).
- **Two-pass push pattern (net-new):** (A) create every issue, collect real #N from each URL into a
  placeholder→number map; (B) `gh issue edit --body-file` to inject `depends on #N` once numbers known,
  and write the `.tiki/releases/{version}.json` grouping so edges render.
- Draft-then-push discipline has precedent (release.md:22 drafts a local release def via `Write` rather
  than touching GitHub). Stage the tree in e.g. `.tiki/onboarding/draft/`, render for review, confirm, push.

---

## Decisions resolved by research

1. **Skeleton is Rust; scoping is a framework command.** (Where the LLM lives vs. deterministic mutation.)
2. **No new schema for epics.** Model as research-brief heading + optional GitHub tracking issue + local
   release grouping.
3. **"What needs to be true" → `SuccessCriterion`** (per-issue) + a project-wide narrative section in the
   brief (no top-level container needed).
4. **Scaffold emits drafts only; never drives the pipeline.** Hand off to `/tiki:get` / `/tiki:plan`.
5. **Generated issues must be grouped into a release def** (and have edge text) or the dep-graph shows nothing.
6. **`gh auth login` / `gh repo create` stay terminal-driven; everything else (detect + local mutate) is Rust.**

## Decisions made by user (2026-06-13)

- **Epic A scope = FULL:** framework + git init + GitHub remote wiring (incl. terminal-driven
  `gh repo create` / `gh auth login`). The complete "blank folder → pushable repo" story.
- **`.tiki/` commit policy = COMMIT state.json** + plans + releases + research (durable workflow
  record); gitignore only transient noise (journal.ndjson, *.backup). The starter `.gitignore`
  init writes must encode this split.
- **Issue generation = SMALL SPINE:** epics + first wave of issues (with deps), user pulls more
  later. "Converge, not exhaust." Interview must enforce this ceiling.

---

## Verification pass (3 adversarial agents, 2026-06-13) — corrections

Almost all claims CONFIRMED. Three corrections that change the plan, plus precision notes:

- **CORRECTION 1 (Epic A3) — diagnostics Fix button is NOT per-row.** `DiagnosticsPanel.tsx:86-95`
  renders a SINGLE header-level Fix button gated by `findings.some(f => f.action === ...)`, not one
  button per finding row (rows are icon+message only, :133-145). A greenfield checklist with several
  distinct fixes (git init / seed state / install framework / gh auth) **must extend the panel to render
  a Fix per row** — it's a clone-and-extend, not a free reuse.
- **CORRECTION 2 (scope reality of Epic A "full") — the git-WRITE layer is 0% built.** `github/git.rs`
  is read-only (`get_current_branch`, `list_git_branches` only). There is NO `git_init`, add/commit/push,
  remote-add, `gh repo create`, or `.gitignore` writer anywhere. The "~80% exists" applies to framework
  install + DETECTION (auth/repo-status); the git-write + remote-wiring side is entirely net-new (all
  routed through `hidden_command` to satisfy the source-scan guard).
- **CORRECTION 3 (cleanup item) — the `functionality` typo is ONLY in plan.md:193**, not in
  `createCriterion` (plan.ts:158-168 passes category through verbatim). So the fix is a one-line doc-template
  edit. A scaffold that emits plan-shaped SC JSON must use `"functional"` or it fails plan.schema.json.

Precision / load-bearing notes confirmed:
- `switch_project` (commands.rs:225-238) HARD-REQUIRES `.tiki` to exist → init must create `.tiki` + seed
  `state.json` BEFORE calling it.
- `write_fresh_state` is DESTRUCTIVE (backs up + overwrites) → guard with an existence check; only seed if absent.
- Dep-edge filter is even stronger than thought: the graph only fetches `release.issues`, so an ungrouped
  issue isn't even a NODE. BOTH endpoints must be in the same `.tiki/releases/*.json`. Edge direction:
  `depends on #N` in issue X's body = edge N→X; inject into the DEPENDENT's body (useDependencyGraph.ts:348-351).
- **Framework can call `gh` directly** (release.md, get.md precedent) → a scaffold framework command can run
  `gh issue create --body-file ... --milestone ...` itself, BYPASSING the Rust wrappers' missing flags. So
  **B6 (extend `create_github_issue`) is only needed if the DESKTOP UI drives creation**, not if scaffold does.
- Framework has NO release-JSON write IPC (release.md:22: can't call `save_tiki_release`) → scaffold must
  `Write` the `.tiki/releases/{version}.json` itself (issues as `{number,title}` objects).
- No pre-push circular-dependency / cross-release validation exists — add it ourselves if wanted.
- `check-release-readiness.mjs` lives at repo-root `scripts/`, not `packages/framework/scripts/`.

## Filed to GitHub — v1.0.0 roadmap (2026-06-13)

- **#286 Epic A — Greenfield skeleton:** #283 foundation (init_tiki_project + git-write layer +
  .gitignore + guarded seed) · #284 readiness checklist (per-row Fix) · #285 add-project Initialize
  UX · #287 guided "Create GitHub repo" + wire origin. (#284/#285/#287 `Depends on #283`.)
- **#288 Epic B — Greenfield scoping (depends on A):** #289 `/tiki:scaffold` interview→brief ·
  #290 draft spine + review gate (`Depends on #289`) · #291 two-pass push + release grouping
  (`Depends on #290`).
- **#292 Epic C — Templates + CLAUDE.md (follows A+B):** #293 starter templates (#114) ·
  #294 CLAUDE.md from brief (`Depends on #289`).

Active work: **#283** (loaded via /tiki:get, status pending). B/C filed for roadmap visibility, not started.

## Proposed work breakdown (see chat for the live list)

- **Epic A — Greenfield skeleton:** `init_tiki_project` Rust cmd (compose install_framework + guarded
  state seed + `.gitignore`), `git_init` via `hidden_command`, greenfield readiness checklist (clone of
  the diagnostics pattern with per-row Fix), and the "Initialize Tiki here" add-project UX.
- **Epic B — Scoping interview:** `/tiki:scaffold` command (AskUserQuestion interview loop) → project
  brief in `.tiki/research/` + draft epic/issue tree in `.tiki/onboarding/draft/` → review → two-pass
  `gh` push + release grouping. Extend `create_github_issue` for `--body-file`/`--milestone` + batch.
- **Epic C (separate/later):** language/project templates (#114) + `CLAUDE.md` generation, both reading
  the brief rather than re-interviewing.
