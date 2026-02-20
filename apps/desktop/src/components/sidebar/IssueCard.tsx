import { memo, useMemo } from "react";
import type { GitHubIssue } from "../../stores";
import { useContextMenu, ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";
import "./IssueCard.css";

export interface WorkProgress {
  status: string;
  currentPhase?: number;
  totalPhases?: number;
}

export interface IssueCardProps {
  issue: GitHubIssue;
  work?: WorkProgress;
  isSelected?: boolean;
  onClick?: () => void;
  onEdit?: (issue: GitHubIssue) => void;
  onOpenInGitHub?: (issue: GitHubIssue) => void;
  onCopyUrl?: (issue: GitHubIssue) => void;
  onRunYolo?: (issue: GitHubIssue) => void;
  onCloseIssue?: (issue: GitHubIssue) => void;
}

export const IssueCard = memo(function IssueCard({ issue, work, isSelected, onClick, onEdit, onOpenInGitHub, onCopyUrl, onRunYolo, onCloseIssue }: IssueCardProps) {
  const contextMenu = useContextMenu();

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
    // Delegate Shift+F10 / ContextMenu key to the hook
    contextMenu.handleKeyDown(event);
  };

  const handleEditClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onEdit?.(issue);
  };

  const getContrastColor = (hexColor: string): string => {
    const hex = hexColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#ffffff";
  };

  const isOpen = issue.state === "OPEN";

  const menuItems: ContextMenuEntry[] = useMemo(() => [
    {
      key: "open-github",
      label: "Open in GitHub",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      ),
      onClick: () => onOpenInGitHub?.(issue),
    },
    {
      key: "copy-url",
      label: "Copy URL",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      ),
      onClick: () => onCopyUrl?.(issue),
    },
    { key: "sep-1", separator: true },
    {
      key: "run-yolo",
      label: "Run YOLO",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      ),
      onClick: () => onRunYolo?.(issue),
      disabled: !isOpen,
    },
    {
      key: "edit",
      label: "Edit Issue",
      icon: (
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" />
        </svg>
      ),
      onClick: () => onEdit?.(issue),
    },
    { key: "sep-2", separator: true },
    {
      key: "close-issue",
      label: isOpen ? "Close Issue" : "Reopen Issue",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isOpen ? (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12l3 3 5-5" />
            </>
          )}
        </svg>
      ),
      onClick: () => onCloseIssue?.(issue),
      danger: isOpen,
    },
  ], [issue, isOpen, onOpenInGitHub, onCopyUrl, onRunYolo, onEdit, onCloseIssue]);

  return (
    <>
      <div
        className={`issue-card ${issue.state}${isSelected ? ' selected' : ''}`}
        onClick={onClick}
        onContextMenu={contextMenu.handleContextMenu}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
      >
        <div className="issue-card-header">
          <span className="issue-card-number">#{issue.number}</span>
          <div className="issue-card-header-right">
            {onEdit && (
              <button
                className="issue-card-edit"
                onClick={handleEditClick}
                type="button"
                aria-label="Edit issue"
                title="Edit issue"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            <span className={`issue-card-state ${issue.state}`}>
              {issue.state === "OPEN" ? "Open" : "Closed"}
            </span>
            {work && work.currentPhase && work.totalPhases && (
              <span className="issue-card-phase" title={`Phase ${work.currentPhase} of ${work.totalPhases}`}>
                {work.currentPhase}/{work.totalPhases}
              </span>
            )}
          </div>
        </div>
        <div className="issue-card-title">{issue.title}</div>
        {issue.labels.length > 0 && (
          <div className="issue-card-labels">
            {issue.labels.map((label) => (
              <span
                key={label.id}
                className="issue-card-label"
                style={{
                  backgroundColor: `#${label.color}`,
                  color: getContrastColor(label.color),
                }}
                title={label.description || label.name}
              >
                {label.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={menuItems}
        onClose={contextMenu.close}
      />
    </>
  );
});
