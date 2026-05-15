import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  useBulkYoloStore,
  useIssuesStore,
  useProjectsStore,
  useReleaseDialogStore,
  useSelectionStore,
  useTerminalStore,
  useToastStore,
} from '../stores';
import { LabelPickerPopover } from './LabelPickerPopover';
import { buildPrePopulatedRelease } from './bulkAssignHelpers';
import { dispatchNextBulkYolo } from '../utils/bulkYoloDispatch';
import './BulkActionToolbar.css';

/**
 * Bulk-action toolbar for batch operations on issues (#96). Mounted at the
 * App root so it surfaces in any view (Kanban / Issues / Releases / etc.)
 * the moment selection.count > 0. Self-hides when selection is empty.
 *
 * v0.6.2 actions: bulk Close + bulk Add Label. Both fan out the existing
 * single-issue Tauri commands via Promise.all and report per-issue
 * failures via the toast store.
 */
export function BulkActionToolbar() {
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const projectPath =
    useProjectsStore(
      (s) => s.projects.find((p) => p.id === projectId)?.path
    ) ?? null;
  const selectedSet = useSelectionStore(
    (s) => s.selectedByProject[projectId]
  );
  const selected = useMemo(
    () => (selectedSet ? [...selectedSet].sort((a, b) => a - b) : []),
    [selectedSet]
  );
  const clear = useSelectionStore((s) => s.clear);
  const triggerIssuesRefetch = useIssuesStore((s) => s.triggerRefetch);
  const addToast = useToastStore((s) => s.addToast);
  const allIssues = useIssuesStore((s) => s.issues);
  const openReleaseDialog = useReleaseDialogStore((s) => s.openDialog);
  const startBulkYolo = useBulkYoloStore((s) => s.startRun);
  const bulkYoloActive = useBulkYoloStore((s) =>
    Boolean(
      s.runByProject[projectId] &&
        s.runByProject[projectId]!.status !== 'idle',
    ),
  );
  const [busy, setBusy] = useState<'close' | 'label' | 'remove-label' | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const [removeLabelOpen, setRemoveLabelOpen] = useState(false);

  if (selected.length === 0) return null;

  const plural = (n: number) => (n === 1 ? '' : 's');

  const bulkClose = async () => {
    if (busy) return;
    setBusy('close');
    const failures: number[] = [];
    await Promise.all(
      selected.map((n) =>
        invoke('close_github_issue', { number: n, projectPath }).catch(() => {
          failures.push(n);
        })
      )
    );
    setBusy(null);
    clear();
    triggerIssuesRefetch();
    if (failures.length === 0) {
      addToast(
        `Closed ${selected.length} issue${plural(selected.length)}.`,
        'success'
      );
    } else {
      addToast(
        `Closed ${selected.length - failures.length} of ${selected.length}; failed: #${failures.join(', #')}`,
        'error'
      );
    }
  };

  const bulkAddLabel = async (labelName: string) => {
    if (busy) return;
    setBusy('label');
    setLabelOpen(false);
    const failures: number[] = [];
    await Promise.all(
      selected.map((n) =>
        invoke('edit_github_issue', {
          number: n,
          addLabels: [labelName],
          removeLabels: [],
          projectPath,
        }).catch(() => {
          failures.push(n);
        })
      )
    );
    setBusy(null);
    triggerIssuesRefetch();
    if (failures.length === 0) {
      addToast(
        `Added "${labelName}" to ${selected.length} issue${plural(selected.length)}.`,
        'success'
      );
    } else {
      addToast(
        `Labeled ${selected.length - failures.length} of ${selected.length}; failed: #${failures.join(', #')}`,
        'error'
      );
    }
  };

  const bulkAssignToRelease = () => {
    if (busy) return;
    const { initialIssues } = buildPrePopulatedRelease(selected, allIssues);
    // Open the dialog in create mode (no editingRelease) with the
    // selection pre-populated. We deliberately don't clear the
    // selection — the user might cancel the dialog.
    openReleaseDialog(undefined, { initialIssues });
  };

  const bulkRemoveLabel = async (labelName: string) => {
    if (busy) return;
    setBusy('remove-label');
    setRemoveLabelOpen(false);
    const failures: number[] = [];
    await Promise.all(
      selected.map((n) =>
        invoke('edit_github_issue', {
          number: n,
          addLabels: [],
          removeLabels: [labelName],
          projectPath,
        }).catch(() => {
          failures.push(n);
        })
      )
    );
    setBusy(null);
    triggerIssuesRefetch();
    if (failures.length === 0) {
      addToast(
        `Removed "${labelName}" from ${selected.length} issue${plural(selected.length)}.`,
        'success'
      );
    } else {
      addToast(
        `Removed from ${selected.length - failures.length} of ${selected.length}; failed: #${failures.join(', #')}`,
        'error'
      );
    }
  };

  const onRunYolo = () => {
    if (busy || bulkYoloActive) return;
    // Active-terminal-required path: avoids the addTabInBackground race
    // where the Rust PTY isn't ready when we'd dispatch /tiki:yolo. The
    // user needs an open terminal to see the cascade output anyway.
    const termState = useTerminalStore.getState();
    const tabs = termState.tabsByProject[projectId] ?? [];
    const activeTabId = termState.activeTabByProject[projectId] ?? null;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const terminalId = activeTab?.activeTerminalId;
    if (!terminalId) {
      addToast(
        'Open a terminal first, then click Run YOLO. The cascade dispatches into the active terminal.',
        'error',
      );
      return;
    }
    startBulkYolo(selected, terminalId);
    void dispatchNextBulkYolo(projectId);
    clear();
  };

  return (
    <div
      className="bulk-action-toolbar"
      role="toolbar"
      aria-label="Bulk issue actions"
    >
      <span className="bulk-action-count">
        {selected.length} selected
      </span>
      <div className="bulk-action-buttons">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setRemoveLabelOpen(false);
            setLabelOpen((v) => !v);
          }}
        >
          {busy === 'label' ? 'Labeling...' : 'Add label'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setLabelOpen(false);
            setRemoveLabelOpen((v) => !v);
          }}
        >
          {busy === 'remove-label' ? 'Removing...' : 'Remove label'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={bulkAssignToRelease}
        >
          Add to release
        </button>
        <button
          type="button"
          disabled={busy !== null || bulkYoloActive}
          onClick={onRunYolo}
        >
          {bulkYoloActive ? 'YOLO running' : 'Run YOLO'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={bulkClose}
          className="bulk-action-danger"
        >
          {busy === 'close' ? 'Closing...' : `Close (${selected.length})`}
        </button>
        <button type="button" onClick={clear} disabled={busy !== null}>
          Clear
        </button>
        {labelOpen && (
          <LabelPickerPopover
            projectPath={projectPath}
            onPick={bulkAddLabel}
            onClose={() => setLabelOpen(false)}
          />
        )}
        {removeLabelOpen && (
          <LabelPickerPopover
            projectPath={projectPath}
            mode="remove"
            selectedIssueNumbers={selected}
            onPick={bulkRemoveLabel}
            onClose={() => setRemoveLabelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
