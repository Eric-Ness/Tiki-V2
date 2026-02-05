import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useProjectsStore } from './projectsStore';

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
  /** When true, tab was created in background and hasn't been viewed yet */
  backgroundMode?: boolean;
}

interface TerminalState {
  tabsByProject: Record<string, TerminalTab[]>;
  activeTabByProject: Record<string, string | null>;
}

interface TerminalActions {
  addTab: () => string;
  /** Creates a tab in the background without making it active (won't steal focus) */
  addTabInBackground: () => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setActiveTerminal: (tabId: string, terminalId: string) => void;
  updateTabStatus: (id: string, status: TerminalStatus) => void;
  updateTabTitle: (id: string, title: string) => void;
  updateTabCwd: (id: string, cwd: string) => void;
  splitTerminal: (tabId: string, terminalId: string, direction: SplitDirection) => void;
  closeSplit: (tabId: string, terminalId: string) => void;
  updateSplitSizes: (tabId: string, nodeId: string, sizes: number[]) => void;
  cleanupProject: (projectId: string) => void;
}

type TerminalStore = TerminalState & TerminalActions;

// Counter for generating sequential terminal names
let tabCounter = 1;

const getProjectId = (): string => {
  return useProjectsStore.getState().activeProjectId ?? 'default';
};

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

// Terminal focus function registry (not persisted, not reactive)
const terminalFocusFns = new Map<string, () => void>();

export const terminalFocusRegistry = {
  register: (terminalId: string, focusFn: () => void) => {
    terminalFocusFns.set(terminalId, focusFn);
  },
  unregister: (terminalId: string) => {
    terminalFocusFns.delete(terminalId);
  },
  focus: (terminalId: string) => {
    terminalFocusFns.get(terminalId)?.();
  },
};

const initialState: TerminalState = {
  tabsByProject: {},
  activeTabByProject: {},
};

export const useTerminalStore = create<TerminalStore>()(
  persist(
    (set, _get) => ({
      ...initialState,

      addTab: () => {
        const projectId = getProjectId();
        const tabId = generateId();
        const terminalId = generateId();
        const projectPath = useProjectsStore.getState().getActiveProject()?.path;
        const newTab: TerminalTab = {
          id: tabId,
          title: generateTitle(),
          status: 'starting',
          cwd: projectPath,
          splitRoot: createLeaf(terminalId),
          activeTerminalId: terminalId,
        };
        set((state) => ({
          tabsByProject: {
            ...state.tabsByProject,
            [projectId]: [...(state.tabsByProject[projectId] ?? []), newTab],
          },
          activeTabByProject: {
            ...state.activeTabByProject,
            [projectId]: tabId,
          },
        }));
        return tabId;
      },

      addTabInBackground: () => {
        const projectId = getProjectId();
        const tabId = generateId();
        const terminalId = generateId();
        const projectPath = useProjectsStore.getState().getActiveProject()?.path;
        const newTab: TerminalTab = {
          id: tabId,
          title: generateTitle(),
          status: 'starting',
          cwd: projectPath,
          splitRoot: createLeaf(terminalId),
          activeTerminalId: terminalId,
          backgroundMode: true,
        };
        set((state) => ({
          tabsByProject: {
            ...state.tabsByProject,
            [projectId]: [...(state.tabsByProject[projectId] ?? []), newTab],
          },
          // Don't change activeTabByProject - keep current tab focused
        }));
        return tabId;
      },

      removeTab: (id) =>
        set((state) => {
          const projectId = getProjectId();
          const tabs = state.tabsByProject[projectId] ?? [];
          const activeTabId = state.activeTabByProject[projectId] ?? null;
          const newTabs = tabs.filter((t) => t.id !== id);

          // If removing the last tab, create a new one
          if (newTabs.length === 0) {
            const newTabId = generateId();
            const newTerminalId = generateId();
            const projectPath = useProjectsStore.getState().getActiveProject()?.path;
            const newTab: TerminalTab = {
              id: newTabId,
              title: generateTitle(),
              status: 'starting',
              cwd: projectPath,
              splitRoot: createLeaf(newTerminalId),
              activeTerminalId: newTerminalId,
            };
            return {
              tabsByProject: {
                ...state.tabsByProject,
                [projectId]: [newTab],
              },
              activeTabByProject: {
                ...state.activeTabByProject,
                [projectId]: newTabId,
              },
            };
          }

          // If removing the active tab, select the previous tab or the first one
          let newActiveId = activeTabId;
          if (activeTabId === id) {
            const removedIndex = tabs.findIndex((t) => t.id === id);
            const newIndex = Math.max(0, removedIndex - 1);
            newActiveId = newTabs[newIndex]?.id ?? newTabs[0]?.id ?? null;
          }

          return {
            tabsByProject: {
              ...state.tabsByProject,
              [projectId]: newTabs,
            },
            activeTabByProject: {
              ...state.activeTabByProject,
              [projectId]: newActiveId,
            },
          };
        }),

      setActiveTab: (id) =>
        set((state) => {
          const projectId = getProjectId();
          const tabs = state.tabsByProject[projectId] ?? [];
          return {
            activeTabByProject: {
              ...state.activeTabByProject,
              [projectId]: id,
            },
            // Clear backgroundMode when user views the tab
            tabsByProject: {
              ...state.tabsByProject,
              [projectId]: tabs.map((t) =>
                t.id === id && t.backgroundMode ? { ...t, backgroundMode: false } : t
              ),
            },
          };
        }),

      setActiveTerminal: (tabId, terminalId) =>
        set((state) => {
          const projectId = getProjectId();
          const tabs = state.tabsByProject[projectId] ?? [];
          return {
            tabsByProject: {
              ...state.tabsByProject,
              [projectId]: tabs.map((t) =>
                t.id === tabId ? { ...t, activeTerminalId: terminalId } : t
              ),
            },
          };
        }),

      updateTabStatus: (id, status) =>
        set((state) => {
          const projectId = getProjectId();
          const tabs = state.tabsByProject[projectId] ?? [];
          return {
            tabsByProject: {
              ...state.tabsByProject,
              [projectId]: tabs.map((t) =>
                t.id === id ? { ...t, status } : t
              ),
            },
          };
        }),

      updateTabTitle: (id, title) =>
        set((state) => {
          const projectId = getProjectId();
          const tabs = state.tabsByProject[projectId] ?? [];
          return {
            tabsByProject: {
              ...state.tabsByProject,
              [projectId]: tabs.map((t) =>
                t.id === id ? { ...t, title } : t
              ),
            },
          };
        }),

      updateTabCwd: (id, cwd) =>
        set((state) => {
          const projectId = getProjectId();
          const tabs = state.tabsByProject[projectId] ?? [];
          return {
            tabsByProject: {
              ...state.tabsByProject,
              [projectId]: tabs.map((t) =>
                t.id === id ? { ...t, cwd } : t
              ),
            },
          };
        }),

      splitTerminal: (tabId, terminalId, direction) =>
        set((state) => {
          const projectId = getProjectId();
          const tabs = state.tabsByProject[projectId] ?? [];
          const tab = tabs.find((t) => t.id === tabId);
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
            tabsByProject: {
              ...state.tabsByProject,
              [projectId]: tabs.map((t) =>
                t.id === tabId
                  ? { ...t, splitRoot: newSplitRoot, activeTerminalId: newTerminalId }
                  : t
              ),
            },
          };
        }),

      closeSplit: (tabId, terminalId) =>
        set((state) => {
          const projectId = getProjectId();
          const tabs = state.tabsByProject[projectId] ?? [];
          const tab = tabs.find((t) => t.id === tabId);
          if (!tab) return state;

          const newSplitRoot = removeFromTree(tab.splitRoot, terminalId);

          // If the tree is now empty (shouldn't happen), create a new terminal
          if (newSplitRoot === null) {
            const newTerminalId = generateId();
            return {
              tabsByProject: {
                ...state.tabsByProject,
                [projectId]: tabs.map((t) =>
                  t.id === tabId
                    ? {
                        ...t,
                        splitRoot: createLeaf(newTerminalId),
                        activeTerminalId: newTerminalId,
                      }
                    : t
                ),
              },
            };
          }

          // Update active terminal if we closed it
          let newActiveTerminalId = tab.activeTerminalId;
          if (tab.activeTerminalId === terminalId) {
            const remainingTerminals = getTerminalIds(newSplitRoot);
            newActiveTerminalId = remainingTerminals[0] ?? tab.activeTerminalId;
          }

          return {
            tabsByProject: {
              ...state.tabsByProject,
              [projectId]: tabs.map((t) =>
                t.id === tabId
                  ? { ...t, splitRoot: newSplitRoot, activeTerminalId: newActiveTerminalId }
                  : t
              ),
            },
          };
        }),

      updateSplitSizes: (tabId, nodeId, sizes) =>
        set((state) => {
          const projectId = getProjectId();
          const tabs = state.tabsByProject[projectId] ?? [];
          const tab = tabs.find((t) => t.id === tabId);
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
            tabsByProject: {
              ...state.tabsByProject,
              [projectId]: tabs.map((t) =>
                t.id === tabId ? { ...t, splitRoot: updateSizes(t.splitRoot) } : t
              ),
            },
          };
        }),

      cleanupProject: (projectId) =>
        set((state) => {
          const { [projectId]: _removedTabs, ...remainingTabs } = state.tabsByProject;
          const { [projectId]: _removedActive, ...remainingActive } = state.activeTabByProject;
          return {
            tabsByProject: remainingTabs,
            activeTabByProject: remainingActive,
          };
        }),
    }),
    {
      name: 'tiki-terminals',
      version: 2,
      // Only persist tab metadata, not connection state
      partialize: (state) => {
        const serialized: Record<string, TerminalTab[]> = {};
        for (const [projectId, tabs] of Object.entries(state.tabsByProject)) {
          serialized[projectId] = tabs.map((t) => ({
            ...t,
            status: 'starting' as TerminalStatus, // Reset status on reload
          }));
        }
        return {
          tabsByProject: serialized,
          activeTabByProject: state.activeTabByProject,
        };
      },
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0 || version === 1) {
          // Migrate from flat {tabs, activeTabId} to project-keyed maps
          const old = persistedState as { tabs?: TerminalTab[]; activeTabId?: string | null };
          const projectId = useProjectsStore.getState().activeProjectId ?? 'default';
          const tabs = (old.tabs ?? []).map((tab) => ({
            ...tab,
            splitRoot: tab.splitRoot ?? createLeaf(tab.activeTerminalId || generateId()),
            activeTerminalId: tab.activeTerminalId || (tab.splitRoot?.type === 'terminal' ? tab.splitRoot.terminalId : generateId()),
          }));
          return {
            tabsByProject: { [projectId]: tabs },
            activeTabByProject: { [projectId]: old.activeTabId ?? null },
          };
        }
        return persistedState as TerminalState;
      },
    }
  )
);
