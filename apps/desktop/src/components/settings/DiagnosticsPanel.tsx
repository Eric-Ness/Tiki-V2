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
 *
 * Fix affordances share one invoke-then-reload pattern (`runFix`):
 * - #276 `normalize_archived_releases` — rewrite stale-"active" archived defs.
 * - #301 `archive_stale_release_defs` — move finished-status defs out of the
 *   active `releases/` location.
 * - #301 `archive_stale_plans` — archive active plans of finished issues (the
 *   doctor's `staleActivePlans` list, also rendered below the findings).
 */

/** Fix actions the panel can run, keyed by the finding's `action` value. */
const FIX_COMMANDS = {
  normalizeArchivedReleases: {
    command: "normalize_archived_releases",
    idle: "Normalize archived releases",
    busy: "Normalizing…",
    title: "Rewrite stale-active archived release defs to status:shipped",
  },
  archiveStaleReleaseDefs: {
    command: "archive_stale_release_defs",
    idle: "Archive finished release defs",
    busy: "Archiving…",
    title: "Move finished-status release defs from releases/ into releases/archive/",
  },
  archiveStalePlans: {
    command: "archive_stale_plans",
    idle: "Archive stale plans",
    busy: "Archiving…",
    title: "Move active plans of finished issues into plans/archive/",
  },
} as const;

type FixAction = keyof typeof FIX_COMMANDS;

export function DiagnosticsPanel() {
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const tikiPath = activeProject ? `${activeProject.path}/.tiki` : undefined;

  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<FixAction | null>(null);

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

  // One Fix button per action present in the findings (#276 normalize pattern,
  // generalized for the #301 archive fixers): invoke the matching command, then
  // re-run the diagnostics so the finding clears.
  const availableFixes = (Object.keys(FIX_COMMANDS) as FixAction[]).filter((action) =>
    summary?.findings.some((f) => f.action === action)
  );

  const runFix = useCallback(
    async (action: FixAction) => {
      if (!activeProject) return;
      setFixing(action);
      setError(null);
      try {
        await invoke<number>(FIX_COMMANDS[action].command, { tikiPath });
        await load();
      } catch (e) {
        setError(String(e));
      } finally {
        setFixing(null);
      }
    },
    [activeProject, tikiPath, load]
  );

  const busy = loading || fixing !== null;

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
          {availableFixes.map((action) => (
            <button
              key={action}
              className="settings-reset-btn"
              onClick={() => void runFix(action)}
              disabled={busy || !activeProject}
              title={FIX_COMMANDS[action].title}
            >
              {fixing === action ? FIX_COMMANDS[action].busy : FIX_COMMANDS[action].idle}
            </button>
          ))}
          <button
            className="settings-reset-btn"
            onClick={() => void load()}
            disabled={busy || !activeProject}
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
          {report.staleActivePlans.length > 0 && (
            <div className="diagnostics-stale-plans">
              <h4 className="settings-hint">Stale active plans</h4>
              <ul className="diagnostics-findings">
                {report.staleActivePlans.map((p) => (
                  <li
                    key={p.issue}
                    className="diagnostics-finding diagnostics-warn"
                  >
                    <span className="diagnostics-icon" aria-hidden="true">
                      ⚠️
                    </span>
                    <span title={p.planPath}>
                      #{p.issue} — {p.planPath}
                      {p.newestTimestamp ? ` (last touched ${p.newestTimestamp})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
