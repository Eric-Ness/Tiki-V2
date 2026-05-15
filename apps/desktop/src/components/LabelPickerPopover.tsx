import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Label {
  name: string;
  color: string;
}

interface LabelPickerPopoverProps {
  projectPath: string | null;
  onPick: (labelName: string) => void;
  onClose: () => void;
}

/**
 * Floating label picker for the bulk-action toolbar (#96). Fetches the
 * repo's labels via the existing `fetch_github_labels` Tauri command,
 * renders them as a filterable list. Picking a label fires `onPick` and
 * the parent toolbar handles the per-issue fan-out.
 */
export function LabelPickerPopover({
  projectPath,
  onPick,
  onClose,
}: LabelPickerPopoverProps) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const filtered = labels.filter((l) =>
    l.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div
      className="label-picker-popover"
      role="dialog"
      aria-label="Pick a label"
    >
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
            <li className="label-picker-empty">No labels match.</li>
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
