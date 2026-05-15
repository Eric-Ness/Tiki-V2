import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock projects store BEFORE importing selectionStore — selectionStore's
// `getProjectId` resolves via `useProjectsStore.getState().activeProjectId`
// at call time. Mocking ahead of import keeps the test hermetic.
vi.mock('../projectsStore', () => ({
  useProjectsStore: {
    getState: () => ({ activeProjectId: 'p1' }),
  },
}));

import { useSelectionStore } from '../selectionStore';

beforeEach(() => {
  useSelectionStore.setState({
    selectedByProject: {},
    anchorBySurfaceByProject: {},
  });
});

describe('rangeSelect', () => {
  it('with no anchor, behaves as a plain toggle and sets the anchor', () => {
    const s = useSelectionStore.getState();
    s.rangeSelect('kanban:open', [1, 2, 3, 4], 2);
    expect(useSelectionStore.getState().selected()).toEqual([2]);

    // Anchor was just set to 2; range from 2..4 selects 2, 3, 4.
    useSelectionStore.getState().rangeSelect('kanban:open', [1, 2, 3, 4], 4);
    expect(useSelectionStore.getState().selected()).toEqual([2, 3, 4]);
  });

  it('selects ascending range from anchor to target', () => {
    const s = useSelectionStore.getState();
    s.toggle(1, 'kanban:open');
    useSelectionStore.getState().rangeSelect('kanban:open', [1, 2, 3, 4, 5], 4);
    expect(useSelectionStore.getState().selected()).toEqual([1, 2, 3, 4]);
  });

  it('selects descending range (target before anchor)', () => {
    const s = useSelectionStore.getState();
    s.toggle(5, 'kanban:open');
    useSelectionStore.getState().rangeSelect('kanban:open', [1, 2, 3, 4, 5], 2);
    expect(useSelectionStore.getState().selected()).toEqual([2, 3, 4, 5]);
  });

  it('falls back to plain toggle when anchor no longer in surface', () => {
    const s = useSelectionStore.getState();
    // Anchor 99 is not in the surface list — fallback toggles target only.
    s.toggle(99, 'kanban:open');
    useSelectionStore.getState().rangeSelect('kanban:open', [1, 2, 3], 2);
    expect(useSelectionStore.getState().selected()).toEqual([2, 99]);
  });
});
