import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock projects store BEFORE importing selectionStore — selectionStore's
// `getProjectId` resolves via `useProjectsStore.getState().activeProjectId`
// at call time, but mocking ahead of import keeps the test hermetic and
// independent of any zustand-persist hydration race.
vi.mock('../projectsStore', () => ({
  useProjectsStore: {
    getState: () => ({ activeProjectId: 'p1' }),
  },
}));

import { useSelectionStore } from '../selectionStore';

function reset() {
  useSelectionStore.setState({ selectedByProject: {} });
}

beforeEach(() => reset());

describe('selectionStore', () => {
  it('toggle adds then removes an issue', () => {
    const s = useSelectionStore.getState();
    s.toggle(42);
    expect(useSelectionStore.getState().isSelected(42)).toBe(true);
    expect(useSelectionStore.getState().count()).toBe(1);
    useSelectionStore.getState().toggle(42);
    expect(useSelectionStore.getState().isSelected(42)).toBe(false);
    expect(useSelectionStore.getState().count()).toBe(0);
  });

  it('selectMany replaces the selection set', () => {
    const s = useSelectionStore.getState();
    s.toggle(1);
    s.toggle(2);
    useSelectionStore.getState().selectMany([10, 20, 30]);
    expect(useSelectionStore.getState().selected()).toEqual([10, 20, 30]);
    expect(useSelectionStore.getState().isSelected(1)).toBe(false);
  });

  it('addMany unions into the existing selection without duplicates', () => {
    const s = useSelectionStore.getState();
    s.toggle(1);
    useSelectionStore.getState().addMany([2, 3, 1]); // 1 is duplicate
    expect(useSelectionStore.getState().selected()).toEqual([1, 2, 3]);
  });

  it('clear empties the selection', () => {
    const s = useSelectionStore.getState();
    s.selectMany([1, 2, 3]);
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().count()).toBe(0);
    expect(useSelectionStore.getState().selected()).toEqual([]);
  });
});
