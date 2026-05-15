import { useMemo } from "react";
import type { EditorPhase, EditorPlan } from "./PlanEditor";
import "./PhaseSummaries.css";

interface PhaseSummariesProps {
  plan: EditorPlan | null;
}

interface SummaryRow {
  number: number;
  title: string;
  status: string;
  summary: string;
  completedAt: string | null;
}

/** Pure derivation: phases with non-empty summary, sorted by phase number ascending. */
export function deriveSummaryRows(plan: EditorPlan | null): SummaryRow[] {
  if (!plan) return [];
  return plan.phases
    .filter(
      (p): p is EditorPhase & { summary: string } =>
        typeof p.summary === "string" && p.summary.trim().length > 0,
    )
    .map((p) => ({
      number: p.number,
      title: p.title,
      status: p.status,
      summary: p.summary,
      completedAt: p.completedAt ?? null,
    }))
    .sort((a, b) => a.number - b.number);
}

export function PhaseSummaries({ plan }: PhaseSummariesProps) {
  const rows = useMemo(() => deriveSummaryRows(plan), [plan]);

  if (rows.length === 0) {
    return (
      <div className="phase-summaries phase-summaries--empty">
        <p>No phase summaries yet. They appear here as phases complete.</p>
      </div>
    );
  }

  return (
    <details className="phase-summaries" open>
      <summary className="phase-summaries__header">
        <span>Phase summaries</span>
        <span className="phase-summaries__count">
          {rows.length} of {plan?.phases.length ?? 0}
        </span>
      </summary>
      <ul className="phase-summaries__list">
        {rows.map((row) => (
          <li key={row.number} className="phase-summaries__item">
            <details>
              <summary className="phase-summaries__item-header">
                <span className="phase-summaries__item-number">
                  Phase {row.number}
                </span>
                <span className="phase-summaries__item-title">{row.title}</span>
                <span
                  className={`phase-summaries__item-status phase-summaries__item-status--${row.status}`}
                >
                  {row.status}
                </span>
              </summary>
              <p className="phase-summaries__item-body">{row.summary}</p>
              {row.completedAt && (
                <time
                  className="phase-summaries__item-time"
                  dateTime={row.completedAt}
                >
                  {new Date(row.completedAt).toLocaleString()}
                </time>
              )}
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}
