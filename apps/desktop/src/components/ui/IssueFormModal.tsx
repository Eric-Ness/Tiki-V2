import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectsStore, type GitHubIssue } from "../../stores";
import "./IssueFormModal.css";

interface LabelInfo {
  name: string;
  color: string;
}

interface IssueFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingIssue?: GitHubIssue | null;
}

export function IssueFormModal({
  isOpen,
  onClose,
  onSuccess,
  editingIssue,
}: IssueFormModalProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [availableLabels, setAvailableLabels] = useState<LabelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const originalLabels = useRef<string[]>([]);

  const activeProject = useProjectsStore((state) => state.activeProject);

  const isEditMode = !!editingIssue;

  // Fetch labels when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchLabels();
    }
  }, [isOpen]);

  // Reset/populate form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (editingIssue) {
        setTitle(editingIssue.title);
        setBody(editingIssue.body || "");
        const issueLabels = editingIssue.labels.map((l) => l.name);
        setSelectedLabels(issueLabels);
        originalLabels.current = issueLabels;
      } else {
        setTitle("");
        setBody("");
        setSelectedLabels([]);
        originalLabels.current = [];
      }
      setError(null);
      setTitleTouched(false);
    }
  }, [isOpen, editingIssue]);

  // Auto-focus title input when modal opens
  useEffect(() => {
    if (isOpen && titleInputRef.current) {
      // Small delay to ensure modal is rendered
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const fetchLabels = async () => {
    if (!activeProject) {
      setAvailableLabels([]);
      return;
    }

    setLoadingLabels(true);
    try {
      const labels = await invoke<LabelInfo[]>("fetch_github_labels", {
        projectPath: activeProject.path,
      });
      setAvailableLabels(labels);
    } catch (err) {
      console.error("Failed to fetch labels:", err);
      // Don't show error for labels - form can still work without them
    } finally {
      setLoadingLabels(false);
    }
  };

  const toggleLabel = (labelName: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelName)
        ? prev.filter((l) => l !== labelName)
        : [...prev, labelName]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (isEditMode && editingIssue) {
        // Calculate label changes
        const addLabels = selectedLabels.filter(
          (l) => !originalLabels.current.includes(l)
        );
        const removeLabels = originalLabels.current.filter(
          (l) => !selectedLabels.includes(l)
        );

        await invoke("edit_github_issue", {
          number: editingIssue.number,
          title: title.trim(),
          body: body.trim() || null,
          addLabels,
          removeLabels,
          projectPath: activeProject?.path,
        });
      } else {
        await invoke("create_github_issue", {
          title: title.trim(),
          body: body.trim() || null,
          labels: selectedLabels,
          projectPath: activeProject?.path,
        });
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    // Don't close if loading
    if (loading) return;
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't close if loading
    if (e.key === "Escape" && !loading) {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="issue-form-modal-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-form-title"
    >
      <div className="issue-form-modal">
        <div className="issue-form-modal-header">
          <h2 id="issue-form-title">
            {isEditMode ? `Edit Issue #${editingIssue?.number}` : "Create Issue"}
          </h2>
          <button
            className="issue-form-modal-close"
            onClick={onClose}
            type="button"
            aria-label="Close modal"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="issue-form-modal-form">
          <div className="issue-form-field">
            <label htmlFor="issue-title">Title *</label>
            <input
              ref={titleInputRef}
              id="issue-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTitleTouched(true)}
              placeholder="Issue title"
              disabled={loading}
              required
              aria-invalid={titleTouched && !title.trim()}
              aria-describedby={titleTouched && !title.trim() ? "title-error" : undefined}
              className={titleTouched && !title.trim() ? "invalid" : ""}
              maxLength={256}
            />
            {titleTouched && !title.trim() && (
              <span id="title-error" className="issue-form-field-error">
                Title is required
              </span>
            )}
          </div>

          <div className="issue-form-field">
            <label htmlFor="issue-body">Description</label>
            <textarea
              id="issue-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe the issue..."
              disabled={loading}
              rows={5}
            />
          </div>

          <div className="issue-form-field">
            <label>Labels</label>
            {loadingLabels ? (
              <div className="issue-form-labels-loading">Loading labels...</div>
            ) : availableLabels.length === 0 ? (
              <div className="issue-form-labels-empty">No labels available</div>
            ) : (
              <div className="issue-form-labels" role="group" aria-label="Issue labels">
                {availableLabels.map((label) => {
                  const isSelected = selectedLabels.includes(label.name);
                  return (
                    <button
                      key={label.name}
                      type="button"
                      className={`issue-form-label ${isSelected ? "selected" : ""}`}
                      onClick={() => toggleLabel(label.name)}
                      disabled={loading}
                      aria-pressed={isSelected}
                      aria-label={`${label.name} label${isSelected ? " (selected)" : ""}`}
                      style={{
                        "--label-color": `#${label.color}`,
                      } as React.CSSProperties}
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && <div className="issue-form-error">{error}</div>}

          <div className="issue-form-modal-footer">
            <button
              type="button"
              className="issue-form-btn issue-form-btn-cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="issue-form-btn issue-form-btn-submit"
              disabled={loading || !title.trim()}
            >
              {loading ? (
                <>
                  <span className="issue-form-spinner" />
                  {isEditMode ? "Saving..." : "Creating..."}
                </>
              ) : isEditMode ? (
                "Save Changes"
              ) : (
                "Create Issue"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
