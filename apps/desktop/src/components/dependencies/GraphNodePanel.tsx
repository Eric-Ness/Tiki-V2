import { useMemo } from 'react';
import { deriveCriteriaChecklist } from '../../utils/criteriaVerification';
import { CriteriaChecklistView } from '../detail/SuccessCriteriaChecklist';
import './GraphNodePanel.css';

/** Plan subset the panel needs — matches the `planByIssue` entries returned by
 *  useDependencyGraph (#257 Phase 1). Any field may be absent. */
interface GraphNodePanelPlan {
  successCriteria?: { id: string; description: string; category?: string }[];
  coverageMatrix?: Record<string, number[]>;
  phases?: { number: number; status: string }[];
}

interface GraphNodePanelProps {
  issueNumber: number;
  title: string;
  plan?: GraphNodePanelPlan;
  onClose: () => void;
}

/**
 * Click-to-open side panel for a dependency-graph node. Renders the issue's
 * success-criteria checklist, derived live from phase completion via the shared
 * `deriveCriteriaChecklist` helper and the presentational `CriteriaChecklistView`
 * (extracted in Phase 2). Data arrives entirely through props — no Zustand
 * selectors — so the panel sidesteps the React 19 fresh-ref render-loop class;
 * liveness comes from the parent re-rendering with a fresh `plan` prop when the
 * #256 planNonce path patches the graph's plan data.
 */
export function GraphNodePanel({ issueNumber, title, plan, onClose }: GraphNodePanelProps) {
  const rows = useMemo(
    () =>
      deriveCriteriaChecklist(
        plan
          ? {
              successCriteria: (plan.successCriteria ?? []).map((c) => ({
                id: c.id,
                description: c.description,
              })),
              phases: (plan.phases ?? []).map((p) => ({
                number: p.number,
                status: p.status,
              })),
              coverageMatrix: plan.coverageMatrix ?? {},
            }
          : null,
      ),
    [plan],
  );

  const truncatedTitle = title.length > 48 ? `${title.slice(0, 46)}…` : title;

  return (
    <aside
      className="graph-node-panel"
      aria-label={`Issue #${issueNumber} success criteria`}
    >
      <div className="graph-node-panel__header">
        <span className="graph-node-panel__issue">#{issueNumber}</span>
        <span className="graph-node-panel__title" title={title}>
          {truncatedTitle}
        </span>
        <button
          type="button"
          className="graph-node-panel__close"
          aria-label="Close panel"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="graph-node-panel__body">
        {rows.length > 0 ? (
          <CriteriaChecklistView rows={rows} />
        ) : (
          <p className="graph-node-panel__empty">
            No success criteria for this issue.
          </p>
        )}
      </div>
    </aside>
  );
}
