import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useProjectsStore } from './projectsStore';

interface KanbanState {
  // Filters (per-project)
  releaseFilterByProject: Record<string, string | null>;

  // UI State (global — dragging is transient)
  draggedCardId: number | null;
}

interface KanbanActions {
  setReleaseFilter: (release: string | null) => void;
  setDraggedCard: (issueNumber: number | null) => void;
  cleanupProject: (projectId: string) => void;
}

type KanbanStore = KanbanState & KanbanActions;

const getProjectId = (): string => {
  return useProjectsStore.getState().activeProjectId ?? 'default';
};

const initialState: KanbanState = {
  releaseFilterByProject: {},
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

      cleanupProject: (projectId) =>
        set((state) => {
          const { [projectId]: _removed, ...remaining } = state.releaseFilterByProject;
          return { releaseFilterByProject: remaining };
        }),
    }),
    {
      name: 'tiki-kanban',
      version: 2,
      partialize: (state) => ({
        releaseFilterByProject: state.releaseFilterByProject,
        // Don't persist draggedCardId (transient state)
      }),
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0 || version === 1) {
          const old = persistedState as { releaseFilter?: string | null };
          const projectId = useProjectsStore.getState().activeProjectId ?? 'default';
          return {
            releaseFilterByProject: { [projectId]: old.releaseFilter ?? null },
            draggedCardId: null,
          };
        }
        return persistedState as KanbanState;
      },
    }
  )
);
