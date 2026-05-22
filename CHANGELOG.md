# Changelog

All notable changes to Tiki are recorded here. Per-release detail (with per-issue summaries) lives in `.tiki/releases/v*-changelog.md` and at <https://github.com/Eric-Ness/Tiki-V2/releases>.

This project loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [v0.7.3] — 2026-05-22

Release-tooling fix, dogfooded by its own release. Full detail: [`.tiki/releases/v0.7.3-changelog.md`](.tiki/releases/v0.7.3-changelog.md).

### Changed
- **`version-bump.mjs` now also bumps `.tiki/.framework-version`** (#229). The script skipped the 5th version file the release process tracks, so it went stale after every `pnpm version-bump` (v0.6.0 → v0.7.2) and was fixed by hand each release. Now a 5th entry in `files[]`; the file is plain text so its `update()` rewrites it wholesale (no trailing newline, no spurious diff). v0.7.3's own bump moved all 5 files in one invocation — the live acceptance test.

---

## [v0.7.2] — 2026-05-22

Wave 3 (part 2, final) of the status-desync epic (#218) — completes the epic. The high-risk store-consolidation refactor held back from v0.7.1, verified live before ship. Full detail: [`.tiki/releases/v0.7.2-changelog.md`](.tiki/releases/v0.7.2-changelog.md).

### Changed
- **Single `activeWork` store** (#223). Collapsed the two hand-synced `activeWork` copies (React-local `App.state` vs `tikiStateStore`) — which let the sidebar and kanban diverge — onto `tikiStateStore` as the single source for sidebar, kanban, detail, and stale detection. The store seeds `activeWork` to a stable `{}` ref, removing the inline `?? {}` fallback that is the #210/#212 render-loop crash class (dead `EMPTY_ACTIVE_WORK` removed). Shipped after a live `tauri:dev` gate, since the failure mode is a runtime render loop unit tests don't catch.

---

## [v0.7.1] — 2026-05-21

Wave 3 (part 1) of the status-desync epic (#218) — write-integrity hardening, no UI changes. Full detail: [`.tiki/releases/v0.7.1-changelog.md`](.tiki/releases/v0.7.1-changelog.md).

### Fixed
- **Write integrity — `state.mjs` lock + watcher repoint** (#224). `state.mjs` now serializes its read-modify-write behind an exclusive lockfile (stale-steal + exit-cleanup, Node built-ins) so chained writes during a release cascade can't lose an update. The desktop watcher's startup anchoring is fixed (it watched a doubled `cwd/.tiki/.tiki` path) and a superseded watcher self-terminates, so after startup-restore it observes the active project's `.tiki`.

---

## [v0.7.0] — 2026-05-21

Wave 2 of the status-desync epic (#218). v0.6.7 fixed where release issues *landed*; v0.7.0 attacks the master cause — ~4 surfaces deriving status independently from ~5 sources — with a single source of truth plus a GitHub freshness mechanism. Full per-issue summary: [`.tiki/releases/v0.7.0-changelog.md`](.tiki/releases/v0.7.0-changelog.md).

### Added
- **Single source of truth — `deriveDisplayStatus()` selector** (#222). One pure selector implements the canonical first-match precedence table from #218 (`{ column, label, pipelineState, badge, anomaly? }`); the Kanban board, detail GitHub badge, and pipeline timeline all consume it, so they agree by construction. GitHub/Tiki disagreement is surfaced as an explicit anomaly. A fresh-ref guard test protects the #210/#212 crash class.
- **GitHub freshness — re-sync on window focus** (#221). Re-syncs issues/PRs/releases on window focus / tab visibility (default on), with an opt-in periodic poll (off by default, 60s floor, rate-limit-gated via #110). Settings in the GitHub section.

### Fixed
- **Frozen display across surfaces** (#220). Detail panel re-fetches the selected issue on state change (no reselection needed); the Rust watcher switched to trailing-edge debounce so the final write of a burst is always emitted; stale `work.phase` "1/N" is cleared on completion in both `state.mjs` and the Rust IPC (parity-tested).

---

## [v0.6.7] — 2026-05-21

Single-issue patch — fixes a release-pipeline data-loss bug (Wave 1 / MVP of epic #218). Full per-issue summary: [`.tiki/releases/v0.6.7-changelog.md`](.tiki/releases/v0.6.7-changelog.md).

### Fixed
- **Release-shipped issues now reach the Kanban Completed column** (#219). `/tiki:release` children were removed from `activeWork` but never added to `history.recentIssues`; the Completed column read only `recentIssues`, so release issues vanished from the board. The column now unions `recentIssues` + `recentReleases[].issues` (deduped) and the cross-column exclusion set is uncapped — retroactively surfacing past releases (incl. v0.6.6's #214/#215/#216) with no `state.json` migration. `release.md` teardown now appends per-child issue history (coverage-test guarded); `state.mjs append-history` is idempotent.

---

## [v0.6.6] — 2026-05-21

First feature release surfaced from the 2026-05-20 codebase deep-dive — three additions that activate dormant data-model capacity and stand up the long-specified extensibility layer. Full per-issue summary: [`.tiki/releases/v0.6.6-changelog.md`](.tiki/releases/v0.6.6-changelog.md).

### Added
- **Live planning checklist** (#216). PLAN's success criteria become a live checklist: EXECUTE marks each criterion verified once **all** of its covering phases (per `coverageMatrix`) complete, and the detail panel renders a ticking ☑/☐ list with `N/M` progress for both in-flight and completed issues. Activates the dormant `SuccessCriterion.verified`/`verifiedAt` fields — no schema change.
- **`config.json` schema, validation, and in-app editor** (#214). A canonical JSON schema (`additionalProperties:false`) for `.tiki/config.json`, a validator that flags misspelled keys as warnings instead of silently defaulting, atomic `read_tiki_config`/`save_tiki_config` Tauri commands, and a Settings → Workflow editor with inline validation (E33).
- **Lifecycle hooks** (#215). The long-specified `.tiki/hooks/` system, implemented as a real `run-hook.mjs` runner invoked from EXECUTE and SHIP. Six hook points with documented `TIKI_*` env vars; `.ps1`/`.sh` support; `pre-*` hooks block on failure, `post-*` warn. Sample registry ships disabled. See [`docs/HOOKS.md`](docs/HOOKS.md).

### Internal
- `@tiki/shared` +21 tests, desktop +25 vitest / +6 Rust, framework `node:test` 10 → 21. Test totals at ship: shared 86, desktop 144, framework 21, Rust 34. `pnpm build` + `cargo clippy --deny warnings` clean.

---

## [v0.6.0] — 2026-05-14

"UX polish" — the first backlog-driven release since v0.5.0, breaking the v0.5.4–v0.5.7 single-issue reactive-bugfix streak. Five enhancements from `docs/ENHANCEMENT-IDEAS.md` (E2, E3, E10, E11, E14) scoped and shipped together. Full per-issue summary: [`.tiki/releases/v0.6.0-changelog.md`](.tiki/releases/v0.6.0-changelog.md).

### Added
- **Regex toggle in terminal search** (#173). A `.*` toggle beside the `Aa` case toggle, forwarding `regex` to `@xterm/addon-search`; uncompilable patterns are caught with an "Invalid regex" indicator (E2).
- **Runtime terminal font-size** (#174). `Ctrl+=` / `Ctrl++` / `Ctrl+-` / `Ctrl+0` resize the live terminal and reflow the grid; `Ctrl+Shift+-` still reaches readline undo (E3).
- **Jump-to-terminal from the detail panel** (#175). Issue-scoped commands record their terminal; the issue detail panel offers a "Jump to terminal" button that switches view, tab, and focus. Hidden when no live association exists (E10).
- **Illustrated detail-panel empty state** (#176). The bare "Select an issue" fallback becomes a GET → SHIP pipeline diagram plus a `Ctrl+K` hint (E11).
- **Recovery dialog parse-failure line** (#177). A structured "line N, column M" callout in the error summary; backup previews are line-numbered with the offending row highlighted and scrolled into view (E14).

### Internal
- New unit tests (`TerminalSearch.test.ts`, `terminalStore.test.ts`, `parseJsonErrorLocation` cases) — desktop vitest suite grew from 76 to 89 cases.

---

## [v0.5.7] — 2026-05-14

Single-issue follow-up to v0.5.6 restoring terminal copy/paste, non-functional since the v0.5.3 terminal-polish bundle. Full per-issue summary: [`.tiki/releases/v0.5.7-changelog.md`](.tiki/releases/v0.5.7-changelog.md).

### Fixed
- **Ctrl+V paste and Ctrl+C copy restored in the terminal** (#171). #155 deleted the custom paste handler, betting xterm.js's native `paste`-event listener would own paste — but it doesn't fire reliably in the Tauri WebView2, so paste was dead in v0.5.6 with no fallback. Restores an explicit `Ctrl+V`/`Ctrl+Shift+V` handler (reads the clipboard, calls `xterm.paste()` — bracketed-paste preserved). Adds `Ctrl+C` with the Windows Terminal / VS Code convention: copy on selection, SIGINT otherwise (plain `Ctrl+C` previously always sent SIGINT). A capture-phase `paste` suppressor on the parent container structurally prevents the #155 double-paste regression. No new dependencies.

### Known limitations
- The `tauri-plugin-clipboard-manager` robustness upgrade was deferred — it needs an elevated `pnpm install` (the #161 reparse-point blocker). This release uses the no-dependency `navigator.clipboard` path, smoke-tested before tagging.

---

## [v0.5.6] — 2026-05-14

Single-issue follow-up to v0.5.5 fixing the clickable-URL regression introduced by the xterm namespace migration. Full per-issue summary: [`.tiki/releases/v0.5.6-changelog.md`](.tiki/releases/v0.5.6-changelog.md).

### Fixed
- **Clickable URLs in terminal restored** (#169). Adds `allowProposedApi: true` to the `XTerm` constructor. `@xterm/addon-web-links@0.12.0` relies on an API that 5.4+ gates behind this flag — without it, `loadAddon` succeeded silently but URL click handlers were never attached. Confirms v0.5.5's "no behavior change" claim was incorrect.

### Known limitations
- Ctrl+V and Ctrl+Shift+C clipboard shortcuts remain unverified. Status (regression vs pre-existing) is still pending an A/B test against v0.5.4. Intentionally not changed in v0.5.6 to avoid re-introducing the #155 double-paste regression.

---

## [v0.5.5] — 2026-05-13

Single-issue release carrying the xterm namespace migration deferred from v0.5.4. Full per-issue summary: [`.tiki/releases/v0.5.5-changelog.md`](.tiki/releases/v0.5.5-changelog.md).

### Changed
- **xterm.js package namespace**: `xterm@5.3.0` → `@xterm/xterm@5.5.0` (#161). 5.3.0 was the last release on the unscoped name. No behavior change; addons were already on the scoped namespace, so TS jump-to-definition now lands on the right surface.

### Known issues
- Terminal clickable URLs and Ctrl+V/Ctrl+C clipboard shortcuts observed not working during v0.5.5 smoke test (#169). Investigation pending — may be pre-existing or a regression from the namespace swap; A/B against v0.5.4 will isolate.

---

## [v0.5.4] — 2026-05-13

Five-issue follow-up to v0.5.3's paste fix. Most were originally queued for v0.5.3 but split out after build verification was blocked locally. Full per-issue summaries: [`.tiki/releases/v0.5.4-changelog.md`](.tiki/releases/v0.5.4-changelog.md).

### Added
- **Clear Scrollback** terminal tab context-menu entry + **Ctrl+Shift+K** shortcut (#158). Fulfills ENHANCEMENT-IDEAS E1.
- **Resume Conversation banner** for terminals that previously ran `claude` (#159). Auto-types `claude --continue` on click. Optional 5-second auto-resume via new **Auto-resume Claude conversations** setting. Privacy: only commands matching `^claude` are persisted.

### Fixed
- **Ctrl+W and Ctrl+T no longer eat shell keys** (#156). Ctrl+W is now gated by an `.xterm`-focus check; Ctrl+T is unbound (readline's `transpose-chars` reaches the shell). **Ctrl+Shift+T** opens new tabs.
- **PTY UTF-8 carryover + 10ms IPC coalescing** (#157). Multi-byte sequences across 4KB read boundaries no longer become U+FFFD; PowerShell tab-completion no longer floods the renderer. Supersedes ENHANCEMENT-IDEAS E4.

### Docs
- **Settings explainer**: Ctrl+Z in the terminal is SIGTSTP, not undo (#160).

### Deferred
- `@xterm/xterm` package migration (#161) moved to v0.5.5 — the package.json swap requires a `pnpm-lock.yaml` regeneration that can't be done locally right now (Windows Defender blocks pnpm install workspace junctions on this machine).

---

## [v0.5.0] — 2026-05-12

### Added
- **`state.mjs get <work-id> [--field <path>]`** — bash-friendly read path; dot-path field extraction; scalars print raw, objects as JSON (E27).
- **`state.mjs remove <work-id>`** — atomic removal of an `activeWork` entry. Closes the standalone-ship direct-JSON exception (E25).
- **`state.mjs append-history <issue|release>`** — typed appender for `history.recentIssues` / `history.recentReleases`; shapes match `state.schema.json` (E26).
- **`state.mjs --dry-run`** — preview a `transition` / `remove` / `append-history` without writing; illegal transitions still exit 1 (E28).
- **AUDIT-time algorithmic checks** — `audit.md` enforces bidirectional `successCriteria` ↔ `coverageMatrix` matching and runs Kahn's algorithm on phase dependencies to catch cycles at plan-time (E31, E32).
- **Three-way transition-table parity test** at `packages/shared/src/__tests__/transitions-parity.test.ts` — parses both mirrors (`state.mjs` LEGAL, `state_transition.rs` match arms) and asserts pair-for-pair equality with the canonical `VALID_TRANSITIONS`. Replaces the "must be kept in sync" comments with mechanical enforcement (E44).

### Changed
- **`scripts/version-bump.mjs`** now also bumps root `package.json` (was stuck at `0.1.0`) (E45).
- **`ship.md` and `release.md`** state-management sections rewritten to call the new shim subcommands instead of describing direct JSON writes.
- **`package.json` root `test:ts`** now runs `packages/shared` tests in addition to `apps/desktop` (the existing `transitions.test.ts` was silently unrun in CI before this).
- **`.github/workflows/pr.yml`** adds a `Vitest (packages/shared)` step so shared-package tests run on every PR.

---

## [v0.4.2] — 2026-05-12

### Added
- **Semantic `WorkStatus` color tokens** in `index.css` for both dark and light themes (E49).
- **Pulse animation on the currently-executing phase segment** anchored to `--status-executing` (E50).
- **Selected-card elevation** — accent ring + soft drop-shadow on selected `IssueCard` / `KanbanCard` (E53).
- **Accent ring on card hover** — `WorkProgressCard.clickable` and `IssueCard` get a 1px accent box-shadow on hover (E54).
- **Pulse on busy terminal-tab `StatusDot`** when `status === 'busy'` (E56).

### Accessibility
- **Respect `prefers-reduced-motion`** — global CSS rule + `<MotionConfig reducedMotion="user">` wrapper so every framer-motion consumer honors the OS preference (E52).

---

## [v0.4.1] — 2026-05-12

### Added
- **CHANGELOG.md** at repo root (E40).
- **Click an Active Work card** in the sidebar to open it in the detail panel (E5).
- **Failed-aware kanban columns** — column headers visually highlight when any contained card has `failed` status (E9).
- **Command palette inherits selected-issue context** — `tiki:get`, `tiki:execute`, `tiki:ship`, `tiki:yolo` offer contextual `Run on #N (current issue)` variants when an issue is selected (E13).
- Enhancement backlog `docs/ENHANCEMENT-IDEAS.md` (48 items, IDs E1–E48).

### Changed
- **CLAUDE.md** documents the `packages/framework/scripts/state.mjs` shim (the bash-callable mirror of the Rust `state_transition` IPC), and warns about the Windows pnpm reparse-point env trap (E37).
- **`release.yml`** generates a real release body from `.tiki/releases/v*-changelog.md` instead of the static "See the assets below…" stub (E41).

### Fixed
- **`fs_utils::atomic_write`** now `fsync`s the tmp file before rename — closes a power-loss durability window for `state.json` (E18).

---

## [v0.4.0] — 2026-05-11

### Added
- Canonical `WorkStatus` transition table in `@tiki/shared` with `canTransition` / `assertTransition` helpers (#103).
- Terminal search overlay (Ctrl+F) via `@xterm/addon-search`, scoped per terminal leaf (#87).
- vitest infrastructure for `@tiki/shared` (47 test cases for the transition table).

### Changed
- Rust `is_legal_transition` and JS shim `LEGAL` constant now mirror the canonical `@tiki/shared` table.
- `review.md` (both copies) routes the `pending → reviewing` transition through the validated shim — last known direct-JSON enforcement gap closed.

### Removed
- `failed → shipping` removed from the legal transition table (the issue body's explicit bad example).

### Note
- Issue #114 (project templates for `.tiki/` initialization) was originally scoped to v0.4.0 but deferred after a local Windows env issue blocked verification mid-session.

---

## [v0.3.0] — 2026-05-11

### Added
- Typed Rust `state_transition` IPC (apps/desktop/src-tauri/src/state_transition.rs) (#144).
- bash-callable `state.mjs` CLI shim mirroring the Rust transition contract (#144).
- vitest + Rust integration tests with fixtures (#145).
- `.github/workflows/pr.yml` CI gate on PRs to main (#145).
- StateRecoveryDialog with one-click backup restore on unparseable `state.json` (#146).
- `.broken.json` safety snapshots that persist across retention pruning (#146).
- New IPC commands: `state_transition`, `restore_backup_safe`, `read_backup_content`, `write_fresh_state`.

### Changed
- Framework command prose contracts shrunk by ~60%: state mutations now call the shim instead of inlining JSON shapes.

---

## [v0.2.19] — 2026-05-09

### Fixed
- Archived/shipped releases display inconsistently in sidebar and detail (#143).

---

## [v0.2.18] — 2026-05-09

### Added
- In-app framework update — detect outdated `.claude/commands/tiki/` and reinstall with one click (#141).

### Changed
- Default panel sizes adjusted to 15/65/20 (sidebar/main/detail) (#139).

### Fixed
- In-app update install path: dialog plugin capability permission was missing (#140).
- Shipped releases still appearing in sidebar (#142).

---

## [v0.2.17] — 2026-05-09

### Added
- Parallel phase execution (#99).
- Automated test framework integration (#100).
- Auto-healing for failed phases (#101).
- `tiki:research` command and `.tiki/research/` knowledge-capture convention (#102).

---

## Earlier releases

For v0.2.16 and earlier, see the per-release files under `.tiki/releases/archive/` and the [GitHub Releases page](https://github.com/Eric-Ness/Tiki-V2/releases).
