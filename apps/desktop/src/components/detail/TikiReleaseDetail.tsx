import { invoke } from "@tauri-apps/api/core";
import type { TikiRelease } from "../../stores/tikiReleasesStore";
import { useTerminalStore, useReleaseDialogStore, useTikiReleasesStore, useDetailStore } from "../../stores";
import "./DetailPanel.css";

interface TikiReleaseDetailProps {
  release: TikiRelease;
}

const statusBadgeStyles: Record<string, string> = {
  active: "release-status-active",
  completed: "release-status-completed",
  shipped: "release-status-published",
  not_planned: "release-status-draft",
};

const statusLabels: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  shipped: "Shipped",
  not_planned: "Not Planned",
};

export function TikiReleaseDetail({ release }: TikiReleaseDetailProps) {
  const { tabs, activeTabId } = useTerminalStore();
  const openDialog = useReleaseDialogStore((state) => state.openDialog);
  const deleteRelease = useTikiReleasesStore((state) => state.deleteRelease);
  const clearSelection = useDetailStore((state) => state.clearSelection);
  const badgeClass = statusBadgeStyles[release.status] || statusBadgeStyles.active;

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
      await invoke("delete_tiki_release", { version: release.version });
      deleteRelease(release.version);
      clearSelection();
    } catch (error) {
      console.error("Failed to delete release:", error);
    }
  };

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
            {statusLabels[release.status] || release.status}
          </span>
        </div>
        <h2 className="detail-title">{release.name || release.version}</h2>
        <span className="detail-tag">{release.version}</span>
      </div>

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

    </div>
  );
}
