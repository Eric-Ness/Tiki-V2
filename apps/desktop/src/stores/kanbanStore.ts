import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useProjectsStore } from './projectsStore';

interface KanbanState {
  // Filters (per-project)
  releaseFilterByProject: Record<string, string | null>;

  // Per-project, per-column ordering. Inner record key is column id, value is
  // the ordered list of issue numbers. Issues not present in the list fall
  // back to the natural API order, appended in their original positions.
  orderByColumnByProject: Record<string, Record<string, number[]>>;

  // UI State (global — dragging is transient)
  draggedCardId: number | null;
}

// Stable empty fallback for `orderByColumnByProject[projectId] ?? EMPTY_COLUMN_ORDER`.
// See EMPTY_TABS in terminalStore.ts for why a module-level constant is required.
export const EMPTY_COLUMN_ORDER: Record<string, number[]> = {};

interface KanbanActions {
  setReleaseFilter: (release: string | null) => void;
  setDraggedCard: (issueNumber: number | null) => void;
  setColumnOrder: (columnId: string, issueNumbers: number[]) => void;
  clearColumnOrder: (columnId: string) => void;
  clearAllColumnOrders: () => void;
  cleanupProject: (projectId: string) => void;
}

type KanbanStore = KanbanState & KanbanActions;

const getProjectId = (): string => {
  return useProjectsStore.getState().activeProjectId ?? 'default';
};

const initialState: KanbanState = {
  releaseFilterByProject: {},
  orderByColumnByProject: {},
  draggedCardId: null,
};

export const useKanbanStore = create<KanbanStore>()(
  persist(
    (set) => ({
      ...initialState,

      setReleaseFilter: (release) => {
        const projectId = getProjectId();
        set((state) => ({
          releaseFilterByProject: {
            ...state.releaseFilterByProject,
            [projectId]: release,
          },
        }));
      },

      setDraggedCard: (id) => set({ draggedCardId: id }),

      setColumnOrder: (columnId, issueNumbers) => {
        const projectId = getProjectId();
        set((state) => ({
          orderByColumnByProject: {
            ...state.orderByColumnByProject,
            [projectId]: {
              ...(state.orderByColumnByProject[projectId] ?? {}),
              [columnId]: issueNumbers,
            },
          },
        }));
      },

      clearColumnOrder: (columnId) => {
        const projectId = getProjectId();
        set((state) => {
          const projectOrders = state.orderByColumnByProject[projectId];
          if (!projectOrders || !(columnId in projectOrders)) return state;
          const { [columnId]: _removed, ...rest } = projectOrders;
          return {
            orderByColumnByProject: {
              ...state.orderByColumnByProject,
              [projectId]: rest,
            },
          };
        });
      },

      clearAllColumnOrders: () => {
        const projectId = getProjectId();
        set((state) => {
          const { [projectId]: _removed, ...rest } = state.orderByColumnByProject;
          return { orderByColumnByProject: rest };
        });
      },

      cleanupProject: (projectId) =>
        set((state) => {
          const { [projectId]: _r1, ...remainingFilters } = state.releaseFilterByProject;
          const { [projectId]: _r2, ...remainingOrders } = state.orderByColumnByProject;
          return {
            releaseFilterByProject: remainingFilters,
            orderByColumnByProject: remainingOrders,
          };
        }),
    }),
    {
      name: 'tiki-kanban',
      version: 3,
      partialize: (state) => ({
        releaseFilterByProject: state.releaseFilterByProject,
        orderByColumnByProject: state.orderByColumnByProject,
        // Don't persist draggedCardId (transient state)
      }),
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0 || version === 1) {
          const old = persistedState as { releaseFilter?: string | null };
          const projectId = useProjectsStore.getState().activeProjectId ?? 'default';
          return {
            releaseFilterByProject: { [projectId]: old.releaseFilter ?? null },
            orderByColumnByProject: {},
            draggedCardId: null,
          };
        }
        if (version === 2) {
          const old = persistedState as { releaseFilterByProject?: Record<string, string | null> };
          return {
            releaseFilterByProject: old.releaseFilterByProject ?? {},
            orderByColumnByProject: {},
            draggedCardId: null,
          };
        }
        return persistedState as KanbanState;
      },
    }
  )
);

/**
 * Apply a persisted issue-number order to a column's issues array. Issues
 * present in `order` come first in the order specified. Issues missing from
 * `order` are appended in their original API order. New issues that haven't
 * been hand-ordered yet show at the bottom — the natural place for new work.
 */
export function applyColumnOrder<T extends { number: number }>(
  issues: T[],
  order: number[] | undefined,
): T[] {
  if (!order || order.length === 0) return issues;
  const orderIndex = new Map<number, number>();
  order.forEach((num, idx) => orderIndex.set(num, idx));

  const ordered: T[] = [];
  const unordered: T[] = [];
  for (const issue of issues) {
    if (orderIndex.has(issue.number)) ordered.push(issue);
    else unordered.push(issue);
  }
  ordered.sort((a, b) => (orderIndex.get(a.number) ?? 0) - (orderIndex.get(b.number) ?? 0));
  return [...ordered, ...unordered];
}
