import { create } from 'zustand';

interface DetailState {
  selectedIssue: number | null;
  selectedRelease: string | null;
  selectedTikiRelease: string | null;
}

interface DetailActions {
  setSelectedIssue: (issueNumber: number | null) => void;
  setSelectedRelease: (tagName: string | null) => void;
  setSelectedTikiRelease: (version: string | null) => void;
  clearSelection: () => void;
}

type DetailStore = DetailState & DetailActions;

const initialState: DetailState = {
  selectedIssue: null,
  selectedRelease: null,
  selectedTikiRelease: null,
};

export const useDetailStore = create<DetailStore>()((set) => ({
  ...initialState,

  setSelectedIssue: (issueNumber) =>
    set({
      selectedIssue: issueNumber,
      selectedRelease: null,
      selectedTikiRelease: null,
    }),

  setSelectedRelease: (tagName) =>
    set({
      selectedRelease: tagName,
      selectedIssue: null,
      selectedTikiRelease: null,
    }),

  setSelectedTikiRelease: (version) =>
    set({
      selectedTikiRelease: version,
      selectedIssue: null,
      selectedRelease: null,
    }),

  clearSelection: () =>
    set({
      selectedIssue: null,
      selectedRelease: null,
      selectedTikiRelease: null,
    }),
}));
