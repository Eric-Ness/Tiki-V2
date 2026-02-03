import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { IssueFormModal } from "../ui/IssueFormModal";
import { IssueCard } from "./IssueCard";
import { useIssuesStore, useDetailStore, type GitHubIssue, type IssueFilter } from "../../stores";
import "./IssuesSection.css";

export function IssuesSection() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingIssue, setEditingIssue] = useState<GitHubIssue | null>(null);

  const issues = useIssuesStore((state) => state.issues);
  const filter = useIssuesStore((state) => state.filter);
  const isLoading = useIssuesStore((state) => state.isLoading);
  const error = useIssuesStore((state) => state.error);
  const setIssues = useIssuesStore((state) => state.setIssues);
  const setFilter = useIssuesStore((state) => state.setFilter);
  const setLoading = useIssuesStore((state) => state.setLoading);
  const setError = useIssuesStore((state) => state.setError);
  const clearError = useIssuesStore((state) => state.clearError);
  const setLastFetched = useIssuesStore((state) => state.setLastFetched);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    clearError();

    try {
      // First check if gh is authenticated
      const isAuthenticated = await invoke<boolean>("check_gh_auth");

      if (!isAuthenticated) {
        setError("Not authenticated with GitHub. Run 'gh auth login' in your terminal.");
        setIssues([]);
        return;
      }

      // Fetch issues with current filter
      const fetchedIssues = await invoke<GitHubIssue[]>("fetch_github_issues", {
        state: filter,
        limit: 30,
      });

      setIssues(fetchedIssues);
      setLastFetched(new Date().toISOString());
    } catch (err) {
      const errorMessage = String(err);
      setError(errorMessage);
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, [filter, setIssues, setLoading, setError, clearError, setLastFetched]);

  // Fetch issues on mount and when filter changes
  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const setSelectedIssue = useDetailStore((state) => state.setSelectedIssue);
  const selectedIssue = useDetailStore((state) => state.selectedIssue);

  const handleFilterChange = (newFilter: IssueFilter) => {
    setFilter(newFilter);
  };

  const handleIssueClick = (issue: GitHubIssue) => {
    // Set the selected issue to show in detail panel
    setSelectedIssue(issue.number);
  };

  const handleEditIssue = (issue: GitHubIssue) => {
    setEditingIssue(issue);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingIssue(null);
  };

  const issueIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );

  const headerActions = (
    <div className="issues-section-actions" onClick={(e) => e.stopPropagation()}>
      <select
        className="issues-section-filter"
        value={filter}
        onChange={(e) => handleFilterChange(e.target.value as IssueFilter)}
        disabled={isLoading}
      >
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="all">All</option>
      </select>
      <button
        className="issues-section-add"
        onClick={() => setShowCreateModal(true)}
        type="button"
        aria-label="Create new issue"
        title="Create new issue"
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
        className="issues-section-refresh"
        onClick={fetchIssues}
        disabled={isLoading}
        type="button"
        aria-label="Refresh issues"
        title="Refresh issues"
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
    <>
      <CollapsibleSection
        title="Issues"
        icon={issueIcon}
        badge={issues.length > 0 ? issues.length : undefined}
        className="issues-section"
      >
        <div className="issues-section-content">
          {headerActions}

          {error && (
            <div className="issues-section-error">
              <span>{error}</span>
              <button
                className="issues-section-error-dismiss"
                onClick={clearError}
                type="button"
                aria-label="Dismiss error"
              >
                &times;
              </button>
            </div>
          )}

          {isLoading && issues.length === 0 && (
            <div className="issues-section-loading">
              <span className="issues-section-spinner" />
              Loading issues...
            </div>
          )}

          {!isLoading && !error && issues.length === 0 && (
            <div className="issues-section-empty">
              No {filter === "all" ? "" : filter} issues found
            </div>
          )}

          {issues.length > 0 && (
            <div className="issues-section-list">
              {issues.map((issue) => (
                <IssueCard
                  key={issue.number}
                  issue={issue}
                  isSelected={selectedIssue === issue.number}
                  onClick={() => handleIssueClick(issue)}
                  onEdit={handleEditIssue}
                />
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>

      <IssueFormModal
        isOpen={showCreateModal || editingIssue !== null}
        onClose={handleCloseModal}
        onSuccess={fetchIssues}
        editingIssue={editingIssue}
      />
    </>
  );
}
