import { describe, expect, it } from 'vitest';
import { VALID_TRANSITIONS } from '@tiki/shared';
import type { WorkStatus } from '@tiki/shared';
import {
  COLUMN_STATUSES,
  classifyKanbanMove,
  type ColumnId,
  type KanbanMove,
} from '../kanbanMoves';

const COLUMNS: ColumnId[] = ['open', 'review', 'plan', 'execute', 'shipping', 'completed'];

/**
 * True iff SOME status in column `a` can canonically transition to SOME status
 * in column `b`, per the canonical VALID_TRANSITIONS table (whose values are
 * ReadonlySet<WorkStatus>). Returns false ("exempt") when either column has no
 * statuses — `open` is a UI-only untracked column with no work status.
 */
function columnMoveIsCanonical(a: ColumnId, b: ColumnId): boolean {
  const fromStatuses = COLUMN_STATUSES[a];
  const toStatuses = COLUMN_STATUSES[b];
  if (fromStatuses.length === 0 || toStatuses.length === 0) return false;
  for (const sA of fromStatuses) {
    const allowed = VALID_TRANSITIONS[sA];
    if (!allowed) continue;
    for (const sB of toStatuses) {
      if (allowed.has(sB)) return true;
    }
  }
  return false;
}

describe('classifyKanbanMove — exhaustive over all column pairs', () => {
  // Expected classification for every ordered (source, target) pair. Same column
  // is 'reorder'; the two command-backed dispatches; everything else cross-column
  // is 'toast'. Written out explicitly so a board that adds/removes a dispatch
  // must update this table — no silent fall-through allowed.
  const expected: Record<ColumnId, Record<ColumnId, KanbanMove>> = {
    open: {
      open: 'reorder',
      review: 'toast',
      plan: 'toast',
      execute: 'dispatch-execute',
      shipping: 'toast',
      completed: 'toast',
    },
    review: {
      open: 'toast',
      review: 'reorder',
      plan: 'toast',
      execute: 'dispatch-execute',
      shipping: 'toast',
      completed: 'toast',
    },
    plan: {
      open: 'toast',
      review: 'toast',
      plan: 'reorder',
      execute: 'dispatch-execute',
      shipping: 'toast',
      completed: 'toast',
    },
    execute: {
      open: 'toast',
      review: 'toast',
      plan: 'toast',
      execute: 'reorder',
      shipping: 'dispatch-ship',
      completed: 'toast',
    },
    shipping: {
      open: 'toast',
      review: 'toast',
      plan: 'toast',
      execute: 'toast',
      shipping: 'reorder',
      completed: 'toast',
    },
    completed: {
      open: 'toast',
      review: 'toast',
      plan: 'toast',
      execute: 'toast',
      shipping: 'toast',
      completed: 'reorder',
    },
  };

  for (const source of COLUMNS) {
    for (const target of COLUMNS) {
      it(`${source} -> ${target} === ${expected[source][target]}`, () => {
        expect(classifyKanbanMove(source, target)).toBe(expected[source][target]);
      });
    }
  }

  it('every cross-column non-dispatch pair is exactly "toast" (no silent fall-through)', () => {
    for (const source of COLUMNS) {
      for (const target of COLUMNS) {
        if (source === target) continue;
        const move = classifyKanbanMove(source, target);
        const isDispatch = move === 'dispatch-execute' || move === 'dispatch-ship';
        if (!isDispatch) {
          expect(move).toBe('toast');
        }
        // Total function: never undefined.
        expect(move).toBeDefined();
      }
    }
  });
});

describe('parity: board dispatches are canonically legal (or the open start-work affordance)', () => {
  it('every dispatch move is canonically legal OR starts from the empty-status open column', () => {
    for (const source of COLUMNS) {
      for (const target of COLUMNS) {
        const move = classifyKanbanMove(source, target);
        if (move !== 'dispatch-execute' && move !== 'dispatch-ship') continue;
        const canonical = columnMoveIsCanonical(source, target);
        const isOpenAffordance = source === 'open';
        expect(
          canonical || isOpenAffordance,
          `${source} -> ${target} is dispatched (${move}) but is neither canonically legal nor an open->* start-work affordance`,
        ).toBe(true);
      }
    }
  });

  it('the two dispatched non-open moves are individually canonical', () => {
    // review/plan/shipping/completed -> execute (executing is a legal target of
    // pending/reviewing/planning/shipping... and paused/failed)
    expect(columnMoveIsCanonical('review', 'execute')).toBe(true);
    expect(columnMoveIsCanonical('plan', 'execute')).toBe(true);
    // execute -> shipping (executing -> shipping is canonical)
    expect(columnMoveIsCanonical('execute', 'shipping')).toBe(true);
  });
});

describe('drift-proof: parity check catches a canonically-forbidden dispatch', () => {
  it('executing cannot canonically go to planning (raw transition table)', () => {
    // `executing`'s legal targets are shipping/paused/failed/completed — never
    // planning. So a board that tried to dispatch an executing->planning status
    // move would be caught at the raw-transition level.
    const executingTargets = VALID_TRANSITIONS['executing' as WorkStatus];
    expect(executingTargets.has('planning')).toBe(false);
  });

  it('shipping -> plan is NOT column-canonical (backward move the parity check rejects)', () => {
    // Proves columnMoveIsCanonical would reject a board that tried to dispatch a
    // backward status move. `shipping`'s only legal targets are completed/failed
    // — never planning — and the shipping column holds only the `shipping`
    // status, so there is no member-status escape hatch.
    expect(columnMoveIsCanonical('shipping', 'plan')).toBe(false);
    expect(columnMoveIsCanonical('shipping', 'review')).toBe(false);
    // Hence classifyKanbanMove must NOT dispatch it — it is a toast.
    expect(classifyKanbanMove('shipping', 'plan')).toBe('toast');
  });

  it('column-level canonicality reflects ALL member statuses (execute holds paused/failed)', () => {
    // NOTE: execute->plan IS column-canonical because the execute column also
    // hosts `paused`/`failed` work (per deriveDisplayStatus), and both
    // paused->planning and failed->planning are legal canonical transitions.
    // This is why the classifier excludes shipping/completed (not plan) as
    // dispatch sources, and why the parity assertion uses the column<->status
    // map rather than the executing status alone.
    expect(columnMoveIsCanonical('execute', 'plan')).toBe(true);
  });

  it('completed -> anything is never canonical (terminal status)', () => {
    for (const target of COLUMNS) {
      if (target === 'completed') continue;
      expect(columnMoveIsCanonical('completed', target)).toBe(false);
    }
  });
});
