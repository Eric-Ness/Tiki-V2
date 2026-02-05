import { create } from 'zustand';
import type { WorkContext } from '../components/work';

export interface CompletedIssue {
  number: number;
  title: string;
  completedAt: string;
}

interface TikiStateState {
  activeWork: Record<string, WorkContext>;
  recentIssues: CompletedIssue[];
}

interface TikiStateActions {
  setActiveWork: (activeWork: Record<string, WorkContext>) => void;
  setRecentIssues: (recentIssues: CompletedIssue[]) => void;
  getIssueWorkStatus: (issueNumber: number) => string | null;
}

type TikiStateStore = TikiStateState & TikiStateActions;

const initialState: TikiStateState = {
  activeWork: {},
  recentIssues: [],
};

export const useTikiStateStore = create<TikiStateStore>()((set, get) => ({
  ...initialState,

  setActiveWork: (activeWork) => set({ activeWork }),

  setRecentIssues: (recentIssues) => set({ recentIssues }),

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
