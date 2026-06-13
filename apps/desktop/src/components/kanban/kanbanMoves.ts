/**
 * Pure decision logic for kanban drag-and-drop moves (issue #280).
 *
 * The Kanban board offers exactly TWO command-backed dispatches:
 *   - dropping a card into the Execute column starts execution (/tiki:yolo or
 *     /tiki:execute), and
 *   - dropping an Execute card into Shipping requests a ship confirmation.
 *
 * Every other cross-column drag (backward / lateral / unsupported) is NOT
 * actionable from the board and today silently snaps back. This module makes
 * that decision pure and testable so phase 2 can replace the inline logic in
 * KanbanBoard.tsx and surface a toast instead of a silent no-op (#267).
 *
 * COLUMN_STATUSES is the single source for the column<->WorkStatus map. It is
 * pinned against the canonical VALID_TRANSITIONS table in kanbanMoves.test.ts:
 * the board must never dispatch a move that the canonical state machine forbids.
 */

import type { WorkStatus } from '@tiki/shared';

export type ColumnId = 'open' | 'review' | 'plan' | 'execute' | 'shipping' | 'completed';

/**
 * Maps each kanban column to the WorkStatus values that display in it.
 *
 * Mirrors KanbanBoard's COLUMN_CONFIG and `deriveDisplayStatus`'s
 * STATUS_TO_COLUMN. Note the `execute` column also hosts `failed` and `paused`
 * work (deriveDisplayStatus routes both to the 'execute' column), so they are
 * included here for completeness — the column<->status map must reflect what is
 * actually shown, otherwise the canonical parity check would under-report which
 * transitions a drag could legally trigger.
 *
 * `open` is a UI-only "untracked" column with no work status (an issue with no
 * activeWork entry); dragging out of it is the start-work affordance, not a
 * canonical status transition.
 */
export const COLUMN_STATUSES: Record<ColumnId, WorkStatus[]> = {
  open: [],
  review: ['pending', 'reviewing'],
  plan: ['planning'],
  execute: ['executing', 'failed', 'paused'],
  shipping: ['shipping'],
  completed: ['completed'],
};

export type KanbanMove = 'reorder' | 'dispatch-execute' | 'dispatch-ship' | 'toast';

/**
 * Source columns from which dropping into Execute is a supported dispatch.
 *
 * These are the upstream-of-execute columns: `open` (start-work affordance —
 * creates the activeWork entry via /tiki:yolo), and `review`/`plan` (canonically
 * legal: pending/reviewing/planning all transition to executing). `shipping` and
 * `completed` are deliberately excluded — `completed` is terminal (canonically
 * illegal -> execute) and `shipping -> execute` is not a board-supported action;
 * both fall through to 'toast'. This keeps the classifier in lockstep with the
 * canonical parity check (kanbanMoves.test.ts), which forbids dispatching any
 * canonically-illegal status transition.
 */
const EXECUTE_DISPATCH_SOURCES: ReadonlySet<ColumnId> = new Set<ColumnId>([
  'open',
  'review',
  'plan',
]);

/**
 * Classify a kanban drag from `source` column to `target` column.
 *
 *   - same column                       -> 'reorder' (within-column ordering)
 *   - target === 'execute' from open/review/plan -> 'dispatch-execute'
 *   - source === 'execute' && target === 'shipping' -> 'dispatch-ship'
 *   - any other cross-column            -> 'toast'   (unsupported; user feedback)
 *
 * Pure: no imports beyond the ColumnId type, no side effects. Total over all
 * 6x6 ordered column pairs (no undefined / silent fall-through).
 */
export function classifyKanbanMove(source: ColumnId, target: ColumnId): KanbanMove {
  if (source === target) return 'reorder';
  if (target === 'execute' && EXECUTE_DISPATCH_SOURCES.has(source)) return 'dispatch-execute';
  if (source === 'execute' && target === 'shipping') return 'dispatch-ship';
  return 'toast';
}
