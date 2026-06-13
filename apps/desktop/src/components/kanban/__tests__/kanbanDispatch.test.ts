import { describe, expect, it, vi } from 'vitest';
import { dispatchKanbanMove, type KanbanMoveDispatchers } from '../KanbanBoard';

/**
 * Pins the cross-column drag WIRING (#280 phase 2): which side effect runs for
 * which classified move. classifyKanbanMove's exhaustive classification is
 * already covered by kanbanMoves.test.ts; here we assert dispatchKanbanMove
 * routes each move to the right injected handler — and, crucially, that an
 * undispatchable (backward/lateral/invalid) drag toasts instead of silently
 * doing nothing (the #267 silent snap-back).
 */
describe('dispatchKanbanMove', () => {
  function makeDispatchers(): {
    d: KanbanMoveDispatchers;
    triggerExecution: ReturnType<typeof vi.fn>;
    requestShip: ReturnType<typeof vi.fn>;
    toast: ReturnType<typeof vi.fn>;
  } {
    const triggerExecution = vi.fn();
    const requestShip = vi.fn();
    const toast = vi.fn();
    return { d: { triggerExecution, requestShip, toast }, triggerExecution, requestShip, toast };
  }

  it('dispatches execution (not a toast) for a forward move into execute', () => {
    const { d, triggerExecution, requestShip, toast } = makeDispatchers();
    dispatchKanbanMove('review', 'execute', 42, d);
    expect(triggerExecution).toHaveBeenCalledWith(42, 'review');
    expect(requestShip).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('dispatches execution from the open column (start-work affordance)', () => {
    const { d, triggerExecution, toast } = makeDispatchers();
    dispatchKanbanMove('open', 'execute', 7, d);
    expect(triggerExecution).toHaveBeenCalledWith(7, 'open');
    expect(toast).not.toHaveBeenCalled();
  });

  it('requests ship (not a toast) for execute -> shipping', () => {
    const { d, requestShip, triggerExecution, toast } = makeDispatchers();
    dispatchKanbanMove('execute', 'shipping', 99, d);
    expect(requestShip).toHaveBeenCalledWith(99);
    expect(triggerExecution).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('toasts (and does NOT dispatch) for a backward move execute -> review', () => {
    const { d, triggerExecution, requestShip, toast } = makeDispatchers();
    dispatchKanbanMove('execute', 'review', 42, d);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(triggerExecution).not.toHaveBeenCalled();
    expect(requestShip).not.toHaveBeenCalled();
    // Message points the user at the terminal command for the dragged issue.
    expect(toast.mock.calls[0][0]).toContain('/tiki:execute 42');
  });

  it('toasts for a lateral / unsupported move (plan -> shipping)', () => {
    const { d, toast, triggerExecution, requestShip } = makeDispatchers();
    dispatchKanbanMove('plan', 'shipping', 1, d);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(triggerExecution).not.toHaveBeenCalled();
    expect(requestShip).not.toHaveBeenCalled();
  });

  it('toasts a generic message for a terminal-state source (completed -> review)', () => {
    const { d, toast } = makeDispatchers();
    dispatchKanbanMove('completed', 'review', 5, d);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe("This move isn't available from the board.");
  });

  it('is a no-op for a same-column reorder (handled earlier in handleDragEnd)', () => {
    const { d, triggerExecution, requestShip, toast } = makeDispatchers();
    dispatchKanbanMove('execute', 'execute', 42, d);
    expect(triggerExecution).not.toHaveBeenCalled();
    expect(requestShip).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('never leaves a cross-column drag without feedback (no silent snap-back)', () => {
    const columns = ['open', 'review', 'plan', 'execute', 'shipping', 'completed'] as const;
    for (const source of columns) {
      for (const target of columns) {
        if (source === target) continue;
        const { d, triggerExecution, requestShip, toast } = makeDispatchers();
        dispatchKanbanMove(source, target, 1, d);
        const calls =
          triggerExecution.mock.calls.length +
          requestShip.mock.calls.length +
          toast.mock.calls.length;
        expect(calls, `${source} -> ${target} produced no action`).toBe(1);
      }
    }
  });
});
