import "./DetailEmptyState.css";

const PIPELINE_STEPS = ["GET", "REVIEW", "PLAN", "AUDIT", "EXECUTE", "SHIP"] as const;

/**
 * Shown in the detail panel when nothing is selected. Orients new users with
 * the Tiki pipeline and the command-palette shortcut instead of a bare
 * "Select an issue" line (#176 / E11).
 */
export function DetailEmptyState() {
  return (
    <div className="detail-empty">
      <div className="detail-empty-pipeline" aria-hidden="true">
        {PIPELINE_STEPS.map((step, i) => (
          <div key={step} className="detail-empty-step-wrap">
            <span className="detail-empty-step">{step}</span>
            {i < PIPELINE_STEPS.length - 1 && (
              <span className="detail-empty-arrow">→</span>
            )}
          </div>
        ))}
      </div>
      <h3 className="detail-empty-title">Nothing selected</h3>
      <p className="detail-empty-text">
        Select an issue or release from the sidebar to view its details and
        pipeline progress.
      </p>
      <p className="detail-empty-hint">
        Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to open the command palette.
      </p>
    </div>
  );
}
