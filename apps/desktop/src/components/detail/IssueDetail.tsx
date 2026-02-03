import type { GitHubIssue } from "../../stores";
import "./DetailPanel.css";

interface IssueDetailProps {
  issue: GitHubIssue;
}

const stateBadgeStyles: Record<string, string> = {
  open: "issue-state-open",
  closed: "issue-state-closed",
};

function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

function formatRelativeTime(dateString: string): string {
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
}

export function IssueDetail({ issue }: IssueDetailProps) {
  const normalizedState = issue.state.toLowerCase();
  const badgeClass = stateBadgeStyles[normalizedState] || stateBadgeStyles.open;

  const handleOpenInGitHub = () => {
    window.open(issue.url, "_blank");
  };

  return (
    <div className="detail-view">
      <div className="detail-header">
        <div className="detail-header-row">
          <span className="detail-issue-number">#{issue.number}</span>
          <span className={`detail-state-badge ${badgeClass}`}>
            {normalizedState === "open" ? "Open" : "Closed"}
          </span>
        </div>
        <h2 className="detail-title">{issue.title}</h2>
      </div>

      <div className="detail-actions">
        <button className="detail-action-btn" onClick={handleOpenInGitHub}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Open in GitHub
        </button>
      </div>

      {issue.labels.length > 0 && (
        <div className="detail-section">
          <h3 className="detail-section-title">Labels</h3>
          <div className="detail-labels">
            {issue.labels.map((label) => (
              <span
                key={label.id}
                className="detail-label"
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
        </div>
      )}

      <div className="detail-section">
        <h3 className="detail-section-title">Timeline</h3>
        <div className="detail-meta">
          <div className="detail-meta-item">
            <span className="detail-meta-label">Created</span>
            <span className="detail-meta-value">
              {formatRelativeTime(issue.createdAt)}
            </span>
          </div>
          <div className="detail-meta-item">
            <span className="detail-meta-label">Updated</span>
            <span className="detail-meta-value">
              {formatRelativeTime(issue.updatedAt)}
            </span>
          </div>
        </div>
      </div>

      {issue.body && (
        <div className="detail-section detail-body-section">
          <h3 className="detail-section-title">Description</h3>
          <div className="detail-body">{issue.body}</div>
        </div>
      )}
    </div>
  );
}
