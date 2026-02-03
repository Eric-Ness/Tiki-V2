import { create } from 'zustand';

export interface TikiReleaseIssue {
  number: number;
  title: string;
}

export type TikiReleaseStatus = 'active' | 'completed' | 'shipped' | 'not_planned';

export interface TikiRelease {
  version: string;
  name?: string;
  status: TikiReleaseStatus;
  issues: TikiReleaseIssue[];
  createdAt: string;
  updatedAt?: string;
}

interface TikiReleasesState {
  releases: TikiRelease[];
  isLoading: boolean;
  error: string | null;
  lastFetched: string | null;
}

interface TikiReleasesActions {
  setReleases: (releases: TikiRelease[]) => void;
  addRelease: (release: TikiRelease) => void;
  updateRelease: (version: string, updates: Partial<TikiRelease>) => void;
  deleteRelease: (version: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setLastFetched: (timestamp: string) => void;
}

type TikiReleasesStore = TikiReleasesState & TikiReleasesActions;

const initialState: TikiReleasesState = {
  releases: [],
  isLoading: false,
  error: null,
  lastFetched: null,
};

export const useTikiReleasesStore = create<TikiReleasesStore>()((set) => ({
  ...initialState,

  setReleases: (releases) => set({ releases }),

  addRelease: (release) =>
    set((state) => ({
      releases: [...state.releases, release],
    })),

  updateRelease: (version, updates) =>
    set((state) => ({
      releases: state.releases.map((r) =>
        r.version === version ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r
      ),
    })),

  deleteRelease: (version) =>
    set((state) => ({
      releases: state.releases.filter((r) => r.version !== version),
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),

  setLastFetched: (lastFetched) => set({ lastFetched }),
}));
