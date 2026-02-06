import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// View types for center panel
export type ViewType = 'terminal' | 'kanban';

// Default panel sizes (percentages)
const DEFAULT_SIZES = {
  sidebar: 15,
  main: 70,
  detail: 15,
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
  activeView: ViewType;
}

interface LayoutActions {
  setPanelSizes: (sizes: PanelSizes) => void;
  setCollapsed: (panel: keyof CollapsedPanels, collapsed: boolean) => void;
  setActiveView: (view: ViewType) => void;
  resetLayout: () => void;
}

type LayoutStore = LayoutState & LayoutActions;

const initialState: LayoutState = {
  panelSizes: { ...DEFAULT_SIZES },
  collapsedPanels: {
    sidebar: false,
    detail: false,
  },
  activeView: 'terminal',
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

      setActiveView: (view) => set({ activeView: view }),

      resetLayout: () => set({ ...initialState }),
    }),
    {
      name: 'tiki-layout',
    }
  )
);

export { DEFAULT_SIZES };
