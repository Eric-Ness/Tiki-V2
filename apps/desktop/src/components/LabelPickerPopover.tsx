import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Label {
  name: string;
  color: string;
}

/** Shape compatible with `fetch_github_issue_by_number` payloads. */
interface IssueWithLabels {
  labels: { name: string; color: string }[];
}

/**
 * Pure helper: union the labels across a set of issues, deduplicating by
 * label name (first-seen color wins). Exported for unit testing — see
 * `__tests__/labelPickerUnion.test.ts`.
 */
export function unionLabels(issues: IssueWithLabels[]): Label[] {
  const union = new Map<string, Label>();
  issues.forEach((i) =>
    i.labels.forEach((l) => {
      if (!union.has(l.name)) union.set(l.name, l);
    })
  );
  return [...union.values()];
}

interface LabelPickerPopoverProps {
  projectPath: string | null;
  /** 'add' (default) shows all repo labels; 'remove' shows the union of labels on the selected issues. */
  mode?: 'add' | 'remove';
  /** Required when mode='remove' to compute the union. */
  selectedIssueNumbers?: number[];
  onPick: (labelName: string) => void;
  onClose: () => void;
}

/**
 * Floating label picker for the bulk-action toolbar (#96, #203). Fetches
 * the repo's labels via the existing `fetch_github_labels` Tauri command
 * and renders them as a filterable list.
 *
 * In `mode='remove'`, instead fetches each selected issue and shows only
 * the union of labels currently applied — this gives the user a
 * meaningful "removable" set rather than every repo label.
 *
 * Picking a label fires `onPick` and the parent toolbar handles the
 * per-issue fan-out.
 */
export function LabelPickerPopover({
  projectPath,
  mode = 'add',
  selectedIssueNumbers,
  onPick,
  onClose,
}: LabelPickerPopoverProps) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  // Stable string key so the effect doesn't refire on every render — array
  // identity changes even when contents don't (parent uses a memo or not).
  const selectedKey = selectedIssueNumbers?.join(',') ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    if (mode === 'remove' && selectedIssueNumbers && selectedIssueNumbers.length > 0) {
      Promise.all(
        selectedIssueNumbers.map((n) =>
          invoke<IssueWithLabels>('fetch_github_issue_by_number', {
            number: n,
            projectPath,
          }).catch(() => ({ labels: [] as { name: string; color: string }[] }))
        )
      )
        .then((issues) => {
          if (cancelled) return;
          setLabels(unionLabels(issues));
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setLabels([]);
          setLoading(false);
        });
    } else {
      invoke<Label[]>('fetch_github_labels', { projectPath })
        .then((data) => {
          if (cancelled) return;
          setLabels(data);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setLabels([]);
          setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
    // selectedKey is the stable representation of selectedIssueNumbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, mode, selectedKey]);

  const filtered = labels.filter((l) =>
    l.name.toLowerCase().includes(filter.toLowerCase())
  );

  const isRemoveMode = mode === 'remove';

  return (
    <div
      className="label-picker-popover"
      role="dialog"
      aria-label={isRemoveMode ? 'Pick a label to remove' : 'Pick a label'}
    >
      {isRemoveMode && (
        <div className="label-picker-caption">
          Labels applied to selection (union)
        </div>
      )}
      <input
        type="text"
        autoFocus
        placeholder="Filter labels..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="label-picker-filter"
      />
      {loading ? (
        <div className="label-picker-loading">Loading...</div>
      ) : (
        <ul className="label-picker-list">
          {filtered.length === 0 ? (
            <li className="label-picker-empty">
              {isRemoveMode && labels.length === 0
                ? 'No labels currently applied to selection.'
                : 'No labels match.'}
            </li>
          ) : (
            filtered.map((l) => (
              <li key={l.name}>
                <button
                  type="button"
                  className="label-picker-item"
                  onClick={() => onPick(l.name)}
                >
                  <span
                    className="label-picker-color"
                    style={{ background: `#${l.color}` }}
                  />
                  {l.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      <button
        type="button"
        className="label-picker-close"
        onClick={onClose}
      >
        Cancel
      </button>
    </div>
  );
}
