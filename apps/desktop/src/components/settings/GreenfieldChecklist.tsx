import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  useProjectsStore,
  useTerminalStore,
  useToastStore,
  useLayoutStore,
} from "../../stores";
import { terminalFocusRegistry } from "../../stores/terminalStore";
import {
  greenfieldReadiness,
  type GreenfieldReport,
  type GreenfieldRow,
} from "../../utils/greenfieldReadiness";
import "./GreenfieldChecklist.css";

/** Stable empty default — avoids an inline `?? []` (trips the #279 fresh-ref rule). */
const EMPTY_ROWS: GreenfieldRow[] = [];

/**
 * Write a command to the active terminal and focus it. Mirrors the module-private
 * `writeToActiveTerminal` in `useCommandActions.ts` (getState() reads, not hooks).
 * Returns the terminal id on success, or null when no terminal exists.
 */
async function writeToActiveTerminal(command: string): Promise<string | null> {
  const projectId = useProjectsStore.getState().activeProjectId ?? "default";
  const termState = useTerminalStore.getState();
  const tabs = termState.tabsByProject[projectId] ?? [];
  const activeTabId = termState.activeTabByProject[projectId] ?? null;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab) return null;

  try {
    await invoke("write_terminal", {
      id: activeTab.activeTerminalId,
      data: command,
    });
    terminalFocusRegistry.focus(activeTab.activeTerminalId);
    return activeTab.activeTerminalId;
  } catch {
    return null;
  }
}

/**
 * Settings → Greenfield setup checklist (#284). Calls the read-only
 * `check_greenfield_readiness` command, reduces the report into rows via the pure
 * `greenfieldReadiness` reducer, and renders ONE ROW PER check with an inline
 * per-row Fix button.
 *
 * Most fixes are one-shot Rust invokes (install framework, seed state, git init)
 * that re-run the check on success. The two interactive checks (gh auth, create
 * remote) are terminal handoffs: the command is written to the active terminal and
 * the user re-checks manually (interactive flow can't be auto-awaited).
 *
 * Clones DiagnosticsPanel's load state-machine (report/loading/error + a
 * useCallback load() + a useEffect on mount/active-project change). Per-row pending
 * state lives in component useState, never a store selector.
 */
export function GreenfieldChecklist() {
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const projectPath = activeProject?.path;

  const [report, setReport] = useState<GreenfieldReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-row pending guard — component-local, keyed by row id.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!projectPath) {
      setReport(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<GreenfieldReport>("check_greenfield_readiness", {
        projectPath,
      });
      setReport(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows: GreenfieldRow[] = report ? greenfieldReadiness(report) : EMPTY_ROWS;
  const allPass = rows.length > 0 && rows.every((r) => r.status === "pass");

  const runFix = useCallback(
    async (row: GreenfieldRow) => {
      if (!projectPath || !row.action) return;
      if (pending[row.id]) return;
      setPending((p) => ({ ...p, [row.id]: true }));
      try {
        // Interactive handoff: write the command, let the user run it, then
        // re-check manually. We can't auto-await an interactive terminal flow.
        if (row.handoff) {
          const command =
            row.action === "ghAuthLogin" ? "gh auth login\n" : "gh repo create\n";
          const terminalId = await writeToActiveTerminal(command);
          if (terminalId === null) {
            useToastStore
              .getState()
              .addToast("Open a terminal first", "warning", 6000);
          } else {
            // Surface the terminal so the user can complete the interactive flow.
            useLayoutStore.getState().setActiveView("terminal");
            useToastStore
              .getState()
              .addToast(
                "Run it in the terminal, then click Re-check",
                "info",
                6000
              );
          }
          return;
        }

        // Rust-invoke fixes: dispatch, toast, then re-check (SC2).
        switch (row.action) {
          case "installFramework":
            await invoke("install_framework", { projectPath });
            break;
          case "seedState":
          case "createGitignore":
            // init_tiki_project is idempotent and writes the .gitignore.
            await invoke("init_tiki_project", { projectPath });
            break;
          case "gitInit":
            await invoke("git_init", { projectPath });
            break;
        }
        useToastStore.getState().addToast(`${row.label} — fixed`, "success", 4000);
        await load();
      } catch (e) {
        useToastStore
          .getState()
          .addToast(`${row.label} — fix failed: ${e}`, "error", 8000);
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[row.id];
          return next;
        });
      }
    },
    [projectPath, pending, load]
  );

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>
          Greenfield Setup
          {allPass && (
            <span className="greenfield-badge" title="Project is ready">
              ready
            </span>
          )}
        </h3>
        <button
          className="settings-reset-btn"
          onClick={() => void load()}
          disabled={loading || !activeProject}
          title="Re-run greenfield readiness check"
        >
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>

      <p className="settings-hint">
        Readiness check for a fresh project — framework, state, git, GitHub remote &
        auth, and <code>.gitignore</code>. Each gap has an inline fix.
      </p>

      {!activeProject ? (
        <p className="settings-hint">Open a project to run the readiness check.</p>
      ) : loading ? (
        <p className="settings-hint">Checking readiness…</p>
      ) : error ? (
        <p className="settings-hint greenfield-error">
          Failed to run readiness check: {error}
        </p>
      ) : (
        <ul className="greenfield-rows">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`greenfield-row greenfield-${row.status}`}
            >
              <span className="greenfield-icon" aria-hidden="true">
                {row.status === "pass" ? "✅" : "⚠️"}
              </span>
              <span className="greenfield-label">{row.label}</span>
              {row.status === "fix" && row.action && (
                <button
                  className="settings-reset-btn greenfield-fix-btn"
                  onClick={() => void runFix(row)}
                  disabled={Boolean(pending[row.id])}
                  title={
                    row.handoff
                      ? "Hand off to the terminal"
                      : "Run the fix and re-check"
                  }
                >
                  {pending[row.id]
                    ? "Fixing…"
                    : row.handoff
                      ? "Open terminal"
                      : "Fix"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
