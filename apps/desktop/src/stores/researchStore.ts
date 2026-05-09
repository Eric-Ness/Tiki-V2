import { create } from 'zustand';

export interface ResearchDocMeta {
  filename: string;
  topic: string;
  tags: string[];
  issues: number[];
  created: string;
}

interface ResearchState {
  docs: ResearchDocMeta[];
  isLoading: boolean;
  error: string | null;
}

interface ResearchActions {
  setDocs: (docs: ResearchDocMeta[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

type ResearchStore = ResearchState & ResearchActions;

const initialState: ResearchState = {
  docs: [],
  isLoading: false,
  error: null,
};

export const useResearchStore = create<ResearchStore>()((set) => ({
  ...initialState,

  setDocs: (docs) => set({ docs }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),
}));
