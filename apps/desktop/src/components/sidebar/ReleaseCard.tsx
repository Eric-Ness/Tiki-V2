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
    </div>
  );
}
