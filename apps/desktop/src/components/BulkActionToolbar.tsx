import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  useIssuesStore,
  useProjectsStore,
  useSelectionStore,
  useToastStore,
} from '../stores';
import { LabelPickerPopover } from './LabelPickerPopover';
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
  const [busy, setBusy] = useState<'close' | 'label' | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);

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
          onClick={() => setLabelOpen((v) => !v)}
        >
          {busy === 'label' ? 'Labeling...' : 'Add label'}
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
      </div>
    </div>
  );
}
