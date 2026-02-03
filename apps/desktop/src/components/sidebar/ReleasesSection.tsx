import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { ReleaseCard } from "./ReleaseCard";
import { ReleaseDialog } from "../releases";
import {
  useReleasesStore,
  useDetailStore,
  useTikiReleasesStore,
  type GitHubRelease,
  type TikiRelease,
} from "../../stores";
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

  // Tiki releases store
  const tikiReleases = useTikiReleasesStore((state) => state.releases);
  const setTikiReleases = useTikiReleasesStore((state) => state.setReleases);
  const addTikiRelease = useTikiReleasesStore((state) => state.addRelease);
  const updateTikiRelease = useTikiReleasesStore((state) => state.updateRelease);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRelease, setEditingRelease] = useState<TikiRelease | undefined>(undefined);

  // Load Tiki releases from disk on mount
  const loadTikiReleases = useCallback(async () => {
    try {
      const loadedReleases = await invoke<TikiRelease[]>("load_tiki_releases");
      setTikiReleases(loadedReleases);
    } catch (err) {
      console.error("Failed to load Tiki releases:", err);
    }
  }, [setTikiReleases]);

  // Save release to disk
  const saveTikiRelease = useCallback(async (release: TikiRelease) => {
    try {
      await invoke("save_tiki_release", { release });
    } catch (err) {
      console.error("Failed to save Tiki release:", err);
    }
  }, []);

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

  const setSelectedRelease = useDetailStore((state) => state.setSelectedRelease);
  const selectedRelease = useDetailStore((state) => state.selectedRelease);

  // Fetch releases on mount
  useEffect(() => {
    fetchReleases();
    loadTikiReleases();
  }, [fetchReleases, loadTikiReleases]);

  const handleReleaseClick = (release: GitHubRelease) => {
    // Set the selected release to show in detail panel
    setSelectedRelease(release.tagName);
  };

  const handleAddClick = () => {
    setEditingRelease(undefined);
    setIsDialogOpen(true);
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setEditingRelease(undefined);
  };

  const handleDialogSave = async (release: Omit<TikiRelease, "createdAt" | "updatedAt">) => {
    if (editingRelease) {
      // Update existing release
      const updatedRelease: TikiRelease = {
        ...editingRelease,
        ...release,
        updatedAt: new Date().toISOString(),
      };
      updateTikiRelease(editingRelease.version, updatedRelease);
      await saveTikiRelease(updatedRelease);
    } else {
      // Add new release
      const newRelease: TikiRelease = {
        ...release,
        createdAt: new Date().toISOString(),
      };
      addTikiRelease(newRelease);
      await saveTikiRelease(newRelease);
    }
    handleDialogClose();
  };

  const handleTikiReleaseClick = (release: TikiRelease) => {
    setEditingRelease(release);
    setIsDialogOpen(true);
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
        className="releases-section-add"
        onClick={handleAddClick}
        type="button"
        aria-label="Add release"
        title="Add release"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M7 2V12M2 7H12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
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

  // Calculate total count for badge
  const totalCount = releases.length + tikiReleases.length;

  return (
    <>
      <CollapsibleSection
        title="Releases"
        icon={releaseIcon}
        badge={totalCount > 0 ? totalCount : undefined}
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

          {isLoading && releases.length === 0 && tikiReleases.length === 0 && (
            <div className="releases-section-loading">
              <span className="releases-section-spinner" />
              Loading releases...
            </div>
          )}

          {/* Tiki Releases (local releases with issues) */}
          {tikiReleases.length > 0 && (
            <div className="releases-section-group">
              <div className="releases-section-group-label">Local Releases</div>
              <div className="releases-section-list">
                {tikiReleases.map((release) => (
                  <div
                    key={release.version}
                    className="releases-section-tiki-card"
                    onClick={() => handleTikiReleaseClick(release)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleTikiReleaseClick(release);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <div className="releases-section-tiki-header">
                      <span className="releases-section-tiki-version">{release.version}</span>
                      <span className={`releases-section-tiki-status ${release.status}`}>
                        {release.status}
                      </span>
                    </div>
                    <div className="releases-section-tiki-issues">
                      {release.issues.length} issue{release.issues.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* GitHub Releases */}
          {releases.length > 0 && (
            <div className="releases-section-group">
              {tikiReleases.length > 0 && (
                <div className="releases-section-group-label">GitHub Releases</div>
              )}
              <div className="releases-section-list">
                {releases.map((release) => (
                  <ReleaseCard
                    key={release.tagName}
                    release={release}
                    isSelected={selectedRelease === release.tagName}
                    onClick={() => handleReleaseClick(release)}
                  />
                ))}
              </div>
            </div>
          )}

          {!isLoading && !error && releases.length === 0 && tikiReleases.length === 0 && (
            <div className="releases-section-empty">
              No releases found. Click + to create one.
            </div>
          )}
        </div>
      </CollapsibleSection>

      <ReleaseDialog
        isOpen={isDialogOpen}
        onClose={handleDialogClose}
        onSave={handleDialogSave}
        editingRelease={editingRelease}
      />
    </>
  );
}
