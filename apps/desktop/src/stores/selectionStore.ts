import { create } from 'zustand';
import { useProjectsStore } from './projectsStore';

interface SelectionState {
  /** Per-project selected issue numbers. */
  selectedByProject: Record<string, Set<number>>;
}

interface SelectionActions {
  toggle: (issueNumber: number) => void;
  /** Replace the active project's selection set with the given numbers. */
  selectMany: (issueNumbers: number[]) => void;
  /** Union the given numbers into the active project's selection set. */
  addMany: (issueNumbers: number[]) => void;
  clear: () => void;
  isSelected: (issueNumber: number) => boolean;
  count: () => number;
  /** Sorted ascending. */
  selected: () => number[];
}

const getProjectId = (): string =>
  useProjectsStore.getState().activeProjectId ?? 'default';

/**
 * Selection store for batch operations on issues (#96). Selection is
 * per-project and **NOT persisted** — it's transient UI state and a reload
 * should clear it. Set instances also don't round-trip cleanly through
 * zustand persist middleware, which reinforces the choice.
 */
export const useSelectionStore = create<SelectionState & SelectionActions>(
  (set, get) => ({
    selectedByProject: {},

    toggle: (n) =>
      set((state) => {
        const pid = getProjectId();
        const existing = state.selectedByProject[pid] ?? new Set<number>();
        const next = new Set(existing);
        if (next.has(n)) next.delete(n);
        else next.add(n);
        return {
          selectedByProject: { ...state.selectedByProject, [pid]: next },
        };
      }),

    selectMany: (numbers) =>
      set((state) => {
        const pid = getProjectId();
        return {
          selectedByProject: {
            ...state.selectedByProject,
            [pid]: new Set(numbers),
          },
        };
      }),

    addMany: (numbers) =>
      set((state) => {
        const pid = getProjectId();
        const existing = state.selectedByProject[pid] ?? new Set<number>();
        const next = new Set(existing);
        numbers.forEach((n) => next.add(n));
        return {
          selectedByProject: { ...state.selectedByProject, [pid]: next },
        };
      }),

    clear: () =>
      set((state) => {
        const pid = getProjectId();
        if (!state.selectedByProject[pid]) return state;
        return {
          selectedByProject: {
            ...state.selectedByProject,
            [pid]: new Set<number>(),
          },
        };
      }),

    isSelected: (n) => {
      const pid = getProjectId();
      return get().selectedByProject[pid]?.has(n) ?? false;
    },

    count: () => {
      const pid = getProjectId();
      return get().selectedByProject[pid]?.size ?? 0;
    },

    selected: () => {
      const pid = getProjectId();
      const setForProject = get().selectedByProject[pid];
      return setForProject ? [...setForProject].sort((a, b) => a - b) : [];
    },
  })
);
