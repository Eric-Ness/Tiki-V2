import { create } from 'zustand';
import { useProjectsStore } from './projectsStore';

interface SelectionState {
  /** Per-project selected issue numbers. */
  selectedByProject: Record<string, Set<number>>;
  /**
   * Per-project, per-surface anchor for shift+click range selection.
   * Surface keys are e.g. `kanban:open`, `kanban:review`, `issues-list` —
   * "range" only makes sense within a single ordered visible list, so the
   * anchor is scoped per-surface. Reset when the selection clears.
   */
  anchorBySurfaceByProject: Record<string, Record<string, number | null>>;
}

interface SelectionActions {
  /**
   * Toggle a single issue. When `surface` is provided the per-surface
   * anchor is updated to this issue number — subsequent shift-clicks on
   * the same surface will use it as the range start.
   */
  toggle: (issueNumber: number, surface?: string) => void;
  /** Replace the active project's selection set with the given numbers. */
  selectMany: (issueNumbers: number[]) => void;
  /** Union the given numbers into the active project's selection set. */
  addMany: (issueNumbers: number[]) => void;
  /**
   * Shift+click range select. Adds every issue between the surface's
   * anchor and the target (inclusive, in the surface's visible order) to
   * the selection. If no anchor exists yet, behaves as a plain toggle and
   * sets the anchor. If the anchor or target is no longer visible on the
   * surface, falls back to a plain toggle without crashing.
   */
  rangeSelect: (
    surface: string,
    surfaceIssueNumbers: number[],
    targetIssueNumber: number
  ) => void;
  clear: () => void;
  isSelected: (issueNumber: number) => boolean;
  count: () => number;
  /** Sorted ascending. */
  selected: () => number[];
}

const getProjectId = (): string =>
  useProjectsStore.getState().activeProjectId ?? 'default';

/**
 * Selection store for batch operations on issues (#96, #203). Selection is
 * per-project and **NOT persisted** — it's transient UI state and a reload
 * should clear it. Set instances also don't round-trip cleanly through
 * zustand persist middleware, which reinforces the choice.
 */
export const useSelectionStore = create<SelectionState & SelectionActions>(
  (set, get) => ({
    selectedByProject: {},
    anchorBySurfaceByProject: {},

    toggle: (n, surface) =>
      set((state) => {
        const pid = getProjectId();
        const existing = state.selectedByProject[pid] ?? new Set<number>();
        const next = new Set(existing);
        if (next.has(n)) next.delete(n);
        else next.add(n);
        const updates: Partial<SelectionState> = {
          selectedByProject: { ...state.selectedByProject, [pid]: next },
        };
        if (surface) {
          updates.anchorBySurfaceByProject = {
            ...state.anchorBySurfaceByProject,
            [pid]: {
              ...(state.anchorBySurfaceByProject[pid] ?? {}),
              [surface]: n,
            },
          };
        }
        return updates;
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

    rangeSelect: (surface, surfaceIssueNumbers, targetIssueNumber) =>
      set((state) => {
        const pid = getProjectId();
        const anchor =
          state.anchorBySurfaceByProject[pid]?.[surface] ?? null;
        const current = state.selectedByProject[pid] ?? new Set<number>();

        if (anchor === null) {
          // No anchor yet — treat shift-click as a plain toggle and set
          // the anchor for subsequent shift-clicks on this surface.
          const next = new Set(current);
          if (next.has(targetIssueNumber)) next.delete(targetIssueNumber);
          else next.add(targetIssueNumber);
          return {
            selectedByProject: {
              ...state.selectedByProject,
              [pid]: next,
            },
            anchorBySurfaceByProject: {
              ...state.anchorBySurfaceByProject,
              [pid]: {
                ...(state.anchorBySurfaceByProject[pid] ?? {}),
                [surface]: targetIssueNumber,
              },
            },
          };
        }

        const anchorIdx = surfaceIssueNumbers.indexOf(anchor);
        const targetIdx = surfaceIssueNumbers.indexOf(targetIssueNumber);
        if (anchorIdx === -1 || targetIdx === -1) {
          // Anchor or target no longer visible on this surface — fall
          // back to a plain toggle to keep the click meaningful.
          const next = new Set(current);
          if (next.has(targetIssueNumber)) next.delete(targetIssueNumber);
          else next.add(targetIssueNumber);
          return {
            selectedByProject: {
              ...state.selectedByProject,
              [pid]: next,
            },
          };
        }

        const [from, to] =
          anchorIdx < targetIdx
            ? [anchorIdx, targetIdx]
            : [targetIdx, anchorIdx];
        const next = new Set(current);
        for (let i = from; i <= to; i++) {
          next.add(surfaceIssueNumbers[i]);
        }
        return {
          selectedByProject: {
            ...state.selectedByProject,
            [pid]: next,
          },
        };
      }),

    clear: () =>
      set((state) => {
        const pid = getProjectId();
        return {
          selectedByProject: {
            ...state.selectedByProject,
            [pid]: new Set<number>(),
          },
          anchorBySurfaceByProject: {
            ...state.anchorBySurfaceByProject,
            [pid]: {},
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
