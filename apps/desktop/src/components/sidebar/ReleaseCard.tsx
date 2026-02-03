import type { GitHubRelease } from "../../stores";
import "./ReleaseCard.css";

export interface ReleaseCardProps {
  release: GitHubRelease;
  isSelected?: boolean;
  onClick?: () => void;
}

export function ReleaseCard({ release, isSelected, onClick }: ReleaseCardProps) {
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

  return (
    <div
      className={`release-card ${release.isDraft ? "draft" : ""} ${release.isPrerelease ? "prerelease" : ""}${isSelected ? " selected" : ""}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
    >
      <div className="release-card-header">
        <span className="release-card-tag">{release.tagName}</span>
        <div className="release-card-badges">
          {release.isDraft && (
            <span className="release-card-badge draft">Draft</span>
          )}
          {release.isPrerelease && (
            <span className="release-card-badge prerelease">Pre-release</span>
          )}
        </div>
      </div>
      {release.name && release.name !== release.tagName && (
        <div className="release-card-name">{release.name}</div>
      )}
      <div className="release-card-meta">
        {release.publishedAt ? (
          <span className="release-card-date">
            Published {formatRelativeTime(release.publishedAt)}
          </span>
        ) : (
          <span className="release-card-date">Not published</span>
        )}
      </div>
    </div>
  );
}
