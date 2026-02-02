import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Default panel sizes (percentages)
const DEFAULT_SIZES = {
  sidebar: 20,
  main: 55,
  detail: 25,
} as const;

export interface PanelSizes {
  sidebar: number;
  main: number;
  detail: number;
}

export interface CollapsedPanels {
  sidebar: boolean;
  detail: boolean;
}

interface LayoutState {
  panelSizes: PanelSizes;
  collapsedPanels: CollapsedPanels;
}

interface LayoutActions {
  setPanelSizes: (sizes: PanelSizes) => void;
  setCollapsed: (panel: keyof CollapsedPanels, collapsed: boolean) => void;
  resetLayout: () => void;
}

type LayoutStore = LayoutState & LayoutActions;

const initialState: LayoutState = {
  panelSizes: { ...DEFAULT_SIZES },
  collapsedPanels: {
    sidebar: false,
    detail: false,
  },
};

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      ...initialState,

      setPanelSizes: (sizes) => set({ panelSizes: sizes }),

      setCollapsed: (panel, collapsed) =>
        set((state) => ({
          collapsedPanels: {
            ...state.collapsedPanels,
            [panel]: collapsed,
          },
        })),

      resetLayout: () => set({ ...initialState }),
    }),
    {
      name: 'tiki-layout',
    }
  )
);

export { DEFAULT_SIZES };
