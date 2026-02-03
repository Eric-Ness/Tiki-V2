import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { ReleaseCard } from "./ReleaseCard";
import { useReleasesStore, type GitHubRelease } from "../../stores";
import "./ReleasesSection.css";

export function ReleasesSection() {
  const releases = useReleasesStore((state) => state.releases);
  const isLoading = useReleasesStore((state) => state.isLoading);
  const error = useReleasesStore((state) => state.error);
  const setReleases = useReleasesStore((state) => state.setReleases);
  const setLoading = useReleasesStore((state) => state.setLoading);
  const setError = useReleasesStore((state) => state.setError);
  const clearError = useReleasesStore((state) => state.clearError);
  const setLastFetched = useReleasesStore((state) => state.setLastFetched);

  const fetchReleases = useCallback(async () => {
    setLoading(true);
    clearError();

    try {
      // First check if gh is authenticated
      const isAuthenticated = await invoke<boolean>("check_gh_auth");

      if (!isAuthenticated) {
        setError("Not authenticated with GitHub. Run 'gh auth login' in your terminal.");
        setReleases([]);
        return;
      }

      // Fetch releases
      const fetchedReleases = await invoke<GitHubRelease[]>("fetch_github_releases", {
        limit: 20,
      });

      setReleases(fetchedReleases);
      setLastFetched(new Date().toISOString());
    } catch (err) {
      const errorMessage = String(err);
      setError(errorMessage);
      setReleases([]);
    } finally {
      setLoading(false);
    }
  }, [setReleases, setLoading, setError, clearError, setLastFetched]);

  // Fetch releases on mount
  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);

  const handleReleaseClick = (release: GitHubRelease) => {
    // Open release in browser
    window.open(release.url, "_blank");
  };

  const releaseIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 4L8 1L14 4V12L8 15L2 12V4Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M8 7V15"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M2 4L8 7L14 4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );

  const headerActions = (
    <div className="releases-section-actions" onClick={(e) => e.stopPropagation()}>
      <button
        className="releases-section-refresh"
        onClick={fetchReleases}
        disabled={isLoading}
        type="button"
        aria-label="Refresh releases"
        title="Refresh releases"
      >
        <svg
          className={isLoading ? "spinning" : ""}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M1.5 7C1.5 4.23858 3.73858 2 6.5 2C8.5 2 10.2 3.2 11 5M12.5 7C12.5 9.76142 10.2614 12 7.5 12C5.5 12 3.8 10.8 3 9"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M11 2V5H8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 12V9H6"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );

  return (
    <CollapsibleSection
      title="Releases"
      icon={releaseIcon}
      badge={releases.length > 0 ? releases.length : undefined}
      className="releases-section"
    >
      <div className="releases-section-content">
        {headerActions}

        {error && (
          <div className="releases-section-error">
            <span>{error}</span>
            <button
              className="releases-section-error-dismiss"
              onClick={clearError}
              type="button"
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}

        {isLoading && releases.length === 0 && (
          <div className="releases-section-loading">
            <span className="releases-section-spinner" />
            Loading releases...
          </div>
        )}

        {!isLoading && !error && releases.length === 0 && (
          <div className="releases-section-empty">
            No releases found
          </div>
        )}

        {releases.length > 0 && (
          <div className="releases-section-list">
            {releases.map((release) => (
              <ReleaseCard
                key={release.tagName}
                release={release}
                onClick={() => handleReleaseClick(release)}
              />
            ))}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
