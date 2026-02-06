import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type TikiRelease, type GitHubIssue } from "../../stores";
import "./ReleaseDialog.css";

export interface ReleaseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (release: Omit<TikiRelease, "createdAt" | "updatedAt">) => void;
  editingRelease?: TikiRelease;
  suggestedVersion?: string;
}

export function ReleaseDialog({
  isOpen,
  onClose,
  onSave,
  editingRelease,
  suggestedVersion,
}: ReleaseDialogProps) {
  const [version, setVersion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<
    Array<{ number: number; title: string }>
  >([]);

  const isEditing = !!editingRelease;

  // Local state for open issues (fetched directly, independent of IssuesSection filter)
  const [openIssues, setOpenIssues] = useState<GitHubIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);

  // Fetch open issues directly from GitHub
  const fetchOpenIssues = useCallback(async () => {
    setIssuesLoading(true);
    try {
      const isAuthenticated = await invoke<boolean>("check_gh_auth");
      if (!isAuthenticated) {
        setOpenIssues([]);
        return;
      }
      const fetchedIssues = await invoke<GitHubIssue[]>("fetch_github_issues", {
        state: "open",
        limit: 50,
      });
      setOpenIssues(fetchedIssues);
    } catch (err) {
      console.error("Failed to fetch open issues:", err);
      setOpenIssues([]);
    } finally {
      setIssuesLoading(false);
    }
  }, []);

  // Get available issues (open issues not already selected)
  const availableIssues = useMemo(() => {
    const selectedNumbers = new Set(selectedIssues.map((i) => i.number));
    return openIssues.filter((issue) => !selectedNumbers.has(issue.number));
  }, [openIssues, selectedIssues]);

  // Version validation - must match semver-like pattern
  const isValidVersion = /^v?\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?$/.test(version);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      if (editingRelease) {
        setVersion(editingRelease.version);
        setSelectedIssues([...editingRelease.issues]);
      } else {
        setVersion(suggestedVersion ?? "");
        setSelectedIssues([]);
      }
      setError(null);
    }
  }, [isOpen, editingRelease, suggestedVersion]);

  // Fetch open issues when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchOpenIssues();
    }
  }, [isOpen, fetchOpenIssues]);

  // Handle escape key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Handle adding an issue to the release
  const handleAddIssue = (issueNumber: number, issueTitle: string) => {
    setSelectedIssues((prev) => [...prev, { number: issueNumber, title: issueTitle }]);
    setError(null);
  };

  // Handle removing an issue from the release
  const handleRemoveIssue = (issueNumber: number) => {
    setSelectedIssues((prev) => prev.filter((i) => i.number !== issueNumber));
  };

  // Handle save
  const handleSave = () => {
    if (!version.trim()) {
      setError("Version is required");
      return;
    }

    if (!isValidVersion) {
      setError("Please enter a valid version (e.g., v1.0, v1.0.0)");
      return;
    }

    if (selectedIssues.length === 0) {
      setError("Please select at least one issue");
      return;
    }

    onSave({
      version: version.trim(),
      status: editingRelease?.status || "active",
      issues: selectedIssues,
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="release-dialog-overlay"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="release-dialog" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="release-dialog-header">
          <h2 className="release-dialog-title">
            {isEditing ? `Edit Release ${editingRelease.version}` : "Create Release"}
          </h2>
          <button
            className="release-dialog-close"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 4L4 12M4 4L12 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="release-dialog-content">
          {/* Version Input */}
          <div className="release-dialog-field">
            <label className="release-dialog-label" htmlFor="release-version">
              Version <span className="release-dialog-required">*</span>
            </label>
            <input
              id="release-version"
              type="text"
              className={`release-dialog-input ${version && !isValidVersion ? "invalid" : ""}`}
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                setError(null);
              }}
              placeholder="v1.0.0"
              autoFocus
            />
            {version && !isValidVersion && (
              <p className="release-dialog-hint error">
                Please enter a valid version (e.g., v1.0, v1.0.0, v1.0.0-beta.1)
              </p>
            )}
          </div>

          {/* Issues in Release (Top List) */}
          <div className="release-dialog-field">
            <label className="release-dialog-label">
              Issues in Release ({selectedIssues.length})
            </label>
            <div className="release-dialog-issues-list release-dialog-issues-selected">
              {selectedIssues.length === 0 ? (
                <div className="release-dialog-issues-empty">
                  No issues selected. Add issues from the list below.
                </div>
              ) : (
                selectedIssues.map((issue) => (
                  <div key={issue.number} className="release-dialog-issue-item">
                    <span className="release-dialog-issue-number">#{issue.number}</span>
                    <span className="release-dialog-issue-title">{issue.title}</span>
                    <button
                      className="release-dialog-issue-btn release-dialog-issue-remove"
                      onClick={() => handleRemoveIssue(issue.number)}
                      type="button"
                      aria-label={`Remove issue #${issue.number}`}
                      title="Remove from release"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M10 4L4 10M4 4L10 10"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Available Issues (Bottom List) */}
          <div className="release-dialog-field">
            <label className="release-dialog-label">
              Available Issues ({availableIssues.length})
            </label>
            <div className="release-dialog-issues-list release-dialog-issues-available">
              {issuesLoading ? (
                <div className="release-dialog-issues-empty">Loading issues...</div>
              ) : availableIssues.length === 0 ? (
                <div className="release-dialog-issues-empty">
                  {openIssues.length === 0
                    ? "No open issues found"
                    : "All open issues are already added"}
                </div>
              ) : (
                availableIssues.map((issue) => (
                  <div key={issue.number} className="release-dialog-issue-item">
                    <span className="release-dialog-issue-number">#{issue.number}</span>
                    <span className="release-dialog-issue-title">{issue.title}</span>
                    <button
                      className="release-dialog-issue-btn release-dialog-issue-add"
                      onClick={() => handleAddIssue(issue.number, issue.title)}
                      type="button"
                      aria-label={`Add issue #${issue.number}`}
                      title="Add to release"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M7 3V11M3 7H11"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="release-dialog-error">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
                <path d="M9 5L5 9M5 5L9 9" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="release-dialog-footer">
          <button
            className="release-dialog-btn release-dialog-btn-cancel"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="release-dialog-btn release-dialog-btn-save"
            onClick={handleSave}
            type="button"
            disabled={!version.trim() || !isValidVersion || selectedIssues.length === 0}
          >
            {isEditing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
