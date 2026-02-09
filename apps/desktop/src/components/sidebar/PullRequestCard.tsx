import type { GitHubPullRequest } from "../../stores";
import "./PullRequestCard.css";

export interface PullRequestCardProps {
  pr: GitHubPullRequest;
  isSelected?: boolean;
  onClick?: () => void;
}

function formatReviewDecision(decision: string | null): string | null {
  if (!decision) return null;
  switch (decision) {
    case "APPROVED":
      return "Approved";
    case "CHANGES_REQUESTED":
      return "Changes requested";
    case "REVIEW_REQUIRED":
      return "Review required";
    default:
      return null;
  }
}

export function PullRequestCard({ pr, isSelected, onClick }: PullRequestCardProps) {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
  };

  const getContrastColor = (hexColor: string): string => {
    const hex = hexColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#ffffff";
  };

  const reviewLabel = formatReviewDecision(pr.reviewDecision);

  return (
    <div
      className={`pr-card ${pr.state}${isSelected ? ' selected' : ''}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
    >
      <div className="pr-card-header">
        <span className="pr-card-number">#{pr.number}</span>
        <div className="pr-card-header-right">
          {pr.isDraft && (
            <span className="pr-card-draft">Draft</span>
          )}
          <span className={`pr-card-state ${pr.state}`}>
            {pr.state === "OPEN" ? "Open" : pr.state === "MERGED" ? "Merged" : "Closed"}
          </span>
        </div>
      </div>
      <div className="pr-card-title">{pr.title}</div>
      <div className="pr-card-meta">
        <span className="pr-card-branch" title={pr.headRefName}>
          {pr.headRefName}
        </span>
        {reviewLabel && (
          <span className={`pr-card-review ${pr.reviewDecision}`}>
            {reviewLabel}
          </span>
        )}
      </div>
      {pr.labels.length > 0 && (
        <div className="pr-card-labels">
          {pr.labels.map((label) => (
            <span
              key={label.id}
              className="pr-card-label"
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
  );
}
