import { useMemo } from "react";
import type { EditorPlan } from "./PlanEditor";
import {
  deriveCriteriaChecklist,
  type CriterionVerification,
} from "../../utils/criteriaVerification";
import "./SuccessCriteriaChecklist.css";

interface SuccessCriteriaChecklistProps {
  plan: EditorPlan | null;
}

/**
 * Live success-criteria checklist. Each row ticks off as the phases that cover
 * the criterion complete. The checked state is derived from phase completion
 * (not the persisted `verified` flag) so it stays correct even before EXECUTE
 * writes verification back to the plan file. Re-renders on the existing plan
 * watcher refresh — the parent re-reads the plan and passes a new `plan` prop.
 */
export function SuccessCriteriaChecklist({ plan }: SuccessCriteriaChecklistProps) {
  const rows = useMemo<CriterionVerification[]>(
    () =>
      deriveCriteriaChecklist(
        plan
          ? {
              successCriteria: plan.successCriteria.map((sc) => ({
                id: sc.id,
                description: sc.description,
              })),
              phases: plan.phases.map((p) => ({
                number: p.number,
                status: p.status,
              })),
              coverageMatrix: plan.coverageMatrix,
            }
          : null,
      ),
    [plan],
  );

  return <CriteriaChecklistView rows={rows} />;
}

/**
 * Presentational success-criteria checklist. Renders already-derived rows so
 * callers that cannot cheaply build a full {@link EditorPlan} (e.g. the
 * dependency-graph panel) can render the identical markup straight from
 * `deriveCriteriaChecklist` output.
 */
export function CriteriaChecklistView({
  rows,
}: {
  rows: CriterionVerification[];
}) {
  if (rows.length === 0) {
    return null;
  }

  const verifiedCount = rows.filter((r) => r.verified).length;

  return (
    <details className="criteria-checklist" open>
      <summary className="criteria-checklist__header">
        <span>Success criteria</span>
        <span className="criteria-checklist__count">
          {verifiedCount}/{rows.length} verified
        </span>
      </summary>
      <ul className="criteria-checklist__list">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`criteria-checklist__item ${
              row.verified
                ? "criteria-checklist__item--verified"
                : "criteria-checklist__item--pending"
            }`}
          >
            <span
              className="criteria-checklist__check"
              aria-hidden="true"
              role="presentation"
            >
              {row.verified ? "☑" : "☐"}
            </span>
            <span className="criteria-checklist__id">{row.id}</span>
            <span className="criteria-checklist__desc">{row.description}</span>
            {row.coveringPhases.length > 0 && (
              <span
                className="criteria-checklist__phases"
                title={`Covered by phase${
                  row.coveringPhases.length > 1 ? "s" : ""
                } ${row.coveringPhases.join(", ")}`}
              >
                {row.coveringPhases.length > 1 ? "Phases" : "Phase"}{" "}
                {row.coveringPhases.join(", ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
