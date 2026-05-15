import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useProjectsStore } from './projectsStore';

export type BulkYoloStatus = 'idle' | 'running' | 'paused' | 'failed';

export interface BulkYoloFailure {
  issueNumber: number;
  /** Free-form reason — e.g., 'phase 3 verification failed', 'pipeline never reached SHIP'. */
  reason: string;
  at: string; // ISO
}

export interface BulkYoloRun {
  /** Snapshot of issue numbers at queue-start time (immutable for the run). */
  queue: number[];
  /** Index into queue of the issue currently executing (or paused at). */
  currentIndex: number;
  /** Issue numbers that have shipped successfully. */
  completed: number[];
  /** Issues that hit a hard failure during the cascade. */
  failures: BulkYoloFailure[];
  status: BulkYoloStatus;
  /** Terminal id the cascade is dispatching to. Set on first start. */
  terminalId: string | null;
  startedAt: string;
  lastActivityAt: string;
}

interface BulkYoloState {
  /** Per-project active run. Only one bulk-yolo cascade per project at a time. */
  runByProject: Record<string, BulkYoloRun | null>;
}

interface BulkYoloActions {
  /** Initialize a new run from the current selection. Resets any prior run for the project. */
  startRun: (issueNumbers: number[], terminalId: string) => void;
  /** Mark current issue completed and advance currentIndex by 1. */
  advance: () => void;
  /** Record a hard failure on the current issue. Sets status='failed'. */
  recordFailure: (reason: string) => void;
  /** Pause the cascade — keeps state intact. */
  pause: () => void;
  /** Resume from paused (status -> running). */
  resume: () => void;
  /** Abort: clear the active run for the project. */
  abort: () => void;
  /** Selectors. */
  current: () => number | null;
  remaining: () => number[];
  isActive: () => boolean;
}

const getProjectId = (): string =>
  useProjectsStore.getState().activeProjectId ?? 'default';
const now = () => new Date().toISOString();

export const useBulkYoloStore = create<BulkYoloState & BulkYoloActions>()(
  persist(
    (set, get) => ({
      runByProject: {},

      startRun: (issueNumbers, terminalId) => {
        if (issueNumbers.length === 0) return;
        const pid = getProjectId();
        const t = now();
        set((state) => ({
          runByProject: {
            ...state.runByProject,
            [pid]: {
              queue: [...issueNumbers],
              currentIndex: 0,
              completed: [],
              failures: [],
              status: 'running',
              terminalId,
              startedAt: t,
              lastActivityAt: t,
            },
          },
        }));
      },

      advance: () =>
        set((state) => {
          const pid = getProjectId();
          const run = state.runByProject[pid];
          if (!run || run.status !== 'running') return state;
          const completedIssue = run.queue[run.currentIndex];
          const nextCompleted =
            completedIssue !== undefined
              ? [...run.completed, completedIssue]
              : run.completed;
          const nextIndex = run.currentIndex + 1;
          const isDone = nextIndex >= run.queue.length;
          return {
            runByProject: {
              ...state.runByProject,
              [pid]: {
                ...run,
                currentIndex: nextIndex,
                completed: nextCompleted,
                status: isDone ? 'idle' : 'running',
                lastActivityAt: now(),
              },
            },
          };
        }),

      recordFailure: (reason) =>
        set((state) => {
          const pid = getProjectId();
          const run = state.runByProject[pid];
          if (!run) return state;
          const issueNumber = run.queue[run.currentIndex];
          if (issueNumber === undefined) return state;
          return {
            runByProject: {
              ...state.runByProject,
              [pid]: {
                ...run,
                failures: [
                  ...run.failures,
                  { issueNumber, reason, at: now() },
                ],
                status: 'failed',
                lastActivityAt: now(),
              },
            },
          };
        }),

      pause: () =>
        set((state) => {
          const pid = getProjectId();
          const run = state.runByProject[pid];
          if (!run || run.status !== 'running') return state;
          return {
            runByProject: {
              ...state.runByProject,
              [pid]: { ...run, status: 'paused', lastActivityAt: now() },
            },
          };
        }),

      resume: () =>
        set((state) => {
          const pid = getProjectId();
          const run = state.runByProject[pid];
          if (!run || (run.status !== 'paused' && run.status !== 'failed'))
            return state;
          return {
            runByProject: {
              ...state.runByProject,
              [pid]: { ...run, status: 'running', lastActivityAt: now() },
            },
          };
        }),

      abort: () =>
        set((state) => {
          const pid = getProjectId();
          return {
            runByProject: { ...state.runByProject, [pid]: null },
          };
        }),

      current: () => {
        const pid = getProjectId();
        const run = get().runByProject[pid];
        if (!run || run.currentIndex >= run.queue.length) return null;
        return run.queue[run.currentIndex];
      },

      remaining: () => {
        const pid = getProjectId();
        const run = get().runByProject[pid];
        if (!run) return [];
        return run.queue.slice(run.currentIndex);
      },

      isActive: () => {
        const pid = getProjectId();
        const run = get().runByProject[pid];
        return (
          !!run &&
          (run.status === 'running' ||
            run.status === 'paused' ||
            run.status === 'failed')
        );
      },
    }),
    {
      name: 'tiki-bulk-yolo',
      version: 1,
      partialize: (state) => ({ runByProject: state.runByProject }),
    },
  ),
);
