# REVIEW — Issue #116: Inline Plan Editor

## Success Criteria

1. **SC1** — "Edit Plan" button appears in `IssueDetail.tsx` when `plan !== null` and work status is NOT `executing` (avoid corrupting live runs).
2. **SC2** — Editor lets the user edit phase title, content (markdown), verification items (string array), files list, and `addressesCriteria` list.
3. **SC3** — Phases are reorderable via `@dnd-kit/sortable` (already installed). No new dependencies.
4. **SC4** — Phases can be added (empty template) and removed (with inline confirmation).
5. **SC5** — Success criteria can be edited: add/remove/modify `id`/`category`/`description`.
6. **SC6** — `coverageMatrix` is recomputed automatically on the frontend whenever phases or criteria change.
7. **SC7** — A diff summary (before/after JSON in collapsible `<pre>` blocks) is shown before save.
8. **SC8** — Save calls a new `save_plan` Tauri IPC that writes via `atomic_write`. The detail panel reloads automatically via the file watcher.
9. **SC9** — Lightweight client-side validation: no duplicate phase numbers, dependencies reference existing phases, no empty titles, all `addressesCriteria` values reference known SC ids. Invalid plans block save with inline errors.

## Existing Code Touchpoints

- **Plan IPC read**: `apps/desktop/src-tauri/src/commands.rs:120` — `get_plan`. No `save_plan` exists.
- **Plan types (Rust)**: `apps/desktop/src-tauri/src/state.rs:477` — `TikiPlan`. Line 520 — `Phase`. Line 511 — `SuccessCriterion`.
- **Detail panel**: `apps/desktop/src/components/detail/IssueDetail.tsx` — local `TikiPlan` interface (line ~34-36), plan load (line 127), phase rendering insertion point (lines 330-337). The local type only has `phases` — needs to be expanded to include `successCriteria` and `coverageMatrix` for the editor.
- **Atomic write**: `apps/desktop/src-tauri/src/fs_utils.rs:68` — `atomic_write`. Used by `save_tiki_release` and `update_work_status`.
- **DnD library**: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` already installed (`apps/desktop/package.json` lines 17-19). KanbanBoard already uses `DndContext`.
- **No diff component exists** — render two collapsible `<pre>` blocks side by side with `JSON.stringify(plan, null, 2)`.

## Dependencies and Risks

- **`save_plan` IPC**: ~30 lines of Rust. Accepts `TikiPlan`, serializes via `serde_json::to_string_pretty`, calls `atomic_write`. Low risk.
- **Audit-on-save full parity is too much scope** — implement only structural validation (SC9). Skip file-existence and full coverage parity.
- **Concurrent edits**: last-write-wins via atomic_write. Show `createdAt` in editor header and warn if it changes while editor is open. Mitigation only; not a hard lock.
- **Local `TikiPlan` type in IssueDetail.tsx** must be expanded (or a richer editor-specific type added in the new component file).

## Open Questions / Decisions

- **OQ1 — Editor surface**: inline panel toggled by "Edit Plan" button. Modal would obscure detail context.
- **OQ2 — Button visibility**: hide while `status === "executing"`.
- **OQ3 — Coverage matrix**: compute in frontend before sending; keep `save_plan` as a dumb writer.
- **OQ4 — Diff format**: two collapsible `<pre>` blocks with full JSON. Field-level summary requires diff logic — defer.
- **OQ5 — Phase `status` field**: read-only in editor (badge, not input). Editing it could corrupt active execution.

## Out of Scope

- Full audit parity (file existence, semantic coverage analysis).
- Undo/redo within the editor session.
- Real-time collaborative editing.
- Editing plans for issues not in `activeWork`.
- Editing `createdAt` or `schemaVersion`.
- Any changes to framework commands or `@tiki/shared`.
- Editing release plans.
