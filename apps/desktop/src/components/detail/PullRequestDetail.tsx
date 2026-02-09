import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitHubPullRequest } from "../../stores";
import { useProjectsStore } from "../../stores";
import { MarkdownRenderer } from "./MarkdownRenderer";
import "./DetailPanel.css";

interface GitHubPrFile {
  path: string;
  additions: number;
  deletions: number;
}

interface GitHubPrReview {
  author: { login: string } | null;
  state: string;
  body: string | null;
}

interface GitHubPrDetailData {
  number: number;
  title: string;
  body: string | null;
  state: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft: boolean;
  reviewDecision: string | null;
  author: { login: string } | null;
  labels: Array<{ id: number; name: string; color: string; description: string | null }>;
  statusCheckRollup: Array<{
    context?: string;
    name?: string;
    state?: string;
    status?: string;
    conclusion?: string;
    detailsUrl?: string;
  }>;
  additions: number;
  deletions: number;
  commits: unknown;
  files: GitHubPrFile[];
  reviews: GitHubPrReview[];
}

interface PullRequestDetailProps {
  pr: GitHubPullRequest;
}

function getStateBadgeClass(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === "merged") return "pr-state-merged";
  if (normalized === "closed") return "pr-state-closed";
  return "pr-state-open";
}

function getStateBadgeLabel(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === "merged") return "Merged";
  if (normalized === "closed") return "Closed";
  return "Open";
}

function getReviewBadgeClass(decision: string): string {
  const normalized = decision.toUpperCase();
  if (normalized === "APPROVED") return "detail-review-badge--approved";
  if (normalized === "CHANGES_REQUESTED") return "detail-review-badge--changes-requested";
  return "detail-review-badge--review-required";
}

function getReviewLabel(decision: string): string {
  const normalized = decision.toUpperCase();
  if (normalized === "APPROVED") return "Approved";
  if (normalized === "CHANGES_REQUESTED") return "Changes Requested";
  return "Review Required";
}

function getCheckStatusIcon(check: GitHubPrDetailData["statusCheckRollup"][0]) {
  const conclusion = check.conclusion?.toUpperCase();
  const state = check.state?.toUpperCase();

  if (conclusion === "SUCCESS" || state === "SUCCESS") {
    return <span className="detail-check-icon detail-check-icon--success">&#10003;</span>;
  }
  if (conclusion === "FAILURE" || conclusion === "ERROR" || state === "FAILURE" || state === "ERROR") {
    return <span className="detail-check-icon detail-check-icon--failure">&#10005;</span>;
  }
  return <span className="detail-check-icon detail-check-icon--pending">&#9679;</span>;
}

function getCheckName(check: GitHubPrDetailData["statusCheckRollup"][0]): string {
  return check.name || check.context || "Unknown check";
}

export function PullRequestDetail({ pr }: PullRequestDetailProps) {
  const [detail, setDetail] = useState<GitHubPrDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeProject = useProjectsStore((state) => state.getActiveProject());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    invoke<GitHubPrDetailData>("fetch_github_pr_detail", {
      number: pr.number,
      projectPath: activeProject?.path ?? null,
    })
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pr.number, activeProject?.path]);

  const handleOpenInGitHub = () => {
    window.open(pr.url, "_blank");
  };

  // Use detail data when available, fall back to list data
  const state = detail?.state ?? pr.state;
  const reviewDecision = detail?.reviewDecision ?? pr.reviewDecision;
  const headRefName = detail?.headRefName ?? pr.headRefName;
  const baseRefName = detail?.baseRefName ?? pr.baseRefName;
  const body = detail?.body ?? pr.body;
  const isDraft = detail?.isDraft ?? pr.isDraft;

  return (
    <div className="detail-view">
      <div className="detail-header" style={{ borderLeftColor: "#a371f7" }}>
        <div className="detail-header-row">
          <span className="detail-issue-number" style={{ color: "#a371f7" }}>
            #{pr.number}
          </span>
          <span className={`detail-state-badge ${getStateBadgeClass(state)}`}>
            {getStateBadgeLabel(state)}
          </span>
          {isDraft && (
            <span className="detail-state-badge pr-state-draft">Draft</span>
          )}
        </div>
        <h2 className="detail-title">{pr.title}</h2>
      </div>

      {/* Branch Info */}
      <div className="detail-section">
        <h3 className="detail-section-title">Branch</h3>
        <div className="detail-branch-info">
          <code className="detail-branch-name">{headRefName}</code>
          <span className="detail-branch-arrow">&rarr;</span>
          <code className="detail-branch-name">{baseRefName}</code>
        </div>
      </div>

      {/* Review Decision */}
      {reviewDecision && (
        <div className="detail-section">
          <h3 className="detail-section-title">Review</h3>
          <span className={`detail-review-badge ${getReviewBadgeClass(reviewDecision)}`}>
            {getReviewLabel(reviewDecision)}
          </span>
        </div>
      )}

      {/* CI/Check Status */}
      {detail && detail.statusCheckRollup.length > 0 && (
        <div className="detail-section">
          <h3 className="detail-section-title">Checks</h3>
          <div className="detail-checks-list">
            {detail.statusCheckRollup.map((check, idx) => (
              <div key={idx} className="detail-check-item">
                {getCheckStatusIcon(check)}
                <span className="detail-check-name">{getCheckName(check)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* File Stats */}
      {detail && (
        <div className="detail-section">
          <h3 className="detail-section-title">Changes</h3>
          <div className="detail-file-stats">
            <span className="detail-file-stats-additions">+{detail.additions}</span>
            <span className="detail-file-stats-deletions">-{detail.deletions}</span>
            <span className="detail-file-stats-count">
              in {detail.files.length} {detail.files.length === 1 ? "file" : "files"}
            </span>
          </div>
        </div>
      )}

      {/* Loading indicator for detail */}
      {loading && (
        <div className="detail-section">
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px" }}>
            Loading details...
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="detail-section">
          <span style={{ color: "#f85149", fontSize: "12px" }}>
            Failed to load details: {error}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="detail-actions">
        <button className="detail-action-btn" onClick={handleOpenInGitHub}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Open in GitHub
        </button>
      </div>

      {/* Description */}
      {body && (
        <div className="detail-section detail-body-section">
          <h3 className="detail-section-title">Description</h3>
          <div className="detail-body markdown-body">
            <MarkdownRenderer>{body}</MarkdownRenderer>
          </div>
        </div>
      )}
    </div>
  );
}
