import { invoke } from '@tauri-apps/api/core';
import { useBulkYoloStore } from '../stores/bulkYoloStore';

/**
 * Dispatch the bulk YOLO's next queued issue to its associated terminal.
 * Called after `advance()` or after `startRun + initial dispatch`. No-op if
 * the queue is exhausted, the run isn't in 'running' state, or no terminal
 * is associated. On invoke failure (e.g. terminal closed) records a failure
 * rather than throwing.
 *
 * Caller passes `projectId` explicitly so this helper has no implicit
 * dependency on `useProjectsStore` (avoids a circular-import minefield in
 * tests and keeps the function pure-ish at the boundary).
 */
export async function dispatchNextBulkYolo(projectId: string): Promise<void> {
  const store = useBulkYoloStore.getState();
  const run = store.runByProject[projectId];
  if (!run || run.status !== 'running') return;
  const next = run.queue[run.currentIndex];
  if (next === undefined || !run.terminalId) return;

  try {
    await invoke('write_terminal', {
      id: run.terminalId,
      data: `/tiki:yolo ${next}\r`,
    });
  } catch (err) {
    // Terminal may have been closed by the user. Pause and surface.
    store.recordFailure(
      `Failed to write to terminal ${run.terminalId}: ${String(err)}`,
    );
  }
}
