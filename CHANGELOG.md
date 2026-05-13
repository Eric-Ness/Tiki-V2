# Changelog

All notable changes to Tiki are recorded here. Per-release detail (with per-issue summaries) lives in `.tiki/releases/v*-changelog.md` and at <https://github.com/Eric-Ness/Tiki-V2/releases>.

This project loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
