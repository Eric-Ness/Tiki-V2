import { describe, it, expect, vi, beforeEach } from 'vitest';
import { advanceBulkYoloOnStateChange } from '../bulkYoloCascade';
import { useBulkYoloStore } from '../../stores/bulkYoloStore';
import { useToastStore } from '../../stores/toastStore';
import { dispatchNextBulkYolo } from '../bulkYoloDispatch';
import type { TikiState } from '../tikiStateSync';
import type { WorkContext } from '../../components/work';

// dispatchNextBulkYolo writes to a terminal / invokes Tauri — mock it so the
// cascade logic can be tested in isolation.
vi.mock('../bulkYoloDispatch', () => ({ dispatchNextBulkYolo: vi.fn() }));
const mockDispatch = vi.mocked(dispatchNextBulkYolo);

const issueCtx = (number: number, status: WorkContext['status']): WorkContext => ({
  type: 'issue',
  issue: { number },
  status,
  createdAt: '2026-01-01T00:00:00Z',
});

const state = (
  activeWork: Record<string, WorkContext>,
  recentIssues: Array<{ number: number; completedAt: string }> = [],
): TikiState => ({
  schemaVersion: 1,
  activeWork,
  history: { recentIssues },
});

describe('advanceBulkYoloOnStateChange (#234)', () => {
  beforeEach(() => {
    useBulkYoloStore.setState({ runByProject: {} });
    mockDispatch.mockClear();
  });

  it('advances the queue and dispatches the next when the current issue ships', () => {
    useBulkYoloStore.getState().startRun([42, 43], 'term-1');
    const prev = state({ 'issue:42': issueCtx(42, 'executing') });
    const next = state({}, [{ number: 42, completedAt: '2026-01-01T01:00:00Z' }]);

    advanceBulkYoloOnStateChange(prev, next);

    const run = useBulkYoloStore.getState().runByProject['default'];
    expect(run?.currentIndex).toBe(1);
    expect(run?.status).toBe('running'); // 43 still queued
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith('default');
  });

  it('records a failure and does NOT dispatch when the current issue fails', () => {
    useBulkYoloStore.getState().startRun([42, 43], 'term-1');
    const addToast = vi.spyOn(useToastStore.getState(), 'addToast');
    const prev = state({ 'issue:42': issueCtx(42, 'executing') });
    const next = state({ 'issue:42': issueCtx(42, 'failed') });

    advanceBulkYoloOnStateChange(prev, next);

    const run = useBulkYoloStore.getState().runByProject['default'];
    expect(run?.status).toBe('failed');
    expect(run?.failures.at(-1)?.issueNumber).toBe(42);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('#42 failed'), 'error');
  });

  it('is a no-op when there is no running cascade', () => {
    const prev = state({ 'issue:42': issueCtx(42, 'executing') });
    const next = state({}, [{ number: 42, completedAt: '2026-01-01T01:00:00Z' }]);

    advanceBulkYoloOnStateChange(prev, next);

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(useBulkYoloStore.getState().runByProject['default']).toBeUndefined();
  });

  it('does not advance when a different (non-current) issue moves to history', () => {
    useBulkYoloStore.getState().startRun([42, 43], 'term-1'); // current = 42
    const prev = state({ 'issue:42': issueCtx(42, 'executing') });
    // Issue 99 (not in the queue) shipped — current issue 42 is untouched.
    const next = state(
      { 'issue:42': issueCtx(42, 'executing') },
      [{ number: 99, completedAt: '2026-01-01T01:00:00Z' }],
    );

    advanceBulkYoloOnStateChange(prev, next);

    expect(useBulkYoloStore.getState().runByProject['default']?.currentIndex).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
