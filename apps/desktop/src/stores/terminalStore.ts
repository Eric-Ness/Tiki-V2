import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TerminalStatus = 'starting' | 'ready' | 'busy' | 'idle' | 'exited';

// Split tree types
export type SplitDirection = 'horizontal' | 'vertical';

export interface TerminalLeaf {
  type: 'terminal';
  terminalId: string;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  children: SplitTreeNode[];
  sizes: number[];
}

export type SplitTreeNode = TerminalLeaf | SplitNode;

export interface TerminalTab {
  id: string;
  title: string;
  status: TerminalStatus;
  cwd?: string;
  splitRoot: SplitTreeNode;
  activeTerminalId: string;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}

interface TerminalActions {
  addTab: () => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setActiveTerminal: (tabId: string, terminalId: string) => void;
  updateTabStatus: (id: string, status: TerminalStatus) => void;
  updateTabTitle: (id: string, title: string) => void;
  updateTabCwd: (id: string, cwd: string) => void;
  splitTerminal: (tabId: string, terminalId: string, direction: SplitDirection) => void;
  closeSplit: (tabId: string, terminalId: string) => void;
  updateSplitSizes: (tabId: string, nodeId: string, sizes: number[]) => void;
}

type TerminalStore = TerminalState & TerminalActions;

// Counter for generating sequential terminal names
let tabCounter = 1;

const generateId = (): string => {
  return `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const generateSplitId = (): string => {
  return `split-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const generateTitle = (): string => {
  return `Terminal ${tabCounter++}`;
};

// Helper to create a leaf node
const createLeaf = (terminalId: string): TerminalLeaf => ({
  type: 'terminal',
  terminalId,
});

// Helper to find and replace a node in the tree
const replaceInTree = (
  node: SplitTreeNode,
  targetId: string,
  replacement: SplitTreeNode
): SplitTreeNode => {
  if (node.type === 'terminal') {
    return node.terminalId === targetId ? replacement : node;
  }

  return {
    ...node,
    children: node.children.map((child) =>
      replaceInTree(child, targetId, replacement)
    ),
  };
};

// Helper to remove a terminal from the tree and promote sibling
const removeFromTree = (
  node: SplitTreeNode,
  targetId: string
): SplitTreeNode | null => {
  if (node.type === 'terminal') {
    return node.terminalId === targetId ? null : node;
  }

  const newChildren: SplitTreeNode[] = [];
  const newSizes: number[] = [];
  let removedIndex = -1;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const result = removeFromTree(child, targetId);

    if (result === null) {
      // This child was removed
      removedIndex = i;
    } else {
      newChildren.push(result);
      newSizes.push(node.sizes[i]);
    }
  }

  // If nothing was removed, return unchanged
  if (removedIndex === -1) {
    return node;
  }

  // If only one child left, promote it
  if (newChildren.length === 1) {
    return newChildren[0];
  }

  // Redistribute sizes proportionally
  const totalSize = newSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = newSizes.map((s) => (s / totalSize) * 100);

  return {
    ...node,
    children: newChildren,
    sizes: normalizedSizes,
  };
};

// Helper to find all terminal IDs in a tree
const getTerminalIds = (node: SplitTreeNode): string[] => {
  if (node.type === 'terminal') {
    return [node.terminalId];
  }
  return node.children.flatMap(getTerminalIds);
};

const initialState: TerminalState = {
  tabs: [],
  activeTabId: null,
};

export const useTerminalStore = create<TerminalStore>()(
  persist(
    (set, _get) => ({
      ...initialState,

      addTab: () => {
        const tabId = generateId();
        const terminalId = generateId();
        const newTab: TerminalTab = {
          id: tabId,
          title: generateTitle(),
          status: 'starting',
          splitRoot: createLeaf(terminalId),
          activeTerminalId: terminalId,
        };
        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: tabId,
        }));
        return tabId;
      },

      removeTab: (id) =>
        set((state) => {
          const newTabs = state.tabs.filter((t) => t.id !== id);

          // If removing the last tab, create a new one
          if (newTabs.length === 0) {
            const newTabId = generateId();
            const newTerminalId = generateId();
            const newTab: TerminalTab = {
              id: newTabId,
              title: generateTitle(),
              status: 'starting',
              splitRoot: createLeaf(newTerminalId),
              activeTerminalId: newTerminalId,
            };
            return {
              tabs: [newTab],
              activeTabId: newTabId,
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

      setActiveTerminal: (tabId, terminalId) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, activeTerminalId: terminalId } : t
          ),
        })),

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

      splitTerminal: (tabId, terminalId, direction) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.id === tabId);
          if (!tab) return state;

          const newTerminalId = generateId();
          const splitNode: SplitNode = {
            type: 'split',
            id: generateSplitId(),
            direction,
            children: [createLeaf(terminalId), createLeaf(newTerminalId)],
            sizes: [50, 50],
          };

          const newSplitRoot = replaceInTree(tab.splitRoot, terminalId, splitNode);

          return {
            tabs: state.tabs.map((t) =>
              t.id === tabId
                ? { ...t, splitRoot: newSplitRoot, activeTerminalId: newTerminalId }
                : t
            ),
          };
        }),

      closeSplit: (tabId, terminalId) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.id === tabId);
          if (!tab) return state;

          const newSplitRoot = removeFromTree(tab.splitRoot, terminalId);

          // If the tree is now empty (shouldn't happen), create a new terminal
          if (newSplitRoot === null) {
            const newTerminalId = generateId();
            return {
              tabs: state.tabs.map((t) =>
                t.id === tabId
                  ? {
                      ...t,
                      splitRoot: createLeaf(newTerminalId),
                      activeTerminalId: newTerminalId,
                    }
                  : t
              ),
            };
          }

          // Update active terminal if we closed it
          let newActiveTerminalId = tab.activeTerminalId;
          if (tab.activeTerminalId === terminalId) {
            const remainingTerminals = getTerminalIds(newSplitRoot);
            newActiveTerminalId = remainingTerminals[0] ?? tab.activeTerminalId;
          }

          return {
            tabs: state.tabs.map((t) =>
              t.id === tabId
                ? { ...t, splitRoot: newSplitRoot, activeTerminalId: newActiveTerminalId }
                : t
            ),
          };
        }),

      updateSplitSizes: (tabId, nodeId, sizes) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.id === tabId);
          if (!tab) return state;

          const updateSizes = (node: SplitTreeNode): SplitTreeNode => {
            if (node.type === 'terminal') return node;
            if (node.id === nodeId) {
              return { ...node, sizes };
            }
            return {
              ...node,
              children: node.children.map(updateSizes),
            };
          };

          return {
            tabs: state.tabs.map((t) =>
              t.id === tabId ? { ...t, splitRoot: updateSizes(t.splitRoot) } : t
            ),
          };
        }),
    }),
    {
      name: 'tiki-terminals',
      version: 1,
      // Only persist tab metadata, not connection state
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          ...t,
          status: 'starting' as TerminalStatus, // Reset status on reload
        })),
        activeTabId: state.activeTabId,
      }),
      // Migrate old persisted state that may be missing splitRoot
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0) {
          const state = persistedState as TerminalState;
          return {
            ...state,
            tabs: state.tabs.map((tab) => ({
              ...tab,
              splitRoot: tab.splitRoot ?? createLeaf(tab.activeTerminalId || generateId()),
              activeTerminalId: tab.activeTerminalId || (tab.splitRoot?.type === 'terminal' ? tab.splitRoot.terminalId : generateId()),
            })),
          };
        }
        return persistedState as TerminalState;
      },
    }
  )
);
