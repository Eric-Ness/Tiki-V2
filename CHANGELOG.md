# Changelog

All notable changes to Tiki are recorded here. Per-release detail (with per-issue summaries) lives in `.tiki/releases/v*-changelog.md` and at <https://github.com/Eric-Ness/Tiki-V2/releases>.

This project loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Enhancement backlog `docs/ENHANCEMENT-IDEAS.md` (48 items, IDs E1–E48).

---

## [v0.4.1] — 2026-05-12 — _in flight_

### Added
- **CHANGELOG.md** at repo root (E40).
- **Click an Active Work card** in the sidebar to open it in the detail panel (E5).
- **Failed-aware kanban columns** — column headers visually highlight when any contained card has `failed` status (E9).
- **Command palette inherits selected-issue context** — `tiki:get`, `tiki:execute`, `tiki:ship`, `tiki:yolo` offer contextual `Run on #N (current issue)` variants when an issue is selected (E13).

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
