import { create } from 'zustand';

export interface GitHubPrAuthor {
  login: string;
}

export interface GitHubPrStatusCheck {
  context?: string;
  name?: string;
  state?: string;
  status?: string;
  conclusion?: string;
  detailsUrl?: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft: boolean;
  reviewDecision: string | null;
  author: GitHubPrAuthor | null;
  labels: Array<{ id: number; name: string; color: string; description: string | null }>;
  body: string | null;
  statusCheckRollup: GitHubPrStatusCheck[];
}

export type PrFilter = 'open' | 'closed' | 'merged' | 'all';

interface PullRequestsState {
  prs: GitHubPullRequest[];
  filter: PrFilter;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  lastFetched: string | null;
  refetchCounter: number;
}

interface PullRequestsActions {
  setPrs: (prs: GitHubPullRequest[]) => void;
  setFilter: (filter: PrFilter) => void;
  setSearchQuery: (query: string) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setLastFetched: (timestamp: string) => void;
  triggerRefetch: () => void;
}

type PullRequestsStore = PullRequestsState & PullRequestsActions;

const initialState: PullRequestsState = {
  prs: [],
  filter: 'open',
  searchQuery: '',
  isLoading: false,
  error: null,
  lastFetched: null,
  refetchCounter: 0,
};

export const usePullRequestsStore = create<PullRequestsStore>()((set) => ({
  ...initialState,

  setPrs: (prs) => set({ prs }),

  setFilter: (filter) => set({ filter }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setIsLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),

  setLastFetched: (lastFetched) => set({ lastFetched }),

  triggerRefetch: () => set((state) => ({ refetchCounter: state.refetchCounter + 1 })),
}));

export function filterPrsBySearch(prs: GitHubPullRequest[], query: string): GitHubPullRequest[] {
  if (!query.trim()) return prs;
  const lowerQuery = query.toLowerCase();
  return prs.filter((pr) => {
    const titleMatch = pr.title.toLowerCase().includes(lowerQuery);
    const bodyMatch = pr.body?.toLowerCase().includes(lowerQuery) ?? false;
    const branchMatch = pr.headRefName.toLowerCase().includes(lowerQuery);
    const authorMatch = pr.author?.login.toLowerCase().includes(lowerQuery) ?? false;
    const labelMatch = pr.labels.some((l) => l.name.toLowerCase().includes(lowerQuery));
    return titleMatch || bodyMatch || branchMatch || authorMatch || labelMatch;
  });
}
