import type { GitHubRelease } from "../../stores";
import "./DetailPanel.css";

interface ReleaseDetailProps {
  release: GitHubRelease;
}

const statusBadgeStyles: Record<string, string> = {
  published: "release-status-published",
  draft: "release-status-draft",
  prerelease: "release-status-prerelease",
};

function getReleaseStatus(release: GitHubRelease): string {
  if (release.isDraft) return "draft";
  if (release.isPrerelease) return "prerelease";
  return "published";
}

export function ReleaseDetail({ release }: ReleaseDetailProps) {
  const status = getReleaseStatus(release);
  const badgeClass = statusBadgeStyles[status] || statusBadgeStyles.published;

  const handleOpenInGitHub = () => {
    if (release.url) {
      window.open(release.url, "_blank");
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
            {status === "published"
              ? "Published"
              : status === "draft"
                ? "Draft"
                : "Pre-release"}
          </span>
        </div>
        <h2 className="detail-title">{release.name || release.tagName}</h2>
        <span className="detail-tag">{release.tagName}</span>
      </div>

      {release.url && (
        <div className="detail-actions">
          <button className="detail-action-btn" onClick={handleOpenInGitHub}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            View on GitHub
          </button>
        </div>
      )}

    </div>
  );
}
