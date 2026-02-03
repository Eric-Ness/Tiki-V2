import { create } from 'zustand';

export interface GitHubLabel {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
  labels: GitHubLabel[];
  url: string;
  createdAt: string;
  updatedAt: string;
}

export type IssueFilter = 'open' | 'closed' | 'all';

interface IssuesState {
  issues: GitHubIssue[];
  filter: IssueFilter;
  isLoading: boolean;
  error: string | null;
  lastFetched: string | null;
}

interface IssuesActions {
  setIssues: (issues: GitHubIssue[]) => void;
  setFilter: (filter: IssueFilter) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setLastFetched: (timestamp: string) => void;
}

type IssuesStore = IssuesState & IssuesActions;

const initialState: IssuesState = {
  issues: [],
  filter: 'open',
  isLoading: false,
  error: null,
  lastFetched: null,
};

export const useIssuesStore = create<IssuesStore>()((set) => ({
  ...initialState,

  setIssues: (issues) => set({ issues }),

  setFilter: (filter) => set({ filter }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),

  setLastFetched: (lastFetched) => set({ lastFetched }),
}));
