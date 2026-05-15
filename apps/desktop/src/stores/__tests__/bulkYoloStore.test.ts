import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock projects store BEFORE importing bulkYoloStore — bulkYoloStore's
// `getProjectId` resolves via `useProjectsStore.getState().activeProjectId`
// at call time, but mocking ahead of import keeps the test hermetic.
vi.mock('../projectsStore', () => ({
  useProjectsStore: {
    getState: () => ({ activeProjectId: 'p1' }),
  },
}));

import { useBulkYoloStore } from '../bulkYoloStore';

beforeEach(() => {
  useBulkYoloStore.setState({ runByProject: {} });
});

describe('bulkYoloStore', () => {
  it('startRun seeds the queue and sets status running', () => {
    const s = useBulkYoloStore.getState();
    s.startRun([1, 2, 3], 'term-A');
    expect(s.current()).toBe(1);
    expect(s.remaining()).toEqual([1, 2, 3]);
    expect(s.isActive()).toBe(true);
    expect(useBulkYoloStore.getState().runByProject['p1']?.status).toBe('running');
    expect(useBulkYoloStore.getState().runByProject['p1']?.terminalId).toBe('term-A');
  });

  it('advance shifts to next, marks last advance idle when queue exhausted', () => {
    const s = useBulkYoloStore.getState();
    s.startRun([10, 20], 'term-A');
    s.advance();
    expect(s.current()).toBe(20);
    expect(useBulkYoloStore.getState().runByProject['p1']?.completed).toEqual([10]);
    s.advance();
    expect(s.current()).toBe(null);
    expect(useBulkYoloStore.getState().runByProject['p1']?.status).toBe('idle');
    expect(useBulkYoloStore.getState().runByProject['p1']?.completed).toEqual([10, 20]);
  });

  it('recordFailure flips status to failed and appends the failure', () => {
    const s = useBulkYoloStore.getState();
    s.startRun([42], 'term-A');
    s.recordFailure('audit FAIL');
    const run = useBulkYoloStore.getState().runByProject['p1'];
    expect(run?.status).toBe('failed');
    expect(run?.failures).toEqual([
      expect.objectContaining({ issueNumber: 42, reason: 'audit FAIL' }),
    ]);
  });

  it('pause/resume toggle status without losing position', () => {
    const s = useBulkYoloStore.getState();
    s.startRun([1, 2, 3], 'term-A');
    s.advance(); // currentIndex now 1
    s.pause();
    expect(useBulkYoloStore.getState().runByProject['p1']?.status).toBe('paused');
    s.resume();
    expect(useBulkYoloStore.getState().runByProject['p1']?.status).toBe('running');
    expect(s.current()).toBe(2);
  });

  it('abort clears the run for the project', () => {
    const s = useBulkYoloStore.getState();
    s.startRun([1], 'term-A');
    s.abort();
    expect(useBulkYoloStore.getState().runByProject['p1']).toBeNull();
    expect(s.isActive()).toBe(false);
  });
});
