import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../stores/projectsStore', () => ({
  useProjectsStore: { getState: () => ({ activeProjectId: 'p1' }) },
}));

import { invoke } from '@tauri-apps/api/core';
import { useBulkYoloStore } from '../../stores/bulkYoloStore';
import { dispatchNextBulkYolo } from '../bulkYoloDispatch';

beforeEach(() => {
  useBulkYoloStore.setState({ runByProject: {} });
  vi.mocked(invoke).mockClear();
});

describe('dispatchNextBulkYolo', () => {
  it('writes /tiki:yolo {N} to the run terminal when running', async () => {
    useBulkYoloStore.getState().startRun([42, 43], 'term-A');
    await dispatchNextBulkYolo('p1');
    expect(invoke).toHaveBeenCalledWith('write_terminal', {
      id: 'term-A',
      data: '/tiki:yolo 42\r',
    });
  });

  it('no-ops when no run exists', async () => {
    await dispatchNextBulkYolo('p1');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('no-ops when status is paused', async () => {
    useBulkYoloStore.getState().startRun([1], 'term-A');
    useBulkYoloStore.getState().pause();
    await dispatchNextBulkYolo('p1');
    expect(invoke).not.toHaveBeenCalled();
  });
});
