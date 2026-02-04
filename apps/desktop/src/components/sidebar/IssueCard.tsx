import type { GitHubIssue } from "../../stores";
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
}

export function IssueCard({ issue, work, isSelected, onClick, onEdit }: IssueCardProps) {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
  };

  const handleEditClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onEdit?.(issue);
  };

  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getContrastColor = (hexColor: string): string => {
    const hex = hexColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#ffffff";
  };

  return (
    <div
      className={`issue-card ${issue.state}${isSelected ? ' selected' : ''}`}
      onClick={onClick}
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
      <div className="issue-card-meta">
        <span className="issue-card-updated">
          Updated {formatRelativeTime(issue.updatedAt)}
        </span>
      </div>
    </div>
  );
}
