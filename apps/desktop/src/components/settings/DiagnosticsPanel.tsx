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
        <button
          className="settings-reset-btn"
          onClick={() => void load()}
          disabled={loading || !activeProject}
          title="Re-run tiki_doctor"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
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
        </>
      ) : null}
    </div>
  );
}
