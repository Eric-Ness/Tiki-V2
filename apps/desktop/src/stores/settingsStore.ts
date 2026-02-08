import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// --- Terminal Settings ---
export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  scrollbackBuffer: number;
  defaultShell: string; // empty string = system default
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  scrollbackBuffer: 1000,
  defaultShell: '',
};

// --- Appearance Settings ---
export interface AppearanceSettings {
  theme: 'dark' | 'light' | 'system';
  sidebarDefaultSize: number;
  detailDefaultSize: number;
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: 'dark',
  sidebarDefaultSize: 15,
  detailDefaultSize: 15,
};

// --- Workflow Settings ---
export interface WorkflowSettings {
  defaultBranchStrategy: 'current' | 'auto' | 'custom';
  defaultModel: 'sonnet' | 'opus' | 'haiku';
  defaultPlanningType: 'skip' | 'lite' | 'spec' | 'full';
}

export const DEFAULT_WORKFLOW_SETTINGS: WorkflowSettings = {
  defaultBranchStrategy: 'current',
  defaultModel: 'sonnet',
  defaultPlanningType: 'full',
};

// --- GitHub Settings ---
export interface GitHubSettings {
  issueFetchLimit: number;
  defaultLabels: string[];
}

export const DEFAULT_GITHUB_SETTINGS: GitHubSettings = {
  issueFetchLimit: 30,
  defaultLabels: [],
};

// --- Store ---
interface SettingsState {
  terminal: TerminalSettings;
  appearance: AppearanceSettings;
  workflow: WorkflowSettings;
  github: GitHubSettings;
}

interface SettingsActions {
  updateTerminal: (updates: Partial<TerminalSettings>) => void;
  updateAppearance: (updates: Partial<AppearanceSettings>) => void;
  updateWorkflow: (updates: Partial<WorkflowSettings>) => void;
  updateGitHub: (updates: Partial<GitHubSettings>) => void;
  resetTerminal: () => void;
  resetAppearance: () => void;
  resetWorkflow: () => void;
  resetGitHub: () => void;
  resetAll: () => void;
}

type SettingsStore = SettingsState & SettingsActions;

const initialState: SettingsState = {
  terminal: { ...DEFAULT_TERMINAL_SETTINGS },
  appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
  workflow: { ...DEFAULT_WORKFLOW_SETTINGS },
  github: { ...DEFAULT_GITHUB_SETTINGS },
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...initialState,

      updateTerminal: (updates) =>
        set((state) => ({ terminal: { ...state.terminal, ...updates } })),

      updateAppearance: (updates) =>
        set((state) => ({ appearance: { ...state.appearance, ...updates } })),

      updateWorkflow: (updates) =>
        set((state) => ({ workflow: { ...state.workflow, ...updates } })),

      updateGitHub: (updates) =>
        set((state) => ({ github: { ...state.github, ...updates } })),

      resetTerminal: () => set({ terminal: { ...DEFAULT_TERMINAL_SETTINGS } }),
      resetAppearance: () => set({ appearance: { ...DEFAULT_APPEARANCE_SETTINGS } }),
      resetWorkflow: () => set({ workflow: { ...DEFAULT_WORKFLOW_SETTINGS } }),
      resetGitHub: () => set({ github: { ...DEFAULT_GITHUB_SETTINGS } }),
      resetAll: () => set({ ...initialState }),
    }),
    {
      name: 'tiki-settings',
    }
  )
);
