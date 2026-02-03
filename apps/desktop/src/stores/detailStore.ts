import { create } from 'zustand';

interface DetailState {
  selectedIssue: number | null;
  selectedRelease: string | null;
}

interface DetailActions {
  setSelectedIssue: (issueNumber: number | null) => void;
  setSelectedRelease: (version: string | null) => void;
  clearSelection: () => void;
}

type DetailStore = DetailState & DetailActions;

const initialState: DetailState = {
  selectedIssue: null,
  selectedRelease: null,
};

export const useDetailStore = create<DetailStore>()((set) => ({
  ...initialState,

  setSelectedIssue: (issueNumber) =>
    set({
      selectedIssue: issueNumber,
      selectedRelease: null, // Clear release selection when selecting issue
    }),

  setSelectedRelease: (version) =>
    set({
      selectedRelease: version,
      selectedIssue: null, // Clear issue selection when selecting release
    }),

  clearSelection: () =>
    set({
      selectedIssue: null,
      selectedRelease: null,
    }),
}));
