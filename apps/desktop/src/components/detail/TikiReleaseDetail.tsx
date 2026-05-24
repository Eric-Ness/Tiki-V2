import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TikiRelease } from "../../stores/tikiReleasesStore";
import { useTerminalStore, useProjectsStore, useReleaseDialogStore, useTikiReleasesStore, useDetailStore, EMPTY_TABS } from "../../stores";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { isReleaseCompleted } from "../../utils/releaseDisplayStatus";
import "./DetailPanel.css";

interface TikiReleaseDetailProps {
  release: TikiRelease;
}

const statusBadgeStyles: Record<string, string> = {
  active: "release-status-active",
  completed: "release-status-completed",
  shipped: "release-status-completed",
  not_planned: "release-status-draft",
};

const statusLabels: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  shipped: "Completed",
  not_planned: "Not Planned",
};

/** Format an ISO timestamp for display, or null if it isn't a valid date. */
function formatDate(iso?: string): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(iso).toLocaleString();
}

/** Human-readable elapsed time between two ISO timestamps (e.g. "2d 3h"). */
function formatDuration(startIso?: string, endIso?: string): string | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const mins = Math.round((end - start) / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function TikiReleaseDetail({ release }: TikiReleaseDetailProps) {
  const projectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';
  const tabs = useTerminalStore((s) => s.tabsByProject[projectId] ?? EMPTY_TABS);
  const activeTabId = useTerminalStore((s) => s.activeTabByProject[projectId] ?? null);
  const openDialog = useReleaseDialogStore((state) => state.openDialog);
  const deleteRelease = useTikiReleasesStore((state) => state.deleteRelease);
  const clearSelection = useDetailStore((state) => state.clearSelection);

  const activeProject = useProjectsStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId)
  );
  const projectPath = activeProject?.path;

  // A release is "completed" once it has shipped (archived) — the archive flag is
  // the reliable signal because the ship teardown leaves the JSON status stale.
  // Shared with the sidebar via isReleaseCompleted so the two never drift.
  const isCompleted = isReleaseCompleted(release);

  // Header badge: surface "Completed" even when an archived record's status field
  // still says "active" (so it matches the sidebar).
  const badgeClass = statusBadgeStyles[isCompleted ? "completed" : release.status] || statusBadgeStyles.active;
  const badgeLabel = isCompleted ? "Completed" : (statusLabels[release.status] || release.status);

  // Retrospective data, fetched only for completed releases (immutable history).
  const [changelog, setChangelog] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isCompleted) {
      setChangelog(null);
      setGithubUrl(null);
      return;
    }
    let cancelled = false;
    const tikiPath = projectPath ? `${projectPath}/.tiki` : undefined;

    invoke<string | null>("read_release_changelog", { version: release.version, tikiPath })
      .then((body) => { if (!cancelled) setChangelog(body ?? null); })
      .catch((err) => { console.error("Failed to read release changelog:", err); });

    invoke<string | null>("fetch_github_release_url", { version: release.version, projectPath: projectPath ?? null })
      .then((url) => { if (!cancelled) setGithubUrl(url ?? null); })
      .catch((err) => { console.error("Failed to fetch release url:", err); });

    return () => { cancelled = true; };
  }, [isCompleted, release.version, projectPath]);

  const getActiveTerminalId = (): string | null => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    return activeTab?.activeTerminalId || null;
  };

  const executeInTerminal = async (command: string) => {
    const terminalId = getActiveTerminalId();
    if (!terminalId) {
      console.error("No active terminal found");
      return;
    }
    try {
      await invoke("write_terminal", { id: terminalId, data: command + "\n" });
    } catch (error) {
      console.error("Failed to write to terminal:", error);
    }
  };

  const handleRunRelease = () => {
    executeInTerminal(`/tiki:release ${release.version}`);
  };

  const handleReviewRelease = () => {
    executeInTerminal(`/tiki:release ${release.version} --dry-run`);
  };

  const handleEdit = () => {
    openDialog(release);
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(`Delete release ${release.version}? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const tikiPath = activeProject ? `${activeProject.path}/.tiki` : undefined;
      await invoke("delete_tiki_release", { version: release.version, tikiPath });
      deleteRelease(release.version);
      clearSelection();
    } catch (error) {
      console.error("Failed to delete release:", error);
    }
  };

  const createdLabel = formatDate(release.createdAt);
  const completedLabel = formatDate(release.updatedAt);
  const durationLabel = formatDuration(release.createdAt, release.updatedAt);

  return (
    <div className="detail-view">
      <div className="detail-header">
        <div className="detail-header-row">
          <svg
            className="detail-release-icon"
            width="20"
            height="20"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M2 4L8 1L14 4V12L8 15L2 12V4Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path d="M8 7V15" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2 4L8 7L14 4" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span className={`detail-state-badge ${badgeClass}`}>
            {badgeLabel}
          </span>
        </div>
        <h2 className="detail-title">{release.name || release.version}</h2>
        <span className="detail-tag">{release.version}</span>
      </div>

      {/* Active releases keep their workflow actions; completed releases hide
          them — Edit/Run/Review are no-ops on shipped history and Delete is
          destructive (#255 SC4). Completed releases get a GitHub link instead. */}
      {!isCompleted ? (
        <div className="detail-actions">
          <button className="detail-action-btn" onClick={handleEdit}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.25.25 0 00.108-.064l6.286-6.286z" />
            </svg>
            Edit
          </button>
          <button className="detail-action-btn detail-action-btn-primary" onClick={handleRunRelease}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2.5L12 8L4 13.5V2.5Z" />
            </svg>
            Run Release
          </button>
          <button className="detail-action-btn" onClick={handleReviewRelease}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 010 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14s-3.671-.992-4.933-2.078c-1.27-1.091-2.187-2.345-2.637-3.023a1.62 1.62 0 010-1.798c.45-.678 1.367-1.932 2.637-3.023C4.33 2.992 6.019 2 8 2zm0 2c-1.416 0-2.7.72-3.733 1.608-1.006.865-1.79 1.904-2.188 2.492a.12.12 0 000 .134c.398.588 1.182 1.627 2.188 2.492C5.3 11.28 6.584 12 8 12c1.416 0 2.7-.72 3.733-1.608 1.006-.865 1.79-1.904 2.188-2.492a.12.12 0 000-.134c-.398-.588-1.182-1.627-2.188-2.492C10.7 4.72 9.416 4 8 4zm0 2a2 2 0 110 4 2 2 0 010-4z" />
            </svg>
            Review
          </button>
          <button className="detail-action-btn detail-action-btn-danger" onClick={handleDelete}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675a.75.75 0 10-1.492.15l.66 6.6A1.75 1.75 0 005.405 15h5.19a1.75 1.75 0 001.741-1.575l.66-6.6a.75.75 0 00-1.492-.15l-.66 6.6a.25.25 0 01-.249.225h-5.19a.25.25 0 01-.249-.225l-.66-6.6z" />
            </svg>
            Delete
          </button>
        </div>
      ) : githubUrl ? (
        <div className="detail-actions">
          <button className="detail-action-btn" onClick={() => window.open(githubUrl, "_blank")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            View on GitHub
          </button>
        </div>
      ) : null}

      {isCompleted && (createdLabel || completedLabel) && (
        <div className="detail-section">
          <h3 className="detail-section-title">Timeline</h3>
          <div className="detail-meta">
            {completedLabel && (
              <div className="detail-meta-row">
                <span className="detail-meta-label">Completed</span>
                <span className="detail-meta-value">{completedLabel}</span>
              </div>
            )}
            {createdLabel && (
              <div className="detail-meta-row">
                <span className="detail-meta-label">Created</span>
                <span className="detail-meta-value">{createdLabel}</span>
              </div>
            )}
            {durationLabel && (
              <div className="detail-meta-row">
                <span className="detail-meta-label">Duration</span>
                <span className="detail-meta-value">{durationLabel}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {release.issues.length > 0 && (
        <div className="detail-section">
          <h3 className="detail-section-title">Issues ({release.issues.length})</h3>
          <div className="detail-issues-list">
            {release.issues.map((issue) => (
              <div key={issue.number} className="detail-issue-item">
                <span className="detail-issue-number">#{issue.number}</span>
                <span className="detail-issue-title">{issue.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isCompleted && changelog && (
        <div className="detail-section">
          <h3 className="detail-section-title">Release Notes</h3>
          <div className="detail-body markdown-body">
            <MarkdownRenderer>{changelog}</MarkdownRenderer>
          </div>
        </div>
      )}

    </div>
  );
}
