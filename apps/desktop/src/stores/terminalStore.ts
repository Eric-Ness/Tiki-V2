import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TerminalStatus = 'starting' | 'ready' | 'busy' | 'idle' | 'exited';

export interface TerminalTab {
  id: string;
  title: string;
  status: TerminalStatus;
  cwd?: string;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}

interface TerminalActions {
  addTab: () => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabStatus: (id: string, status: TerminalStatus) => void;
  updateTabTitle: (id: string, title: string) => void;
  updateTabCwd: (id: string, cwd: string) => void;
}

type TerminalStore = TerminalState & TerminalActions;

// Counter for generating sequential terminal names
let tabCounter = 1;

const generateId = (): string => {
  return `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const generateTitle = (): string => {
  return `Terminal ${tabCounter++}`;
};

const initialState: TerminalState = {
  tabs: [],
  activeTabId: null,
};

export const useTerminalStore = create<TerminalStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addTab: () => {
        const id = generateId();
        const newTab: TerminalTab = {
          id,
          title: generateTitle(),
          status: 'starting',
        };
        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: id,
        }));
        return id;
      },

      removeTab: (id) =>
        set((state) => {
          const newTabs = state.tabs.filter((t) => t.id !== id);

          // If removing the last tab, create a new one
          if (newTabs.length === 0) {
            const newId = generateId();
            const newTab: TerminalTab = {
              id: newId,
              title: generateTitle(),
              status: 'starting',
            };
            return {
              tabs: [newTab],
              activeTabId: newId,
            };
          }

          // If removing the active tab, select the previous tab or the first one
          let newActiveId = state.activeTabId;
          if (state.activeTabId === id) {
            const removedIndex = state.tabs.findIndex((t) => t.id === id);
            const newIndex = Math.max(0, removedIndex - 1);
            newActiveId = newTabs[newIndex]?.id ?? newTabs[0]?.id ?? null;
          }

          return {
            tabs: newTabs,
            activeTabId: newActiveId,
          };
        }),

      setActiveTab: (id) => set({ activeTabId: id }),

      updateTabStatus: (id, status) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id ? { ...t, status } : t
          ),
        })),

      updateTabTitle: (id, title) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id ? { ...t, title } : t
          ),
        })),

      updateTabCwd: (id, cwd) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id ? { ...t, cwd } : t
          ),
        })),
    }),
    {
      name: 'tiki-terminals',
      // Only persist tab metadata, not connection state
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          ...t,
          status: 'starting' as TerminalStatus, // Reset status on reload
        })),
        activeTabId: state.activeTabId,
      }),
    }
  )
);
