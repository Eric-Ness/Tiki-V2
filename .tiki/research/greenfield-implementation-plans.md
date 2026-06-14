---
topic: greenfield-implementation-plans
tags: [greenfield, onboarding, planning, v1.0.0, epic-a, epic-b, epic-c]
issues: [283, 284, 285, 287, 289, 290, 291, 293, 294]
created: 2026-06-14T00:00:00.000Z
---

# Greenfield Onboarding — Consolidated Implementation Plans (v1.0.0)

Output of four parallel planning agents (2026-06-14), each grounded in real code. Companion to
[[greenfield-onboarding]] (research+verification) and [[scaffold-interview-design]] (Epic B design).
This is the PLAN layer; a review/audit pass follows.

---

## Cross-cutting contracts (the load-bearing seams)

**C1 — Backend command contract (#283 produces → #284/#285/#287 consume).** #283 must expose, as
registered Tauri commands (lib.rs invoke_handler):
- `init_tiki_project(projectPath, initGit?) -> InitReport` — composes `install_framework` inner +
  guarded state seed + starter `.gitignore`; **does NOT call switch_project** (caller sequences it).
- `git_init(projectPath, defaultBranch?)`, `git_add_remote(projectPath,name,url)`,
  `git_commit_all(projectPath,msg)`, `git_remote_get(projectPath) -> Option<String>` — all via `hidden_command`.
- **`check_greenfield_readiness(projectPath) -> GreenfieldReport`** — NEW; composes `check_gh_auth` +
  is-git-repo + `read_framework_version` + `validate_tiki_directory` + remote/.gitignore checks.
  **GAP FOUND:** the A-Rust plan for #283 did not list this command, but the A-Frontend plan for #284
  requires it from #283. → must be added to #283 scope (or filed as the #284/#283 boundary).
- `InitReport { frameworkVersion, seededState, wroteGitignore, gitInitialized, warnings[] }` (camelCase).

**C2 — Brief-schema contract (#289 produces → #294 + #293 consume).** #294 parses the brief by section
heading (Overview / Users / Type & stack / Scope / Constraints / What needs to be true / Proposed epics —
already in the design spec). #293 wants a **machine-readable** project type for template auto-select, but
the brief stores type as prose. → request a small addition to #289: stamp `type:` (and maybe `stack:`) in
the brief frontmatter. Recommend a shared "brief schema" fixture in `__tests__/` both reference, so a
heading rename breaks a test rather than silently half-filling CLAUDE.md.

**C3 — File ownership (collision control).**
- Epic A: only `ProjectsSection.tsx` is shared → assign to **#285 exclusively**; #284 adds only NEW files
  (`greenfieldReadiness.ts`, `GreenfieldChecklist.tsx/.css`, tests) + a Settings mount. `commands.rs`/
  `github/git.rs`/`lib.rs` shared by #283/#287 → **land #283 first** (incl. `git_remote_get`) so #287 has
  near-zero backend edits. Build order: **#283 → #284 → #285 → #287**.
- Epic B: all three issues edit ONE new file `packages/framework/commands/scaffold.md` sequentially
  (#289 → #290 → #291), each appending `<step>`s/branch points. Unusual but correct.

---

## Epic A — skeleton (Rust + frontend)

### #283 foundation — confidence HIGH
- Refactor `install_framework` body into a private `install_framework_inner(project, version)` so
  `init_tiki_project` calls it without an AppHandle round-trip.
- **Guarded seed = dedicated `seed_state_if_absent` in fs_utils.rs** writing the canonical literal
  `{schemaVersion:1,activeWork:{}}` ONLY if state.json absent. Do NOT reuse `write_fresh_state`
  (destructive: backs up + clobbers, fs_utils.rs:325-345).
- Net-new git layer in github/git.rs: `git_init` (use `git init -b main`, fallback `symbolic-ref` for git
  <2.28), `git_add_remote`, `git_commit_all`, `git_remote_get` — all via `hidden_command` or the
  source-scan guard (github/mod.rs:202-258) fails the build.
- **NEW EDGE CASE (issue omission):** initial `git commit` FAILS on a fresh machine with no
  `user.name`/`user.email`. → make the initial commit **best-effort/non-fatal**; surface a warning in
  InitReport, don't abort init. `git_init` + `.gitignore` is the load-bearing part (SC2 satisfied by an
  empty repo).
- `.gitignore`: skip-if-present; policy = ignore `.tiki/journal.ndjson`, `.tiki/backups/`, `*.broken.json`,
  `node_modules/`, `target/`, `dist/`; commit state.json/plans/releases/research.
- Phases: (1) git layer + register; (2) `seed_state_if_absent` + `write_starter_gitignore`; (3)
  `init_tiki_project` + register + **`check_greenfield_readiness`** (per C1 gap).
- Tests: idempotency guard (existing state.json byte-identical, NO backup created), blank-folder happy path,
  git layer, hygiene guard stays green. Use `cargo clippy --all-targets --deny warnings` (v0.9.4 lesson).

### #287 create-repo — confidence HIGH backend / MEDIUM completion-UX
- Composition issue. `gh repo create --source=. --remote=origin --push` wires origin itself (gh-native
  path) — do NOT also call `git_add_remote` (errors "remote origin already exists"). Two paths:
  create-new (gh-native) vs bring-your-own-URL (use `git_add_remote`).
- Backend resolver `github_remote_setup_state(projectPath) -> {is_git_repo,has_origin,origin_url,gh_authed}`
  composes detectors for the UI to pick the guided step. No interactive `gh` in Rust (A5).
- **No structured terminal-completion event** (PTY streams bytes). SC2 "detects completion" → satisfy via
  **manual Refresh / re-poll** `git_remote_get`/`check_gh_auth`, not terminal-output parsing.
- Terminal handoff path exists: `writeToActiveTerminal` (useCommandActions.ts:18). Defer `--push` behind a
  separate confirm so a failed push doesn't poison "origin wired" success.

### #284 readiness checklist — confidence MED-HIGH
- **KEY CORRECTION:** cannot reuse `tiki_doctor` (requires valid `.tiki`, checks `.tiki` health only).
  Needs the NEW `check_greenfield_readiness` (C1). Clone the DiagnosticsPanel *pattern*, not its data.
- NEW parallel module: `greenfieldReadiness.ts` (pure reducer, `GreenfieldAction` string-union:
  installFramework|seedState|gitInit|createGitignore|ghAuthLogin|createRemote) + `GreenfieldChecklist.tsx`
  with a **per-row Fix button** (model: ProjectCard.tsx:26-51 runInstall + per-row pending guard + toast +
  re-load). Do NOT widen diagnosticsSummary's `Finding.action` or refactor DiagnosticsPanel.
- Rust-invoke fixes (gitInit/seedState/installFramework/createGitignore) re-check via `load()`;
  terminal-handoff fixes (ghAuthLogin/createRemote) via `writeToActiveTerminal` + manual Re-check.
  Handle `writeToActiveTerminal` returning null (no terminal) → toast.
- Risks: fresh-ref ESLint rule (#279) — keep per-row pending in component useState, never a store selector;
  module-level EMPTY_* constants; pass raw `projectPath` to Rust (don't string-build `.tiki` paths in TS).
- Mount in Settings (parallels DiagnosticsPanel); #285 may embed it later (follow-up).

### #285 add-project Initialize UX — confidence HIGH
- Replace dead-end at ProjectsSection.tsx:110-114 with `window.confirm("Initialize Tiki here?")`
  (matches handleRemoveProject convention). On confirm: `init_tiki_project` → `switch_project` (ordering!)
  → `addProject`. ~40-line change in ONE file.
- Owns ProjectsSection.tsx exclusively (C3). Defer embedded-checklist confirmation surface (use
  window.confirm) unless #284 ships first.

---

## Epic B — /tiki:scaffold (single new file, 3 issues) — see [[scaffold-interview-design]]

- **Three test gates, all satisfiable:** (1) commands-sync — run `node packages/framework/install.js`
  after EVERY edit to scaffold.md (make it the last step of every phase); (2) forbidden-ack scan iterates
  every .md — avoid the 4 phrases, esp. "write … directly in (the) JSON" (matches the regex!) — phrase as
  "Write the file via the Write tool"; (3) transition/journal coverage tables are filename-keyed →
  scaffold.md absent → automatically exempt. **Scaffold must contain ZERO `state.mjs` strings.**

### #289 interview → brief — confidence HIGH
- New scaffold.md (`tools: Bash, Read, Write, AskUserQuestion`). Stage-0 preflight (resume detect; gh/git
  warn-but-proceed; reuse research.md slug rule + path-traversal guard + existing-doc Merge/Overwrite gate).
- Interview Q1–Q8 authored as `<instructions>` `<step>`s. **Novel: no precedent for a sustained multi-turn
  loop.** Drive convergence with HARD imperatives: "at most 8 turns; skip already-known; if N≥6 force the
  synthesis checkpoint; on 'you decide' stop asking and fill + surface at Q8." Q8 is the single write-gate
  (bail-before-Q8 = nothing written = clean).
- Emit brief → `.tiki/research/<slug>-brief.md` (research-doc frontmatter; "What needs to be true" section).
  **Add `type:`/`stack:` frontmatter** per C2.
- Resume seam flag: #289 produces no manifest, so its resume is just "brief exists → Overwrite"; full resume
  closes only when #290 lands.

### #290 draft spine + review gate — confidence HIGH
- Continuation in scaffold.md. Decompose: 2–4 epics (Epic 1 = Foundation), 3–8 issues, per-issue SCs as
  markdown `- [functional] SC1: …` (NOT "functionality"), symbolic `dependsOn`.
- Stage `.tiki/onboarding/draft/`: `manifest.json {version,slug,createdAt,milestone?,epics[],issues[]}` +
  `issue-<localId>.md` each (body `## Dependencies` uses `Depends on {{localId}}` PLACEHOLDER, not #N).
- Review gate: one AskUserQuestion (Push / Edit-a-draft / Save & exit / Discard). Edit = "edit file +
  `/tiki:scaffold resume`" (don't build in-chat node editing).
- **Add validation:** every `dependsOn` localId resolves to a manifest issue (else #291's swap leaves a
  dangling `{{token}}`). Flag `.tiki/onboarding/` gitignore policy (transient scratch).

### #291 two-pass push + grouping — confidence MED-HIGH
- Pass A: `gh issue create --title --body-file --label [--milestone]` per issue; `#N = ${url##*/}`
  (mirrors issues.rs:130-137). Pass B: replace `{{localId}}`→`Depends on #N` in DEPENDENT's body
  (verified edge direction N→X), `gh issue edit --body-file`. Write `.tiki/releases/{version}.json`
  (issues as `{number,title}` objects) — MANDATORY or edges/nodes don't render (releaseIssueNumbers filter).
- **UNDERSPECIFIED RISK (most important):** partial push (create 1..k then fail) double-creates on re-run.
  → write `localId→#N` to `draft/idmap.json` after EACH create; on re-run skip localIds already in idmap;
  move draft→pushed only after release file + backfill done. SC3 only covers the clean re-run — build the
  idmap checkpoint anyway.
- Optional/opt-in-OFF defaults for v1.0.0: epic tracking issues, milestone creation. Circular-dep
  pre-validation explicitly out of scope.

---

## Epic C — templates + CLAUDE.md (later) — confidence MEDIUM

### #293 templates (#114) — confidence MEDIUM
- **#114 is a one-line spec** ("Project templates for `.tiki/` initialization") — AMBIGUOUS: could mean
  seed `.tiki/` subdirs (which #283 already covers lazily) vs. real starter CODE per language. #293 reframes
  to starter code → confirm + update #114's row.
- Embed via a third `include_dir!` over NEW `packages/framework/templates/<type>/…` + `templates/manifest.json`.
- **TRAP:** both the Rust install loop (`FRAMEWORK_COMMANDS.files()`) and `install.js` `copyDir` are FLAT
  (single-dir). Templates are nested → need a **recursive writer** scoped to the selected subdir. Biggest
  net-new mechanic; easy to under-estimate.
- **Selection should be desktop-driven** (Rust `scaffold_template(projectPath, templateId)`), NOT the
  interview — scaffold never mutates the filesystem (it emits drafts only). Informed by the brief's type,
  but executed by an Epic-A-adjacent desktop action (#285).
- Minimal first slice: 1–2 types (Node/TS + Rust, the ones the monorepo dogfoods), bare button, guard every
  file (no overwrite). Defer Python/Go/etc.

### #294 CLAUDE.md from brief — confidence MED-HIGH
- **New framework command `/tiki:claudemd`** (NOT a scaffold phase — keeps scaffold ≤8 turns and lets this
  run any time a brief exists). Reads the brief (Phase 1: slug arg or glob), synthesizes CLAUDE.md mapping
  brief sections → Overview/Structure/Dev-Commands/Conventions/What-needs-to-be-true, review gate
  (clone research.md:33 Merge/Overwrite/Cancel), Write to `<project>/CLAUDE.md`.
- **No re-interview = structural:** forbid `AskUserQuestion` in the synthesis path (only the final review
  gate + multi-brief disambiguation); encode missing facts as `TODO:` placeholders, never ask.
- Risk: greenfield brief is thin → Structure/Commands are aspirational → mark TODOs, don't invent paths;
  review gate is the backstop. Heading-drift coupling with #289 → share a fixture brief.
- Earliest-unblockable Epic C item (needs only #289, not the full push). Develop in parallel vs a fixture.

---

## Open decisions — RESOLVED (2026-06-14, applied to issue bodies)

1. **`check_greenfield_readiness` lives in #284** (NOT #283), shared by #287 (one detector, not two). ✅ #283/#284/#287 bodies updated.
2. **#289 brief stamps `type:`/`stack:` frontmatter** + shared fixture test. ✅ #289 updated.
3. **#283 initial commit best-effort/non-fatal** (git-identity-missing → warning, not abort). ✅ #283 updated.
4. **#291 partial-push hardening** = pre-create existence probe / pending marker, into SC3 (not just idmap). ✅ #291 updated.
5. **#293 templates DEFERRED to v1.1**; selection desktop-driven; deps on #285+#289 declared. ✅ #293/#292 updated.
6. **#294 = new `/tiki:claudemd` command**, kept in v1.0.0 (earliest-unblockable Epic C item). ✅ #292 updated.
7. **v1.0.0 scope = Epics A + B + #294.** Cuts applied: epic-tracking-issues OFF by default; InitReport→success+warnings;
   merge the two detector resolvers; cut the `<2.28` git fallback; defer `--push` behind a confirm.

**Build order:** #283 → #284 → #285 → #287 (Epic A) → #289 → #290 → #291 (Epic B) → #294 (Epic C). Active: #283.
