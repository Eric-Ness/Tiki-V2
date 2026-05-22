// Tiki state shape + sync helpers shared between App.tsx's loadState and the
// useTikiFileSync hook (#234). Previously these lived inline in App.tsx.

import { useTikiStateStore, useToastStore, type CompletedRelease } from "../stores";
import type { WorkContext } from "../components/work";

// Types matching the Rust state structures (state.json).
export interface TikiState {
  schemaVersion: number;
  activeWork: Record<string, WorkContext>;
  history?: {
    lastCompletedIssue?: { number: number; title?: string; completedAt: string };
    lastCompletedRelease?: { version: string; completedAt: string };
    recentIssues?: Array<{ number: number; title?: string; completedAt: string }>;
    recentReleases?: Array<{ version: string; issues?: number[]; completedAt: string; tag?: string }>;
  };
}

// Stable empty-fallback constants. Prevent fresh-object allocations in hook
// arguments that would otherwise trigger infinite re-render loops via useEffect
// dep instability (same bug class as #210 — see #212).
export const EMPTY_RECENT_ISSUES: Array<{ number: number; title?: string; completedAt: string }> = [];
const EMPTY_RECENT_RELEASES: CompletedRelease[] = [];

// Normalize raw history.recentReleases (where `issues` may be absent) into the
// store's CompletedRelease shape (`issues: number[]`). Returns the stable
// EMPTY_RECENT_RELEASES const when there is nothing, so consumers never see a
// fresh empty-array ref (same fresh-ref bug class as #210/#212).
export function normalizeRecentReleases(
  raw: Array<{ version: string; issues?: number[]; completedAt: string; tag?: string }> | undefined,
): CompletedRelease[] {
  if (!raw || raw.length === 0) return EMPTY_RECENT_RELEASES;
  return raw.map((r) => ({
    version: r.version,
    issues: r.issues ?? [],
    completedAt: r.completedAt,
    ...(r.tag !== undefined ? { tag: r.tag } : {}),
  }));
}

// Push parsed state.json into tikiStateStore (the single source for Kanban /
// sidebar / detail). Collapses the 3 identical inline blocks that previously
// lived in App.tsx (loadState x2 + the file-change handler).
export function syncTikiStateStore(currentState: TikiState | null): void {
  if (currentState?.activeWork) {
    useTikiStateStore.getState().setActiveWork(currentState.activeWork);
  }
  useTikiStateStore.getState().setRecentIssues(currentState?.history?.recentIssues ?? EMPTY_RECENT_ISSUES);
  useTikiStateStore.getState().setRecentReleases(normalizeRecentReleases(currentState?.history?.recentReleases));
}

// Compare the previous and next state and emit toasts for the user-visible
// transitions (status changes, phase completion, audit pass, ship).
export function detectStateChanges(
  oldState: TikiState | null,
  newState: TikiState | null,
): void {
  if (!oldState || !newState) return;
  const addToast = useToastStore.getState().addToast;
  const oldWork = oldState.activeWork;
  const newWork = newState.activeWork;

  for (const [workId, newItem] of Object.entries(newWork)) {
    const oldItem = oldWork[workId];
    if (!oldItem) continue;

    // Detect status changes
    if (oldItem.status !== newItem.status) {
      if (newItem.status === 'completed' && newItem.type === 'issue') {
        addToast(`Issue #${newItem.issue.number} completed`, 'success', 5000);
      } else if (newItem.status === 'failed' && newItem.type === 'issue') {
        addToast(`Issue #${newItem.issue.number} failed`, 'error', 8000);
      } else if (newItem.status === 'shipping' && newItem.type === 'issue') {
        addToast(`Shipping issue #${newItem.issue.number}...`, 'info', 3000);
      }
    }

    // Detect phase completion for issues
    if (newItem.type === 'issue' && oldItem.type === 'issue') {
      const oldPhase = oldItem.phase;
      const newPhase = newItem.phase;
      if (oldPhase && newPhase && oldPhase.current !== newPhase.current && newPhase.current > oldPhase.current) {
        addToast(`Phase ${newPhase.current}/${newPhase.total} completed`, 'success', 4000);
      }
    }

    // Detect pipeline step transitions
    if (oldItem.pipelineStep !== newItem.pipelineStep) {
      if (oldItem.pipelineStep === 'AUDIT' && newItem.pipelineStep === 'EXECUTE') {
        addToast('Audit passed', 'success', 3000);
      }
    }
  }

  // Detect work removed from activeWork (completed and moved to history)
  for (const [workId, oldItem] of Object.entries(oldWork)) {
    if (!newWork[workId] && oldItem.type === 'issue') {
      addToast(`Issue #${oldItem.issue.number} shipped`, 'success', 5000);
    }
  }
}
