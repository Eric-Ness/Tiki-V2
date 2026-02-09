import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { PullRequestCard } from "./PullRequestCard";
import { usePullRequestsStore, useDetailStore, useProjectsStore, useSettingsStore, filterPrsBySearch, type GitHubPullRequest, type PrFilter } from "../../stores";
import "./PullRequestsSection.css";

export function PullRequestsSection() {
  const [searchInput, setSearchInput] = useState('');

  const prs = usePullRequestsStore((state) => state.prs);
  const searchQuery = usePullRequestsStore((state) => state.searchQuery);
  const setSearchQuery = usePullRequestsStore((state) => state.setSearchQuery);
  const filter = usePullRequestsStore((state) => state.filter);
  const isLoading = usePullRequestsStore((state) => state.isLoading);
  const error = usePullRequestsStore((state) => state.error);
  const setPrs = usePullRequestsStore((state) => state.setPrs);
  const setFilter = usePullRequestsStore((state) => state.setFilter);
  const setIsLoading = usePullRequestsStore((state) => state.setIsLoading);
  const setError = usePullRequestsStore((state) => state.setError);
  const clearError = usePullRequestsStore((state) => state.clearError);
  const setLastFetched = usePullRequestsStore((state) => state.setLastFetched);
  const refetchCounter = usePullRequestsStore((state) => state.refetchCounter);

  const activeProject = useProjectsStore((state) =>
    state.projects.find((p) => p.id === state.activeProjectId)
  );

  // Debounce search input to store
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setSearchQuery]);

  // Filter PRs by search query
  const filteredPrs = useMemo(
    () => filterPrsBySearch(prs, searchQuery),
    [prs, searchQuery]
  );

  const fetchPrs = useCallback(async () => {
    // Don't fetch if no project is selected
    if (!activeProject) {
      setPrs([]);
      clearError();
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    clearError();

    try {
      // First check if gh is authenticated
      const isAuthenticated = await invoke<boolean>("check_gh_auth");

      if (!isAuthenticated) {
        setError("Not authenticated with GitHub. Run 'gh auth login' in your terminal.");
        setPrs([]);
        return;
      }

      // Fetch PRs with current filter and project path
      const fetchedPrs = await invoke<GitHubPullRequest[]>("fetch_github_prs", {
        stateFilter: filter,
        limit: useSettingsStore.getState().github.issueFetchLimit,
        projectPath: activeProject.path,
      });

      setPrs(fetchedPrs);
      setLastFetched(new Date().toISOString());
    } catch (err) {
      const errorMessage = String(err);
      setError(errorMessage);
      setPrs([]);
    } finally {
      setIsLoading(false);
    }
  }, [filter, activeProject, refetchCounter, setPrs, setIsLoading, setError, clearError, setLastFetched]);

  // Fetch PRs on mount and when filter changes
  useEffect(() => {
    fetchPrs();
  }, [fetchPrs]);

  const setSelectedPr = useDetailStore((state) => state.setSelectedPr);
  const projectId = useProjectsStore((state) => state.activeProjectId) ?? 'default';
  const selectedPr = useDetailStore((state) => state.selectionByProject[projectId]?.selectedPr ?? null);

  const handleFilterChange = (newFilter: PrFilter) => {
    setFilter(newFilter);
  };

  const handlePrClick = (pr: GitHubPullRequest) => {
    setSelectedPr(pr.number);
  };

  const prIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 3L12 5L10 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 3V13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M12 5H8C6.89543 5 6 5.89543 6 7V13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="6" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );

  const hasProject = !!activeProject;

  const headerActions = (
    <div className="prs-section-actions" onClick={(e) => e.stopPropagation()}>
      <select
        className="prs-section-filter"
        value={filter}
        onChange={(e) => handleFilterChange(e.target.value as PrFilter)}
        disabled={isLoading || !hasProject}
      >
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="merged">Merged</option>
        <option value="all">All</option>
      </select>
      <button
        className="prs-section-refresh"
        onClick={fetchPrs}
        disabled={isLoading || !hasProject}
        type="button"
        aria-label="Refresh pull requests"
        title={hasProject ? "Refresh pull requests" : "Select a project first"}
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
      title="Pull Requests"
      icon={prIcon}
      badge={prs.length > 0 ? prs.length : undefined}
      className="prs-section"
      defaultCollapsed
    >
      <div className="prs-section-content">
        {headerActions}

        {hasProject && (
          <div className="prs-section-search">
            <input
              type="text"
              className="prs-section-search-input"
              placeholder="Search pull requests..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                className="prs-section-search-clear"
                onClick={() => { setSearchInput(''); setSearchQuery(''); }}
                type="button"
                aria-label="Clear search"
              >
                &times;
              </button>
            )}
            {searchQuery && (
              <span className="prs-section-search-count">
                {filteredPrs.length} of {prs.length}
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="prs-section-error">
            <span>{error}</span>
            <button
              className="prs-section-error-dismiss"
              onClick={clearError}
              type="button"
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}

        {isLoading && prs.length === 0 && (
          <div className="prs-section-loading">
            <span className="prs-section-spinner" />
            Loading pull requests...
          </div>
        )}

        {!hasProject && (
          <div className="prs-section-empty">
            Select a project to view pull requests
          </div>
        )}

        {hasProject && !isLoading && !error && prs.length === 0 && (
          <div className="prs-section-empty">
            No {filter === "all" ? "" : filter} pull requests found
          </div>
        )}

        {hasProject && !isLoading && !error && prs.length > 0 && filteredPrs.length === 0 && searchQuery && (
          <div className="prs-section-empty">
            No pull requests matching &ldquo;{searchQuery}&rdquo;
          </div>
        )}

        {filteredPrs.length > 0 && (
          <div className="prs-section-list">
            {filteredPrs.map((pr) => (
              <PullRequestCard
                key={pr.number}
                pr={pr}
                isSelected={selectedPr === pr.number}
                onClick={() => handlePrClick(pr)}
              />
            ))}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
