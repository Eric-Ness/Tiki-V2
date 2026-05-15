import { create } from 'zustand';

export interface GitHubRelease {
  tagName: string;
  name?: string;
  isDraft: boolean;
  isPrerelease: boolean;
  publishedAt?: string;
  url?: string;
}

interface ReleasesState {
  releases: GitHubRelease[];
  isLoading: boolean;
  error: string | null;
  lastFetched: string | null;
  refetchCounter: number;
}

interface ReleasesActions {
  setReleases: (releases: GitHubRelease[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setLastFetched: (timestamp: string) => void;
  triggerRefetch: () => void;
}

type ReleasesStore = ReleasesState & ReleasesActions;

const initialState: ReleasesState = {
  releases: [],
  isLoading: false,
  error: null,
  lastFetched: null,
  refetchCounter: 0,
};

export const useReleasesStore = create<ReleasesStore>()((set) => ({
  ...initialState,

  setReleases: (releases) => set({ releases }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),

  setLastFetched: (lastFetched) => set({ lastFetched }),

  triggerRefetch: () => set((state) => ({ refetchCounter: state.refetchCounter + 1 })),
}));
