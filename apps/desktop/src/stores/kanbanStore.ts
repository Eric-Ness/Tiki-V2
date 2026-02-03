import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface KanbanState {
  // Filters
  releaseFilter: string | null;  // null = show all issues

  // UI State
  draggedCardId: number | null;  // Issue number being dragged
}

interface KanbanActions {
  setReleaseFilter: (release: string | null) => void;
  setDraggedCard: (issueNumber: number | null) => void;
}

type KanbanStore = KanbanState & KanbanActions;

const initialState: KanbanState = {
  releaseFilter: null,
  draggedCardId: null,
};

export const useKanbanStore = create<KanbanStore>()(
  persist(
    (set) => ({
      ...initialState,

      setReleaseFilter: (release) => set({ releaseFilter: release }),
      setDraggedCard: (id) => set({ draggedCardId: id }),
    }),
    {
      name: 'tiki-kanban',
      partialize: (state) => ({
        releaseFilter: state.releaseFilter,
        // Don't persist draggedCardId (transient state)
      }),
    }
  )
);
