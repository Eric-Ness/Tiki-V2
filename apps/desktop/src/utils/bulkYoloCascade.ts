// Bulk-YOLO cascade advance/pause logic (#234), extracted from App.tsx's
// file-change handler into a pure, unit-testable function.
//
// When state.json transitions the run's current issue from activeWork into
// history, advance the queue and dispatch the next /tiki:yolo. If the current
// issue's status flips to 'failed', pause the run and toast. Reads/writes the
// Zustand stores via getState() so it is callable from any context (no React).

import { useProjectsStore, useBulkYoloStore, useToastStore } from "../stores";
import { dispatchNextBulkYolo } from "./bulkYoloDispatch";
import type { TikiState } from "./tikiStateSync";

export function advanceBulkYoloOnStateChange(prev: TikiState, currentState: TikiState): void {
  const projectId = useProjectsStore.getState().activeProjectId ?? 'default';
  const bulkRun = useBulkYoloStore.getState().runByProject[projectId] ?? null;
  if (!bulkRun || bulkRun.status !== 'running') return;

  const currentIssue = bulkRun.queue[bulkRun.currentIndex];
  if (currentIssue === undefined) return;

  const wasActive = `issue:${currentIssue}` in (prev.activeWork ?? {});
  const nowDone = (currentState.history?.recentIssues ?? []).some(
    (i) => i.number === currentIssue,
  );
  const nowFailed =
    currentState.activeWork?.[`issue:${currentIssue}`]?.status === 'failed';

  if (wasActive && nowDone) {
    // Issue shipped — advance the queue and dispatch the next.
    useBulkYoloStore.getState().advance();
    void dispatchNextBulkYolo(projectId);
  } else if (nowFailed) {
    useBulkYoloStore
      .getState()
      .recordFailure(`Issue #${currentIssue} pipeline failed`);
    useToastStore.getState().addToast(
      `Bulk YOLO paused: issue #${currentIssue} failed. Fix and resume from the dialog.`,
      'error',
    );
  }
}
