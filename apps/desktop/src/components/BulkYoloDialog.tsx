import {
  useBulkYoloStore,
  useProjectsStore,
  useIssuesStore,
  useTerminalStore,
  EMPTY_TABS,
} from '../stores';
import './BulkYoloDialog.css';

/**
 * Floating bottom-right card showing bulk YOLO cascade progress (#206).
 * Self-hides when no run is active for the active project. NOT a blocking
 * modal — the user keeps using the rest of the app while the cascade runs.
 */
export function BulkYoloDialog() {
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const run = useBulkYoloStore((s) => s.runByProject[projectId]);
  const pause = useBulkYoloStore((s) => s.pause);
  const resume = useBulkYoloStore((s) => s.resume);
  const abort = useBulkYoloStore((s) => s.abort);
  const issues = useIssuesStore((s) => s.issues);
  const tabs = useTerminalStore((s) => s.tabsByProject[projectId] ?? EMPTY_TABS);

  // Hide when no run, or when the run has wound down to idle (queue exhausted
  // and no failures to surface). recordFailure / pause keep the dialog up.
  if (!run) return null;
  if (run.status === 'idle' && run.failures.length === 0) return null;

  const titleFor = (n: number) =>
    issues.find((i) => i.number === n)?.title ?? `#${n}`;
  const tab = run.terminalId
    ? tabs.find((t) => t.activeTerminalId === run.terminalId)
    : null;

  const total = run.queue.length;
  const doneCount = run.completed.length;

  return (
    <div className="bulk-yolo-dialog" role="dialog" aria-label="Bulk YOLO progress">
      <div className="bulk-yolo-dialog__panel">
        <header className="bulk-yolo-dialog__header">
          <h3>Bulk YOLO</h3>
          <span
            className={`bulk-yolo-dialog__status bulk-yolo-dialog__status--${run.status}`}
          >
            {run.status}
          </span>
          <span className="bulk-yolo-dialog__progress">
            {doneCount} / {total} complete
          </span>
        </header>

        <ul className="bulk-yolo-dialog__queue">
          {run.queue.map((n, idx) => {
            const isCurrent = idx === run.currentIndex && run.status !== 'idle';
            const isDone = idx < run.currentIndex;
            const failed = run.failures.find((f) => f.issueNumber === n);
            const icon = failed ? '✗' : isDone ? '✓' : isCurrent ? '▶' : '○';
            return (
              <li
                key={n}
                className={`bulk-yolo-dialog__item bulk-yolo-dialog__item--${
                  isCurrent ? 'current' : isDone ? 'done' : 'pending'
                }`}
              >
                <span className="bulk-yolo-dialog__icon">{icon}</span>
                <span className="bulk-yolo-dialog__num">#{n}</span>
                <span className="bulk-yolo-dialog__title">{titleFor(n)}</span>
              </li>
            );
          })}
        </ul>

        {run.failures.length > 0 && (
          <details className="bulk-yolo-dialog__failures" open>
            <summary>
              {run.failures.length} failure
              {run.failures.length === 1 ? '' : 's'}
            </summary>
            <ul>
              {run.failures.map((f, i) => (
                <li key={i}>
                  #{f.issueNumber}: {f.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        <footer className="bulk-yolo-dialog__footer">
          <span className="bulk-yolo-dialog__terminal">
            Dispatching to: {tab ? tab.title : '(terminal closed)'}
          </span>
          <div className="bulk-yolo-dialog__actions">
            {run.status === 'running' && (
              <button type="button" onClick={pause}>
                Pause
              </button>
            )}
            {(run.status === 'paused' || run.status === 'failed') && (
              <button type="button" onClick={resume}>
                Resume
              </button>
            )}
            <button
              type="button"
              className="bulk-yolo-dialog__abort"
              onClick={() => {
                if (
                  confirm(
                    'Abort the bulk YOLO cascade? Completed issues stay shipped; queued issues are dropped.',
                  )
                )
                  abort();
              }}
            >
              Abort
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
