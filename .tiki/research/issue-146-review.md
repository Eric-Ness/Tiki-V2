---
topic: corruption-recovery-flow
tags: [issue-146, recovery, state, ux]
issues: [146]
created: 2026-05-11
---

# Issue #146 — Corruption Recovery UX Review

## Problem statement (verbatim from issue)

When `.tiki/state.json` is corrupt/unparseable the desktop app dumps the raw
Rust error string in the sidebar (`apps/desktop/src/App.tsx:215` —
`setError(String(e))`). The Rust primitives to recover already exist in
`fs_utils.rs` but aren't wired into UX.

## Current state of the codebase

### Rust side (`apps/desktop/src-tauri/src/fs_utils.rs`)

- `read_json_resilient` — already retries 3x with 25ms backoff. Returns
  `Ok(None)` for missing file, `Err(string)` for terminal parse/IO failures.
- `backup_state(tiki_path)` — copies current `state.json` to
  `backups/state.{ts}.json` where `{ts}` is `%Y-%m-%dT%H-%M-%S` UTC. Enforces
  retention (default 10).
- `list_backup_files(tiki_path) -> Vec<BackupInfo>` — newest first.
  `BackupInfo` has `filename`, `timestamp`, `size_bytes`.
- `restore_from_backup(tiki_path, backup_filename)` — calls `backup_state`
  for safety, validates JSON, atomic_writes. **BUT** the safety backup only
  fires successfully if the current `state.json` already exists AND is
  copy-able. There's no special "broken.json" naming, so SC6 needs a new
  helper.

### Commands exposed (`commands.rs:476-496`)

- `backup_state(tiki_path) -> Result<String, String>`
- `list_backups(tiki_path) -> Result<Vec<BackupInfo>, String>`
- `restore_backup(backup_filename, tiki_path) -> Result<(), String>`

### Frontend trigger point (`App.tsx:194-245`)

`loadState()` catches `get_state` errors via `setError(String(e))` and the
sidebar renders `{error && <div className="error">{error}</div>}` at line 372.
The dialog must fire from this catch-block, but ONLY for terminal parse
errors — not for "no .tiki directory" (which today is the `currentState ===
null` path, not the error path, so this is naturally separated).

### Distinguishing error types

`read_json_resilient` returns `Ok(None)` if path doesn't exist — that flows
through `get_state` as `Ok(null)` and never throws. Parse errors after 3
retries become `Err("parse error (attempt 3): ...")`. So the error string is
already reliably parse-related. We can detect by substring `"parse error"`,
but a more robust approach is to have the frontend treat ANY `get_state` Err
as recoverable since the missing-dir path doesn't reach the catch.

## Success criteria mapping

- **SC1**: `StateRecoveryDialog` under `apps/desktop/src/components/recovery/`,
  renders when `get_state` returns Err.
- **SC2**: Lists backups via `list_backups`, newest-first, with timestamps,
  sizes, age.
- **SC3**: Restore calls `restore_backup`, re-invokes `get_state`, dismisses
  on success. Stays open with new error on failure.
- **SC4**: "Edit Manually" opens system editor — need `tauri-plugin-shell`.
- **SC5**: "Start Fresh" requires typing `reset` confirmation.
- **SC6**: Pre-flight: every restore creates a `.broken.json` safety copy
  first. NEW Rust helper required: `restore_with_broken_backup` that names
  the safety copy `state.{ts}.broken.json` when source was unparseable.
- **SC7**: Rust unit test verifying restore (a) succeeds, (b) leaves a
  `.broken.json` safety copy when source unparseable, (c) atomic write.

## Implementation strategy

### Phase 1 — Rust safety-backup helper + unit test (SC6, SC7)

Add `restore_from_backup_with_broken_copy(tiki_path, backup_filename)` in
`fs_utils.rs` that:
1. Reads current `state.json` if it exists.
2. Tries to parse it. If parse fails OR a `mark_broken: bool` arg is true,
   copies current state to `backups/state.{ts}.broken.json` (separately
   named from the auto-retention pool so it's not pruned).
3. Calls existing `restore_from_backup` for the actual restore.

Expose new Tauri command `restore_backup_safe(backup_filename, tiki_path)`.

Unit tests:
- Restore succeeds when both files parseable.
- Restore leaves `.broken.json` when current state is unparseable.
- Atomic write — verify intermediate `.tmp` is gone after success.

### Phase 2 — Frontend pure recovery-flow helper + vitest tests

Extract pure logic into `apps/desktop/src/components/recovery/recoveryFlow.ts`:
- `parseBackupTimestamp(timestamp: string): Date | null`
- `formatRelativeAge(date: Date, now: Date): string` — "3 hours ago"
- `formatBytes(bytes: number): string` — "1.2 KB"
- `validateBackupContent(json: string): { ok: boolean; error?: string }` —
  parse + minimal shape check (object with `schemaVersion` and `activeWork`).

Vitest tests in `apps/desktop/src/components/recovery/__tests__/`.

### Phase 3 — StateRecoveryDialog component + CSS (SC1, SC2, SC3, SC5)

`StateRecoveryDialog.tsx`:
- Props: `error: string`, `tikiPath: string`, `onRecovered: () => void`,
  `onDismiss: () => void`.
- On mount: invoke `list_backups`, for each backup invoke
  `read_backup_content` (new IPC) to validate parseable, sort newest-first.
- Render: backup list with Preview/Restore buttons per row (Restore disabled
  if `!validateBackupContent`); below the list, an "Other actions" section
  with "Edit Manually" and "Start Fresh".
- Restore handler: invoke `restore_backup_safe`, then re-invoke `get_state`;
  on success call `onRecovered()`, on failure show inline error.
- Preview modal: shows backup JSON content with syntax-highlight-ish styling.
- Start Fresh: input box requires literal `reset`, then invokes
  `write_fresh_state` (new IPC) that atomic-writes `{schemaVersion: 1,
  activeWork: {}}`.

Need new IPC commands:
- `read_backup_content(backup_filename, tiki_path) -> String` — for preview
  and validation.
- `restore_backup_safe(backup_filename, tiki_path)` — wraps the new helper.
- `write_fresh_state(tiki_path)` — for Start Fresh.

### Phase 4 — tauri-plugin-shell integration (SC4)

- `Cargo.toml`: `tauri-plugin-shell = "2"`
- `lib.rs`: `app.handle().plugin(tauri_plugin_shell::init())?;`
- `capabilities/default.json`: add `"shell:allow-open"` and a scope for the
  state.json path. Easier: use the `open` API with a URL/path argument.
- `package.json`: `@tauri-apps/plugin-shell: ^2`
- In dialog: `import { open } from '@tauri-apps/plugin-shell'` and call
  `await open(tikiPath + '/state.json')`.

### Phase 5 — Wire into App.tsx

Add `const [recoveryError, setRecoveryError] = useState<string | null>(null)`.
In the `loadState` catch block: `setRecoveryError(String(e))`. Render the
dialog conditionally above the main layout. On `onRecovered`, call
`loadState()` again.

## Risks identified in issue

- All 10 backups could be corrupt → validate via `read_backup_content` +
  parse check, gray out unparseable ones.
- `restore_from_backup` already validates JSON before overwrite — preserve
  that behavior, don't bypass.
- Only fire on terminal failures, not transient — `read_json_resilient`
  already absorbs the transient retries, so by the time we see an Err it's
  terminal.

## Files to touch

### New
- `apps/desktop/src-tauri/src/fs_utils.rs` — add helper (existing file extension)
- `apps/desktop/src/components/recovery/StateRecoveryDialog.tsx`
- `apps/desktop/src/components/recovery/StateRecoveryDialog.css`
- `apps/desktop/src/components/recovery/recoveryFlow.ts`
- `apps/desktop/src/components/recovery/__tests__/recoveryFlow.test.ts`
- `apps/desktop/src/components/recovery/index.ts`

### Modified
- `apps/desktop/src-tauri/Cargo.toml` — add `tauri-plugin-shell`
- `apps/desktop/src-tauri/src/lib.rs` — register plugin + new commands
- `apps/desktop/src-tauri/src/commands.rs` — new IPC commands
- `apps/desktop/src-tauri/capabilities/default.json` — add shell perms
- `apps/desktop/package.json` — `@tauri-apps/plugin-shell`
- `apps/desktop/src/App.tsx` — wire dialog into error path

## Note: pre-existing dirty tree

Do NOT touch `.tiki/.framework-version`, `.claude/commands/tiki/release.md`,
`.claude/commands/tiki/yolo.md`, `.claude/settings.local.json`,
`Cargo.lock` (pre-existing 0.2.18→0.2.19 bump), and don't `git add -A`. Stage
only files we created/modified for #146.
