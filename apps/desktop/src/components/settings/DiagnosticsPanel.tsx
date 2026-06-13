import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectsStore } from "../../stores";
import {
  diagnosticsSummary,
  type DiagnosticsReport,
  type DiagnosticsSummary,
} from "../../utils/diagnosticsSummary";
import "./DiagnosticsPanel.css";

/**
 * Settings → Diagnostics panel. Calls the read-only `tiki_doctor` command and
 * renders the `.tiki/` health report with pass/warn/info indicators + a Refresh
 * button. Surfaces drift (e.g. the #259 stale-"active" class) at a glance.
 *
 * Mirrors the `WorkflowConfigSection` shape (tikiPath derivation, invoke + load
 * state machine). Refresh simply re-runs `load()`.
 */
export function DiagnosticsPanel() {
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const tikiPath = activeProject ? `${activeProject.path}/.tiki` : undefined;

  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [normalizing, setNormalizing] = useState(false);

  const load = useCallback(async () => {
    if (!activeProject) {
      setReport(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DiagnosticsReport>("tiki_doctor", { tikiPath });
      setReport(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeProject, tikiPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary: DiagnosticsSummary | null = report ? diagnosticsSummary(report) : null;

  // #276: a stale-"active" archived release def is cosmetic residue that the
  // doctor surfaces as an actionable finding. Offer a one-shot Fix that runs the
  // `normalize_archived_releases` command (rewrites them to status:"shipped") then
  // re-runs the diagnostics. Mirrors the Refresh button's invoke + load pattern.
  const canNormalize = Boolean(
    summary?.findings.some((f) => f.action === "normalizeArchivedReleases")
  );

  const normalizeArchivedReleases = useCallback(async () => {
    if (!activeProject) return;
    setNormalizing(true);
    setError(null);
    try {
      await invoke<number>("normalize_archived_releases", { tikiPath });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setNormalizing(false);
    }
  }, [activeProject, tikiPath, load]);

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>
          Diagnostics
          {summary?.status === "warnings" && (
            <span className="diagnostics-badge" title="Workspace has warnings">
              warnings
            </span>
          )}
        </h3>
        <div className="diagnostics-actions">
          {canNormalize && (
            <button
              className="settings-reset-btn"
              onClick={() => void normalizeArchivedReleases()}
              disabled={normalizing || loading || !activeProject}
              title="Rewrite stale-active archived release defs to status:shipped"
            >
              {normalizing ? "Normalizing…" : "Normalize archived releases"}
            </button>
          )}
          <button
            className="settings-reset-btn"
            onClick={() => void load()}
            disabled={loading || normalizing || !activeProject}
            title="Re-run tiki_doctor"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      <p className="settings-hint">
        Read-only health check of <code>.tiki/</code> — release drift, state
        validity, and reconciler-hook presence.
      </p>

      {!activeProject ? (
        <p className="settings-hint">Open a project to run diagnostics.</p>
      ) : loading ? (
        <p className="settings-hint">Running diagnostics…</p>
      ) : error ? (
        <p className="settings-hint diagnostics-error">
          Failed to run diagnostics: {error}
        </p>
      ) : report && summary ? (
        <>
          <div className="diagnostics-meta">
            <span>
              Framework: <code>{report.frameworkVersion ?? "—"}</code>
            </span>
            <span>
              Schema: <code>{report.schemaVersion ?? "—"}</code>
            </span>
            <span>
              Active work: <code>{report.activeWorkCount}</code>
            </span>
          </div>
          <ul className="diagnostics-findings">
            {summary.findings.map((f) => (
              <li
                key={`${f.level}:${f.message}`}
                className={`diagnostics-finding diagnostics-${f.level}`}
              >
                <span className="diagnostics-icon" aria-hidden="true">
                  {f.level === "warn" ? "⚠️" : f.level === "info" ? "ℹ️" : "✅"}
                </span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
          {report.unverifiedShippedCriteria.length > 0 && (
            <div className="diagnostics-pending-visual">
              <h4 className="settings-hint">Pending visual verification</h4>
              <ul className="diagnostics-findings">
                {report.unverifiedShippedCriteria.map((c) => (
                  <li
                    key={`${c.issue}:${c.id}`}
                    className="diagnostics-finding diagnostics-info"
                  >
                    <span className="diagnostics-icon" aria-hidden="true">
                      ℹ️
                    </span>
                    <span title={c.description}>
                      #{c.issue} {c.id} —{" "}
                      {c.description.length > 80
                        ? `${c.description.slice(0, 80)}…`
                        : c.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
