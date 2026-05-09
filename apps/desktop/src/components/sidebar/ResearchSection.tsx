import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { useProjectsStore, useDetailStore } from "../../stores";
import { useResearchStore, type ResearchDocMeta } from "../../stores/researchStore";
import "./ResearchSection.css";

/** Format an ISO date string into a relative or short representation. */
function formatRelativeDate(iso: string): string {
  const created = new Date(iso);
  if (isNaN(created.getTime())) {
    // Fallback: take the YYYY-MM-DD prefix if present
    return iso.length >= 10 ? iso.slice(0, 10) : iso;
  }
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;
  // Older: show YYYY-MM-DD
  const y = created.getFullYear();
  const m = String(created.getMonth() + 1).padStart(2, "0");
  const d = String(created.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function ResearchSection() {
  const docs = useResearchStore((state) => state.docs);
  const isLoading = useResearchStore((state) => state.isLoading);
  const error = useResearchStore((state) => state.error);
  const setDocs = useResearchStore((state) => state.setDocs);
  const setLoading = useResearchStore((state) => state.setLoading);
  const setError = useResearchStore((state) => state.setError);
  const clearError = useResearchStore((state) => state.clearError);

  const activeProject = useProjectsStore((state) =>
    state.projects.find((p) => p.id === state.activeProjectId)
  );

  const projectId = useProjectsStore((state) => state.activeProjectId) ?? "default";
  const selectedResearchDoc = useDetailStore(
    (state) => state.selectionByProject[projectId]?.selectedResearchDoc ?? null
  );
  const setSelectedResearchDoc = useDetailStore((state) => state.setSelectedResearchDoc);

  const loadResearchDocs = useCallback(async () => {
    if (!activeProject) {
      setDocs([]);
      clearError();
      setLoading(false);
      return;
    }

    setLoading(true);
    clearError();

    try {
      const tikiPath = `${activeProject.path}/.tiki`;
      const loaded = await invoke<ResearchDocMeta[]>("list_research_docs", { tikiPath });
      setDocs(loaded);
    } catch (err) {
      setError(String(err));
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [activeProject, setDocs, setLoading, setError, clearError]);

  useEffect(() => {
    loadResearchDocs();
  }, [loadResearchDocs]);

  const researchIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 2H10C11.1046 2 12 2.89543 12 4V14L8 12L4 14V4C4 2.89543 4.89543 2 3 2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M3 2H4V14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M6 6H10M6 9H9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );

  const hasProject = !!activeProject;
  const totalCount = docs.length;

  return (
    <CollapsibleSection
      title="Research"
      icon={researchIcon}
      badge={totalCount > 0 ? totalCount : undefined}
      className="research-section"
    >
      <div className="research-section-content">
        {error && (
          <div className="research-section-error">
            <span>{error}</span>
            <button
              className="research-section-error-dismiss"
              onClick={clearError}
              type="button"
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}

        {isLoading && docs.length === 0 && (
          <div className="research-section-loading">
            <span className="research-section-spinner" />
            Loading...
          </div>
        )}

        {docs.length > 0 && (
          <div className="research-section-list">
            {docs.map((doc) => {
              const isSelected = selectedResearchDoc === doc.filename;
              return (
                <div
                  key={doc.filename}
                  className={`research-section-card${isSelected ? " selected" : ""}`}
                  onClick={() => setSelectedResearchDoc(doc.filename)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedResearchDoc(doc.filename);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                >
                  <div className="research-section-topic">{doc.topic}</div>
                  {doc.tags.length > 0 && (
                    <div className="research-section-tags">
                      {doc.tags.map((tag) => (
                        <span key={tag} className="research-section-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="research-section-date">{formatRelativeDate(doc.created)}</div>
                </div>
              );
            })}
          </div>
        )}

        {!hasProject && docs.length === 0 && !isLoading && (
          <div className="research-section-empty">
            Select a project to view research docs
          </div>
        )}

        {hasProject && !isLoading && !error && docs.length === 0 && (
          <div className="research-section-empty">
            No research docs yet. Use <code>/tiki:research &lt;topic&gt;</code> to capture knowledge.
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
