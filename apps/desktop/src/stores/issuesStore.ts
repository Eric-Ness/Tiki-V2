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
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  lastFetched: string | null;
  refetchCounter: number;
}

interface IssuesActions {
  setIssues: (issues: GitHubIssue[]) => void;
  setFilter: (filter: IssueFilter) => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setLastFetched: (timestamp: string) => void;
  triggerRefetch: () => void;
}

type IssuesStore = IssuesState & IssuesActions;

const initialState: IssuesState = {
  issues: [],
  filter: 'open',
  searchQuery: '',
  isLoading: false,
  error: null,
  lastFetched: null,
  refetchCounter: 0,
};

export const useIssuesStore = create<IssuesStore>()((set) => ({
  ...initialState,

  setIssues: (issues) => set({ issues }),

  setFilter: (filter) => set({ filter }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),

  setLastFetched: (lastFetched) => set({ lastFetched }),

  triggerRefetch: () => set((state) => ({ refetchCounter: state.refetchCounter + 1 })),
}));

export function filterIssuesBySearch(issues: GitHubIssue[], query: string): GitHubIssue[] {
  if (!query.trim()) return issues;
  const lowerQuery = query.toLowerCase();
  return issues.filter((issue) => {
    const titleMatch = issue.title.toLowerCase().includes(lowerQuery);
    const bodyMatch = issue.body?.toLowerCase().includes(lowerQuery) ?? false;
    const labelMatch = issue.labels.some((label) =>
      label.name.toLowerCase().includes(lowerQuery)
    );
    return titleMatch || bodyMatch || labelMatch;
  });
}
