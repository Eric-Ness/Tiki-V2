import { create } from 'zustand';
import type { WorkContext } from '../components/work';

export interface CompletedIssue {
  number: number;
  title?: string;
  completedAt: string;
}

export interface CompletedRelease {
  version: string;
  issues: number[];
  completedAt: string;
  tag?: string;
}

interface TikiStateState {
  activeWork: Record<string, WorkContext>;
  recentIssues: CompletedIssue[];
  recentReleases: CompletedRelease[];
  planNonces: Record<number, number>;
}

interface TikiStateActions {
  setActiveWork: (activeWork: Record<string, WorkContext>) => void;
  setRecentIssues: (recentIssues: CompletedIssue[]) => void;
  setRecentReleases: (recentReleases: CompletedRelease[]) => void;
  getIssueWorkStatus: (issueNumber: number) => string | null;
  bumpPlanNonce: (issueNumber: number) => void;
}

type TikiStateStore = TikiStateState & TikiStateActions;

const initialState: TikiStateState = {
  activeWork: {},
  recentIssues: [],
  recentReleases: [],
  planNonces: {},
};

export const useTikiStateStore = create<TikiStateStore>()((set, get) => ({
  ...initialState,

  setActiveWork: (activeWork) => set({ activeWork }),

  setRecentIssues: (recentIssues) => set({ recentIssues }),

  setRecentReleases: (recentReleases) => set({ recentReleases }),

  // Bump the plan-change nonce for a specific issue (immutable per-issue increment)
  bumpPlanNonce: (issueNumber) =>
    set((s) => ({
      planNonces: {
        ...s.planNonces,
        [issueNumber]: (s.planNonces[issueNumber] ?? 0) + 1,
      },
    })),

  // Get the work status for a specific issue
  getIssueWorkStatus: (issueNumber) => {
    const { activeWork } = get();
    const key = `issue:${issueNumber}`;
    const work = activeWork[key];
    if (work && work.type === 'issue') {
      return work.status;
    }
    return null;
  },
}));
