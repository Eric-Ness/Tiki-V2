import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitHubIssue } from "../../stores";
import { useProjectsStore, useIssuesStore, usePullRequestsStore, useDetailStore } from "../../stores";
import type { PipelineStep } from "../work/WorkCard";
import { IssueComments } from "./IssueComments";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PipelineTimeline } from "./PipelineTimeline";
import { formatDuration, calculatePhaseDuration, calculateTotalDuration } from "../../utils/duration";
import { useElapsedTimer } from "../../hooks/useElapsedTimer";
import "./DetailPanel.css";

interface WorkContext {
  status: string;
  pipelineStep?: string;
  phase?: {
    current?: number;
    total?: number;
    status?: string;
  };
  createdAt?: string;
  lastActivity?: string;
}

interface PlanPhase {
  number: number;
  title: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  summary?: string | null;
}

interface TikiPlan {
  phases: PlanPhase[];
}

interface IssueDetailProps {
  issue: GitHubIssue;
  work?: WorkContext | null;
}

function PhaseItem({ phase }: { phase: PlanPhase }) {
  const duration = calculatePhaseDuration(phase.startedAt ?? null, phase.completedAt ?? null);
  const liveTimer = useElapsedTimer(
    phase.status === "executing" ? (phase.startedAt ?? null) : null
  );
  const statusClass =
    phase.status === "completed" ? "phase-status-completed" :
    phase.status === "executing" ? "phase-status-executing" :
    phase.status === "failed" ? "phase-status-failed" :
    "phase-status-pending";

  return (
    <div className={`detail-phase-item ${statusClass}`}>
      <span className="detail-phase-number">{phase.number}</span>
      <span className="detail-phase-title">{phase.title}</span>
      {duration !== null && (
        <span className="detail-phase-duration">{formatDuration(duration)}</span>
      )}
      {liveTimer !== null && (
        <span className="detail-phase-duration detail-phase-live">{liveTimer}</span>
      )}
    </div>
  );
}

const stateBadgeStyles: Record<string, string> = {
  open: "issue-state-open",
  closed: "issue-state-closed",
};

function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

function getPrStateBadgeClass(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === "merged") return "pr-state-merged";
  if (normalized === "closed") return "pr-state-closed";
  return "pr-state-open";
}

function getPrStateBadgeLabel(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === "merged") return "Merged";
  if (normalized === "closed") return "Closed";
  return "Open";
}

function getLinkedPrReviewBadgeClass(decision: string): string {
  const normalized = decision.toUpperCase();
  if (normalized === "APPROVED") return "detail-review-badge--approved";
  if (normalized === "CHANGES_REQUESTED") return "detail-review-badge--changes-requested";
  return "detail-review-badge--review-required";
}

function getLinkedPrReviewLabel(decision: string): string {
  const normalized = decision.toUpperCase();
  if (normalized === "APPROVED") return "Approved";
  if (normalized === "CHANGES_REQUESTED") return "Changes";
  return "Review";
}

export function IssueDetail({ issue, work }: IssueDetailProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeProject = useProjectsStore((state) => state.getActiveProject());
  const triggerRefetch = useIssuesStore((state) => state.triggerRefetch);
  const prs = usePullRequestsStore((state) => state.prs);
  const setSelectedPr = useDetailStore((state) => state.setSelectedPr);
  const [plan, setPlan] = useState<TikiPlan | null>(null);

  // Load plan data for phase duration display
  useEffect(() => {
    if (!work) {
      setPlan(null);
      return;
    }
    const tikiPath = activeProject?.path ? `${activeProject.path}/.tiki` : undefined;
    invoke<TikiPlan | null>("get_plan", { issueNumber: issue.number, tikiPath })
      .then((data) => setPlan(data ?? null))
      .catch(() => setPlan(null));
  }, [issue.number, work, activeProject?.path]);

  // Find PRs linked to this issue
  const linkedPrs = prs.filter((pr) => {
    const issueNum = String(issue.number);
    // Check body for linking keywords
    if (pr.body) {
      const bodyLower = pr.body.toLowerCase();
      const patterns = [
        `fixes #${issueNum}`,
        `closes #${issueNum}`,
        `resolves #${issueNum}`,
        `fix #${issueNum}`,
        `close #${issueNum}`,
        `resolve #${issueNum}`,
      ];
      if (patterns.some((p) => bodyLower.includes(p))) {
        return true;
      }
    }
    // Check branch name for issue number
    if (pr.headRefName.includes(issueNum)) {
      return true;
    }
    return false;
  });

  const normalizedState = issue.state.toLowerCase();
  const badgeClass = stateBadgeStyles[normalizedState] || stateBadgeStyles.open;
  const isClosed = normalizedState === "closed";

  const handleOpenInGitHub = () => {
    window.open(issue.url, "_blank");
  };

  const handleCloseIssue = async () => {
    if (!showConfirm) {
      setShowConfirm(true);
      setError(null);
      return;
    }

    setIsClosing(true);
    setError(null);
    try {
      await invoke("close_github_issue", {
        number: issue.number,
        projectPath: activeProject?.path,
      });
      setShowConfirm(false);
      triggerRefetch();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsClosing(false);
    }
  };

  const handleCancelClose = () => {
    setShowConfirm(false);
    setError(null);
  };

  return (
    <div className="detail-view">
      <div className="detail-header">
        <div className="detail-header-row">
          <span className="detail-issue-number">#{issue.number}</span>
          <span className={`detail-state-badge ${badgeClass}`}>
            {normalizedState === "open" ? "Open" : "Closed"}
          </span>
        </div>
        <h2 className="detail-title">{issue.title}</h2>
      </div>

      <div className="detail-actions">
        <button className="detail-action-btn" onClick={handleOpenInGitHub}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Open in GitHub
        </button>
        {!isClosed && (
          <>
            {showConfirm ? (
              <>
                <button
                  className="detail-action-btn detail-action-btn-danger"
                  onClick={handleCloseIssue}
                  disabled={isClosing}
                >
                  {isClosing ? "Closing..." : "Confirm Close"}
                </button>
                <button
                  className="detail-action-btn"
                  onClick={handleCancelClose}
                  disabled={isClosing}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="detail-action-btn detail-action-btn-danger"
                onClick={handleCloseIssue}
                title="Close this issue on GitHub"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z" />
                </svg>
                Close Issue
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <div className="detail-error" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 0" }}>
          {error}
        </div>
      )}

      {issue.labels.length > 0 && (
        <div className="detail-section">
          <h3 className="detail-section-title">Labels</h3>
          <div className="detail-labels">
            {issue.labels.map((label) => (
              <span
                key={label.id}
                className="detail-label"
                style={{
                  backgroundColor: `#${label.color}`,
                  color: getContrastColor(label.color),
                }}
                title={label.description || label.name}
              >
                {label.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {linkedPrs.length > 0 && (
        <div className="detail-section">
          <h3 className="detail-section-title">Linked Pull Requests</h3>
          <div className="detail-linked-prs">
            {linkedPrs.map((pr) => (
              <div
                key={pr.number}
                className="detail-linked-pr-card"
                onClick={() => setSelectedPr(pr.number)}
              >
                <span className="detail-linked-pr-number">#{pr.number}</span>
                <span className="detail-linked-pr-title">{pr.title}</span>
                <div className="detail-linked-pr-badges">
                  <span className={`detail-linked-pr-state ${getPrStateBadgeClass(pr.state)}`}>
                    {getPrStateBadgeLabel(pr.state)}
                  </span>
                  {pr.reviewDecision && (
                    <span className={`detail-linked-pr-review ${getLinkedPrReviewBadgeClass(pr.reviewDecision)}`}>
                      {getLinkedPrReviewLabel(pr.reviewDecision)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {work && (
        <div className="detail-section">
          <h3 className="detail-section-title">Pipeline Progress</h3>
          <PipelineTimeline
            currentStep={work.pipelineStep as PipelineStep | undefined}
            workStatus={work.status}
            createdAt={work.createdAt}
            lastActivity={work.lastActivity}
          />
          {work.phase && work.phase.current && work.phase.total && (
            <div className="detail-workflow-phase">
              <div className="detail-workflow-phase-header">
                <span className="detail-workflow-label">Phase Progress</span>
                <span className="detail-workflow-phase-count">
                  {work.phase.current} / {work.phase.total}
                  {plan && plan.phases.length > 0 && (() => {
                    const total = calculateTotalDuration(plan.phases);
                    return total > 0 ? (
                      <span className="detail-phase-total-duration"> ({formatDuration(total)} total)</span>
                    ) : null;
                  })()}
                </span>
              </div>
              <div className="detail-workflow-phase-bar">
                <div
                  className="detail-workflow-phase-fill"
                  style={{ width: `${(work.phase.current / work.phase.total) * 100}%` }}
                />
              </div>
              {plan && plan.phases.length > 0 && (
                <div className="detail-phase-list">
                  {plan.phases.map((phase) => (
                    <PhaseItem key={phase.number} phase={phase} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {issue.body && (
        <div className="detail-section detail-body-section">
          <h3 className="detail-section-title">Description</h3>
          <div className="detail-body markdown-body">
            <MarkdownRenderer>{issue.body}</MarkdownRenderer>
          </div>
        </div>
      )}

      <IssueComments issueNumber={issue.number} />
    </div>
  );
}
