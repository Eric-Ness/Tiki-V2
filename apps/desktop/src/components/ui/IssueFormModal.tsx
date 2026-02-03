import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectsStore, useTikiReleasesStore, type GitHubIssue } from "../../stores";
import "./IssueFormModal.css";

interface LabelInfo {
  name: string;
  color: string;
}

type Priority = "high" | "medium" | "low" | null;
type BranchStrategy = "current" | "auto" | "custom";
type ModelType = "sonnet" | "opus" | "haiku";
type PlanningType = "skip" | "lite" | "spec" | "full";
type EnhancementType = "clarity" | "technical" | "simplify" | "acceptance";

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
  const [priority, setPriority] = useState<Priority>(null);
  const [branchStrategy, setBranchStrategy] = useState<BranchStrategy>("current");
  const [customBranch, setCustomBranch] = useState("");
  const [aiSettingsExpanded, setAiSettingsExpanded] = useState(false);
  const [aiModel, setAiModel] = useState<ModelType>("sonnet");
  const [planningType, setPlanningType] = useState<PlanningType>("full");
  const [runTests, setRunTests] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<string>("");
  const [enhanceDropdownOpen, setEnhanceDropdownOpen] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [currentBranchName, setCurrentBranchName] = useState<string | null>(null);
  const [loadingBranch, setLoadingBranch] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const enhanceDropdownRef = useRef<HTMLDivElement>(null);
  const originalLabels = useRef<string[]>([]);

  const activeProject = useProjectsStore((state) =>
    state.projects.find((p) => p.id === state.activeProjectId)
  );

  const tikiReleases = useTikiReleasesStore((state) => state.releases);
  const activeReleases = tikiReleases.filter((r) => r.status === "active");

  const isEditMode = !!editingIssue;

  // Fetch labels and current branch when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchLabels();
      fetchCurrentBranch();
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
      setPriority(null);
      setBranchStrategy("current");
      setCustomBranch("");
      setAiSettingsExpanded(false);
      setAiModel("sonnet");
      setPlanningType("full");
      setRunTests(false);
      setSelectedRelease("");
      setEnhanceDropdownOpen(false);
      setEnhancing(false);
      setCurrentBranchName(null);
      setLoadingBranch(false);
    }
  }, [isOpen, editingIssue]);

  // Auto-focus title input when modal opens
  useEffect(() => {
    if (isOpen && titleInputRef.current) {
      // Small delay to ensure modal is rendered
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close enhance dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        enhanceDropdownRef.current &&
        !enhanceDropdownRef.current.contains(event.target as Node)
      ) {
        setEnhanceDropdownOpen(false);
      }
    };

    if (enhanceDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [enhanceDropdownOpen]);

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

  const fetchCurrentBranch = async () => {
    if (!activeProject) {
      setCurrentBranchName(null);
      return;
    }

    setLoadingBranch(true);
    try {
      const branchName = await invoke<string>("get_current_branch", {
        projectPath: activeProject.path,
      });
      setCurrentBranchName(branchName);
    } catch (err) {
      console.error("Failed to fetch current branch:", err);
      setCurrentBranchName(null);
    } finally {
      setLoadingBranch(false);
    }
  };

  const toggleLabel = (labelName: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelName)
        ? prev.filter((l) => l !== labelName)
        : [...prev, labelName]
    );
  };

  const handleEnhanceDescription = async (type: EnhancementType) => {
    setEnhanceDropdownOpen(false);
    if (!body.trim()) {
      setError("Please add a description before enhancing");
      return;
    }
    setEnhancing(true);
    setError(null);
    try {
      const enhanced = await invoke<string>("enhance_issue_description", {
        description: body,
        enhancementType: type,
      });
      setBody(enhanced);
    } catch (err) {
      setError(String(err));
    } finally {
      setEnhancing(false);
    }
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
            <div className="issue-form-field-header">
              <label htmlFor="issue-body">Description</label>
              <div className="issue-form-enhance-wrapper" ref={enhanceDropdownRef}>
                <button
                  type="button"
                  className="issue-form-enhance-btn"
                  onClick={() => setEnhanceDropdownOpen(!enhanceDropdownOpen)}
                  disabled={loading || enhancing || !body.trim()}
                  aria-expanded={enhanceDropdownOpen}
                  aria-haspopup="menu"
                >
                  {enhancing ? (
                    <>
                      <span className="issue-form-spinner issue-form-spinner-small" />
                      Enhancing...
                    </>
                  ) : (
                    <>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M7 1L8.5 4.5L12 5L9.5 7.5L10 11L7 9.5L4 11L4.5 7.5L2 5L5.5 4.5L7 1Z"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Enhance with AI
                    </>
                  )}
                </button>
                {enhanceDropdownOpen && (
                  <div className="issue-form-enhance-dropdown" role="menu">
                    <button
                      type="button"
                      className="issue-form-enhance-option"
                      onClick={() => handleEnhanceDescription("clarity")}
                      role="menuitem"
                    >
                      <span className="issue-form-enhance-option-title">Improve clarity</span>
                      <span className="issue-form-enhance-option-desc">Make the description clearer and easier to understand</span>
                    </button>
                    <button
                      type="button"
                      className="issue-form-enhance-option"
                      onClick={() => handleEnhanceDescription("technical")}
                      role="menuitem"
                    >
                      <span className="issue-form-enhance-option-title">Add technical details</span>
                      <span className="issue-form-enhance-option-desc">Add implementation hints and technical context</span>
                    </button>
                    <button
                      type="button"
                      className="issue-form-enhance-option"
                      onClick={() => handleEnhanceDescription("simplify")}
                      role="menuitem"
                    >
                      <span className="issue-form-enhance-option-title">Simplify language</span>
                      <span className="issue-form-enhance-option-desc">Use simpler terms and reduce complexity</span>
                    </button>
                    <button
                      type="button"
                      className="issue-form-enhance-option"
                      onClick={() => handleEnhanceDescription("acceptance")}
                      role="menuitem"
                    >
                      <span className="issue-form-enhance-option-title">Add acceptance criteria</span>
                      <span className="issue-form-enhance-option-desc">Generate testable acceptance criteria</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
            <textarea
              id="issue-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe the issue..."
              disabled={loading || enhancing}
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

          <div className="issue-form-field">
            <label>Priority</label>
            <div className="issue-form-priority" role="group" aria-label="Issue priority">
              <button
                type="button"
                className={`issue-form-priority-btn issue-form-priority-high ${priority === "high" ? "selected" : ""}`}
                onClick={() => setPriority(priority === "high" ? null : "high")}
                disabled={loading}
                aria-pressed={priority === "high"}
              >
                High
              </button>
              <button
                type="button"
                className={`issue-form-priority-btn issue-form-priority-medium ${priority === "medium" ? "selected" : ""}`}
                onClick={() => setPriority(priority === "medium" ? null : "medium")}
                disabled={loading}
                aria-pressed={priority === "medium"}
              >
                Medium
              </button>
              <button
                type="button"
                className={`issue-form-priority-btn issue-form-priority-low ${priority === "low" ? "selected" : ""}`}
                onClick={() => setPriority(priority === "low" ? null : "low")}
                disabled={loading}
                aria-pressed={priority === "low"}
              >
                Low
              </button>
            </div>
          </div>

          <div className="issue-form-field">
            <label htmlFor="issue-branch">Branch</label>
            <select
              id="issue-branch"
              className="issue-form-select"
              value={branchStrategy}
              onChange={(e) => setBranchStrategy(e.target.value as BranchStrategy)}
              disabled={loading || loadingBranch}
            >
              <option value="current">
                {loadingBranch
                  ? "Loading..."
                  : currentBranchName
                  ? `Current (${currentBranchName})`
                  : "Current Branch"}
              </option>
              <option value="auto">Auto (create from issue)</option>
              <option value="custom">Custom</option>
            </select>
            {branchStrategy === "custom" && (
              <input
                type="text"
                className="issue-form-custom-branch"
                value={customBranch}
                onChange={(e) => setCustomBranch(e.target.value)}
                placeholder="feature/my-branch-name"
                disabled={loading}
              />
            )}
          </div>

          <div className="issue-form-field">
            <label htmlFor="issue-release">Add to Release</label>
            <select
              id="issue-release"
              className="issue-form-select"
              value={selectedRelease}
              onChange={(e) => setSelectedRelease(e.target.value)}
              disabled={loading}
            >
              <option value="">None</option>
              {activeReleases.map((release) => (
                <option key={release.version} value={release.version}>
                  {release.version}{release.name ? ` - ${release.name}` : ""}
                </option>
              ))}
            </select>
            {activeReleases.length === 0 && (
              <span className="issue-form-field-hint">
                No active releases available
              </span>
            )}
          </div>

          <div className="issue-form-collapsible">
            <button
              type="button"
              className="issue-form-collapsible-header"
              onClick={() => setAiSettingsExpanded(!aiSettingsExpanded)}
              aria-expanded={aiSettingsExpanded}
            >
              <svg
                className={`issue-form-collapsible-icon ${aiSettingsExpanded ? "expanded" : ""}`}
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M4 4.5L6 6.5L8 4.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>AI Execution Settings</span>
            </button>
            {aiSettingsExpanded && (
              <div className="issue-form-collapsible-content">
                <div className="issue-form-field">
                  <label htmlFor="ai-model">Model</label>
                  <select
                    id="ai-model"
                    className="issue-form-select"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value as ModelType)}
                    disabled={loading}
                  >
                    <option value="sonnet">Sonnet</option>
                    <option value="opus">Opus</option>
                    <option value="haiku">Haiku</option>
                  </select>
                </div>

                <div className="issue-form-field">
                  <label htmlFor="planning-type">Planning Type</label>
                  <select
                    id="planning-type"
                    className="issue-form-select"
                    value={planningType}
                    onChange={(e) => setPlanningType(e.target.value as PlanningType)}
                    disabled={loading}
                  >
                    <option value="full">Full (Recommended)</option>
                    <option value="spec">Spec</option>
                    <option value="lite">Lite</option>
                    <option value="skip">Skip</option>
                  </select>
                </div>

                <div className="issue-form-field issue-form-checkbox-field">
                  <label className="issue-form-checkbox-label">
                    <input
                      type="checkbox"
                      checked={runTests}
                      onChange={(e) => setRunTests(e.target.checked)}
                      disabled={loading}
                    />
                    <span>Run tests after execution</span>
                  </label>
                </div>
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
