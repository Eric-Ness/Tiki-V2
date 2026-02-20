import { useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { ReleaseDialog } from "../releases";
import { useContextMenu, ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";
import {
  useReleasesStore,
  useDetailStore,
  useTikiReleasesStore,
  useProjectsStore,
  useReleaseDialogStore,
  type GitHubRelease,
  type TikiRelease,
  type TikiReleaseStatus,
} from "../../stores";
import "./ReleasesSection.css";

/** Compare two version strings by semver (descending). */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
}

/** Merged release combining GitHub + local tiki data */
interface MergedRelease {
  version: string;
  name?: string;
  status?: TikiReleaseStatus;
  issueCount?: number;
  isDraft?: boolean;
  isPrerelease?: boolean;
  publishedAt?: string;
  url?: string;
  hasGitHub: boolean;
  hasTiki: boolean;
}

/** Inner component for a release card with its own context menu */
function ReleaseCardWithMenu({
  release,
  isSelected,
  onClick,
  onEdit,
  onDelete,
}: {
  release: MergedRelease;
  isSelected: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const contextMenu = useContextMenu();

  const menuItems: ContextMenuEntry[] = [];

  if (release.hasGitHub && release.url) {
    menuItems.push({
      key: "open-github",
      label: "View on GitHub",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      ),
      onClick: () => window.open(release.url, "_blank"),
    });
  }

  if (onEdit) {
    menuItems.push({
      key: "edit",
      label: "Edit Release",
      icon: (
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" />
        </svg>
      ),
      onClick: onEdit,
      disabled: !release.hasTiki,
    });
  }

  if (onDelete) {
    if (menuItems.length > 0) {
      menuItems.push({ key: "sep-1", separator: true });
    }
    menuItems.push({
      key: "delete",
      label: "Delete Release",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      ),
      onClick: onDelete,
      danger: true,
      disabled: !release.hasTiki,
    });
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
    contextMenu.handleKeyDown(e);
  };

  return (
    <>
      <div
        className={`releases-section-tiki-card${isSelected ? " selected" : ""}`}
        onClick={onClick}
        onContextMenu={contextMenu.handleContextMenu}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
      >
        <div className="releases-section-tiki-header">
          <span className="releases-section-tiki-version">{release.version}</span>
          <div className="releases-section-badges">
            {release.status && (
              <span className={`releases-section-tiki-status ${release.status}`}>
                {release.status}
              </span>
            )}
            {release.isDraft && (
              <span className="releases-section-tiki-status">draft</span>
            )}
            {release.isPrerelease && (
              <span className="releases-section-tiki-status">pre-release</span>
            )}
          </div>
        </div>
        {release.issueCount !== undefined && (
          <div className="releases-section-tiki-issues">
            {release.issueCount} issue{release.issueCount !== 1 ? "s" : ""}
          </div>
        )}
      </div>
      {menuItems.length > 0 && (
        <ContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          items={menuItems}
          onClose={contextMenu.close}
        />
      )}
    </>
  );
}

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

  // Projects store
  const activeProject = useProjectsStore((state) =>
    state.projects.find((p) => p.id === state.activeProjectId)
  );

  // Dialog state (from store for global access)
  const isDialogOpen = useReleaseDialogStore((state) => state.isOpen);
  const editingRelease = useReleaseDialogStore((state) => state.editingRelease);
  const openDialog = useReleaseDialogStore((state) => state.openDialog);
  const closeDialog = useReleaseDialogStore((state) => state.closeDialog);

  // Load Tiki releases from disk on mount
  const loadTikiReleases = useCallback(async () => {
    try {
      const tikiPath = activeProject ? `${activeProject.path}\\.tiki` : undefined;
      const loadedReleases = await invoke<TikiRelease[]>("load_tiki_releases", { tikiPath });
      setTikiReleases(loadedReleases);
    } catch (err) {
      console.error("Failed to load Tiki releases:", err);
    }
  }, [setTikiReleases, activeProject]);

  // Save release to disk
  const saveTikiRelease = useCallback(async (release: TikiRelease) => {
    try {
      const tikiPath = activeProject ? `${activeProject.path}\\.tiki` : undefined;
      await invoke("save_tiki_release", { release, tikiPath });
    } catch (err) {
      console.error("Failed to save Tiki release:", err);
    }
  }, [activeProject]);

  const fetchReleases = useCallback(async () => {
    // Don't fetch GitHub releases if no project is selected
    if (!activeProject) {
      setReleases([]);
      clearError();
      setLoading(false);
      return;
    }

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

      // Fetch releases with project path
      const fetchedReleases = await invoke<GitHubRelease[]>("fetch_github_releases", {
        limit: 20,
        projectPath: activeProject.path,
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
  }, [activeProject, setReleases, setLoading, setError, clearError, setLastFetched]);

  const setSelectedRelease = useDetailStore((state) => state.setSelectedRelease);
  const projectId = useProjectsStore((state) => state.activeProjectId) ?? 'default';
  const selectedRelease = useDetailStore((state) => state.selectionByProject[projectId]?.selectedRelease ?? null);
  const setSelectedTikiRelease = useDetailStore((state) => state.setSelectedTikiRelease);
  const selectedTikiRelease = useDetailStore((state) => state.selectionByProject[projectId]?.selectedTikiRelease ?? null);

  // Fetch releases on mount
  useEffect(() => {
    fetchReleases();
    loadTikiReleases();
  }, [fetchReleases, loadTikiReleases]);

  // Merge GitHub + Tiki releases into a single deduplicated list
  const mergedReleases = useMemo(() => {
    const map = new Map<string, MergedRelease>();

    // Add GitHub releases first
    for (const gh of releases) {
      map.set(gh.tagName, {
        version: gh.tagName,
        name: gh.name,
        isDraft: gh.isDraft,
        isPrerelease: gh.isPrerelease,
        publishedAt: gh.publishedAt,
        url: gh.url,
        hasGitHub: true,
        hasTiki: false,
      });
    }

    // Overlay tiki data (or add tiki-only releases)
    for (const tiki of tikiReleases) {
      const existing = map.get(tiki.version);
      if (existing) {
        existing.status = tiki.status;
        existing.issueCount = tiki.issues.length;
        existing.hasTiki = true;
      } else {
        map.set(tiki.version, {
          version: tiki.version,
          name: tiki.name,
          status: tiki.status,
          issueCount: tiki.issues.length,
          hasGitHub: false,
          hasTiki: true,
        });
      }
    }

    // Sort by version descending (semver-aware)
    return Array.from(map.values()).sort((a, b) => compareSemver(a.version, b.version));
  }, [releases, tikiReleases]);

  const handleReleaseClick = (merged: MergedRelease) => {
    // Prefer tiki detail if local data exists, otherwise GitHub detail
    if (merged.hasTiki) {
      setSelectedTikiRelease(merged.version);
    } else {
      setSelectedRelease(merged.version);
    }
  };

  const handleEditRelease = useCallback((version: string) => {
    const tikiRelease = tikiReleases.find((r) => r.version === version);
    if (tikiRelease) {
      openDialog(tikiRelease);
    }
  }, [tikiReleases, openDialog]);

  const handleDeleteRelease = useCallback(async (version: string) => {
    try {
      const tikiPath = activeProject ? `${activeProject.path}\\.tiki` : undefined;
      await invoke("delete_tiki_release", { version, tikiPath });
      useTikiReleasesStore.getState().deleteRelease(version);
    } catch (err) {
      console.error("Failed to delete Tiki release:", err);
      // Still remove from UI store even if disk delete fails
      useTikiReleasesStore.getState().deleteRelease(version);
    }
  }, [activeProject]);

  const handleAddClick = () => {
    openDialog(undefined);
  };

  const handleDialogClose = () => {
    closeDialog();
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

  const hasProject = !!activeProject;

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
        disabled={isLoading || !hasProject}
        type="button"
        aria-label="Refresh releases"
        title={hasProject ? "Refresh releases" : "Select a project first"}
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

  // Compute suggested next version by incrementing the patch of the highest existing version
  const suggestedVersion = useMemo(() => {
    const versions = mergedReleases.map((r) => r.version);
    if (versions.length === 0) return "v0.1.0";
    const sorted = [...versions].sort(compareSemver);
    const latest = sorted[0].replace(/-.*$/, ""); // strip pre-release suffix
    const parts = latest.replace(/^v/, "").split(".").map(Number);
    parts[2] = (parts[2] || 0) + 1;
    return `v${parts.join(".")}`;
  }, [mergedReleases]);

  const totalCount = mergedReleases.length;

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

          {isLoading && mergedReleases.length === 0 && (
            <div className="releases-section-loading">
              <span className="releases-section-spinner" />
              Loading releases...
            </div>
          )}

          {mergedReleases.length > 0 && (
            <div className="releases-section-list">
              {mergedReleases.map((release) => {
                const isSelected = release.hasTiki
                  ? selectedTikiRelease === release.version
                  : selectedRelease === release.version;
                return (
                  <ReleaseCardWithMenu
                    key={release.version}
                    release={release}
                    isSelected={isSelected}
                    onClick={() => handleReleaseClick(release)}
                    onEdit={() => handleEditRelease(release.version)}
                    onDelete={() => handleDeleteRelease(release.version)}
                  />
                );
              })}
            </div>
          )}

          {!hasProject && mergedReleases.length === 0 && (
            <div className="releases-section-empty">
              Select a project to view GitHub releases
            </div>
          )}

          {hasProject && !isLoading && !error && mergedReleases.length === 0 && (
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
        suggestedVersion={suggestedVersion}
      />
    </>
  );
}
