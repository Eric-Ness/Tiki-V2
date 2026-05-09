import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useProjectsStore } from './projectsStore';

interface ProjectSelection {
  selectedIssue: number | null;
  selectedRelease: string | null;
  selectedTikiRelease: string | null;
  selectedPr: number | null;
  selectedResearchDoc: string | null;
}

interface DetailState {
  selectionByProject: Record<string, ProjectSelection>;
}

interface DetailActions {
  setSelectedIssue: (issueNumber: number | null) => void;
  setSelectedRelease: (tagName: string | null) => void;
  setSelectedTikiRelease: (version: string | null) => void;
  setSelectedPr: (prNumber: number | null) => void;
  setSelectedResearchDoc: (filename: string | null) => void;
  clearSelection: () => void;
  cleanupProject: (projectId: string) => void;
}

type DetailStore = DetailState & DetailActions;

const getProjectId = (): string => {
  return useProjectsStore.getState().activeProjectId ?? 'default';
};

const emptySelection: ProjectSelection = {
  selectedIssue: null,
  selectedRelease: null,
  selectedTikiRelease: null,
  selectedPr: null,
  selectedResearchDoc: null,
};

const initialState: DetailState = {
  selectionByProject: {},
};

export const useDetailStore = create<DetailStore>()(
  persist(
    (set) => ({
      ...initialState,

      setSelectedIssue: (issueNumber) => {
        const projectId = getProjectId();
        set((state) => ({
          selectionByProject: {
            ...state.selectionByProject,
            [projectId]: {
              selectedIssue: issueNumber,
              selectedRelease: null,
              selectedTikiRelease: null,
              selectedPr: null,
              selectedResearchDoc: null,
            },
          },
        }));
      },

      setSelectedRelease: (tagName) => {
        const projectId = getProjectId();
        set((state) => ({
          selectionByProject: {
            ...state.selectionByProject,
            [projectId]: {
              selectedRelease: tagName,
              selectedIssue: null,
              selectedTikiRelease: null,
              selectedPr: null,
              selectedResearchDoc: null,
            },
          },
        }));
      },

      setSelectedTikiRelease: (version) => {
        const projectId = getProjectId();
        set((state) => ({
          selectionByProject: {
            ...state.selectionByProject,
            [projectId]: {
              selectedTikiRelease: version,
              selectedIssue: null,
              selectedRelease: null,
              selectedPr: null,
              selectedResearchDoc: null,
            },
          },
        }));
      },

      setSelectedPr: (prNumber) => {
        const projectId = getProjectId();
        set((state) => ({
          selectionByProject: {
            ...state.selectionByProject,
            [projectId]: {
              selectedPr: prNumber,
              selectedIssue: null,
              selectedRelease: null,
              selectedTikiRelease: null,
              selectedResearchDoc: null,
            },
          },
        }));
      },

      setSelectedResearchDoc: (filename) => {
        const projectId = getProjectId();
        set((state) => ({
          selectionByProject: {
            ...state.selectionByProject,
            [projectId]: {
              selectedResearchDoc: filename,
              selectedIssue: null,
              selectedRelease: null,
              selectedTikiRelease: null,
              selectedPr: null,
            },
          },
        }));
      },

      clearSelection: () => {
        const projectId = getProjectId();
        set((state) => ({
          selectionByProject: {
            ...state.selectionByProject,
            [projectId]: { ...emptySelection },
          },
        }));
      },

      cleanupProject: (projectId) =>
        set((state) => {
          const { [projectId]: _removed, ...remaining } = state.selectionByProject;
          return { selectionByProject: remaining };
        }),
    }),
    {
      name: 'tiki-detail',
    }
  )
);
