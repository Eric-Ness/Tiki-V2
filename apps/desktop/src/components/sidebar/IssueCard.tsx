import type { GitHubIssue } from "../../stores";
import "./IssueCard.css";

export interface IssueCardProps {
  issue: GitHubIssue;
  onClick?: () => void;
}

export function IssueCard({ issue, onClick }: IssueCardProps) {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
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
      className={`issue-card ${issue.state}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
    >
      <div className="issue-card-header">
        <span className="issue-card-number">#{issue.number}</span>
        <span className={`issue-card-state ${issue.state}`}>
          {issue.state === "OPEN" ? "Open" : "Closed"}
        </span>
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
