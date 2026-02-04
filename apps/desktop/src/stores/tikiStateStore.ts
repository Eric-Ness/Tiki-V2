import { create } from 'zustand';
import type { WorkContext } from '../components/work';

interface TikiStateState {
  activeWork: Record<string, WorkContext>;
}

interface TikiStateActions {
  setActiveWork: (activeWork: Record<string, WorkContext>) => void;
  getIssueWorkStatus: (issueNumber: number) => string | null;
}

type TikiStateStore = TikiStateState & TikiStateActions;

const initialState: TikiStateState = {
  activeWork: {},
};

export const useTikiStateStore = create<TikiStateStore>()((set, get) => ({
  ...initialState,

  setActiveWork: (activeWork) => set({ activeWork }),

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
