import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  /**
   * Installed Tiki framework version for this project, read from
   * `<path>/.tiki/.framework-version`. `null` means the project was
   * installed before version stamping and should be treated as outdated.
   * Refreshed from disk on every project switch.
   */
  frameworkVersion?: string | null;
  /**
   * Derived from comparing frameworkVersion to the desktop binary's version.
   * Set by ProjectsSection on every project switch.
   */
  frameworkOutdated?: boolean;
}

interface ProjectsState {
  projects: Project[];
  activeProjectId: string | null;
}

interface ProjectsActions {
  addProject: (path: string, name: string) => void;
  removeProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  getActiveProject: () => Project | undefined;
  setProjectFrameworkVersion: (
    id: string,
    version: string | null,
    outdated: boolean
  ) => void;
}

type ProjectsStore = ProjectsState & ProjectsActions;

const initialState: ProjectsState = {
  projects: [],
  activeProjectId: null,
};

// Simple ID generator
const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

export const useProjectsStore = create<ProjectsStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addProject: (path, name) => {
        const newProject: Project = {
          id: generateId(),
          name,
          path,
          addedAt: new Date().toISOString(),
        };
        set((state) => ({
          projects: [...state.projects, newProject],
          // Auto-select the new project if none is active
          activeProjectId: state.activeProjectId ?? newProject.id,
        }));
      },

      removeProject: (id) =>
        set((state) => {
          const newProjects = state.projects.filter((p) => p.id !== id);
          // If removing the active project, select the first remaining one
          const newActiveId =
            state.activeProjectId === id
              ? newProjects[0]?.id ?? null
              : state.activeProjectId;
          return {
            projects: newProjects,
            activeProjectId: newActiveId,
          };
        }),

      setActiveProject: (id) => set({ activeProjectId: id }),

      getActiveProject: () => {
        const state = get();
        return state.projects.find((p) => p.id === state.activeProjectId);
      },

      setProjectFrameworkVersion: (id, version, outdated) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id
              ? { ...p, frameworkVersion: version, frameworkOutdated: outdated }
              : p
          ),
        })),
    }),
    {
      name: 'tiki-projects',
    }
  )
);
