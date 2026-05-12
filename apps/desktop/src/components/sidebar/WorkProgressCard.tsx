import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WorkContext, PhaseStatus, PipelineStep } from "../work/WorkCard";
import { useProjectsStore, useDetailStore } from "../../stores";
import { formatDuration, calculatePhaseDuration, calculateTotalDuration } from "../../utils/duration";
import { useElapsedTimer } from "../../hooks/useElapsedTimer";
import "./WorkProgressCard.css";

interface PlanPhase {
  number: number;
  title: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

/** Human-readable labels for pipeline steps (present tense) */
const STEP_DISPLAY_LABELS: Record<PipelineStep, string> = {
  GET: "Fetching",
  REVIEW: "Reviewing",
  PLAN: "Planning",
  AUDIT: "Auditing",
  EXECUTE: "Executing",
  SHIP: "Shipping",
};

interface WorkProgressCardProps {
  work: WorkContext;
  workId: string;
  isStale: boolean;
}

/**
 * Determines the status of a specific phase based on the current phase info
 */
function getPhaseSegmentStatus(
  phaseNumber: number,
  currentPhase: number,
  phaseStatus: PhaseStatus
): "completed" | "running" | "pending" | "failed" {
  if (phaseNumber < currentPhase) {
    return "completed";
  } else if (phaseNumber === currentPhase) {
    // Current phase - use the phase.status to determine if running or failed
    if (phaseStatus === "failed") return "failed";
    if (phaseStatus === "running" || phaseStatus === "executing") return "running";
    if (phaseStatus === "completed") return "completed";
    return "pending";
  } else {
    return "pending";
  }
}

export function WorkProgressCard({ work, workId, isStale }: WorkProgressCardProps) {
  const isIssue = work.type === "issue";
  const [planPhases, setPlanPhases] = useState<PlanPhase[]>([]);
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);
  const activeProject = useProjectsStore((state) => state.getActiveProject());
  const setSelectedIssue = useDetailStore((s) => s.setSelectedIssue);

  // Extract issue-specific fields with proper type narrowing
  const issueNumber = work.type === "issue" ? work.issue.number : undefined;
  const issueTitle = work.type === "issue" ? work.issue.title : undefined;

  // Clicking the card opens the issue (or release) in the detail panel.
  // Action buttons inside stop propagation so they don't trigger this.
  const handleCardClick = () => {
    if (isIssue && issueNumber !== undefined) {
      setSelectedIssue(issueNumber);
    }
  };

  // Stale work timestamp - use direct ternary to preserve discriminated union narrowing
  const activityTimestamp = work.type === 'issue' ? (work.lastActivity ?? work.createdAt) : work.createdAt;
  const staleHours = Math.floor((Date.now() - new Date(activityTimestamp).getTime()) / 3_600_000);

  async function handleAction(action: 'pause' | 'reset' | 'remove') {
    const tikiPath = activeProject?.path ? `${activeProject.path}/.tiki` : undefined;
    try {
      await invoke('update_work_status', { workId, action, tikiPath });
    } catch (e) {
      console.error('update_work_status failed:', e);
    }
  }

  // Get pipeline step and display label
  const pipelineStep = work.pipelineStep;
  const pipelineLabel = pipelineStep ? STEP_DISPLAY_LABELS[pipelineStep] : null;

  // For issues, get phase info
  const phase = isIssue ? work.phase : null;
  const totalPhases = phase?.total || 0;
  const currentPhase = phase?.current || 0;
  const phaseStatus = phase?.status || "pending";

  // Parallel execution info — present only when a multi-phase group is in flight
  const parallelExecution = isIssue ? work.parallelExecution : undefined;
  const isParallel = !!parallelExecution && parallelExecution.phases.length > 1;

  // Show phase progress when we have phases (during EXECUTE or any phase-based work)
  const showPhaseProgress = phase && totalPhases > 0;

  // Load plan for phase duration data
  useEffect(() => {
    if (!issueNumber || !showPhaseProgress) return;
    const tikiPath = activeProject?.path ? `${activeProject.path}/.tiki` : undefined;
    invoke<{ phases: PlanPhase[] } | null>("get_plan", { issueNumber, tikiPath })
      .then((plan) => setPlanPhases(plan?.phases ?? []))
      .catch(() => setPlanPhases([]));
  }, [issueNumber, showPhaseProgress, currentPhase, activeProject?.path]);

  // Find executing phase's startedAt for live timer
  const executingPhase = planPhases.find((p) => p.status === "executing");
  const liveTimer = useElapsedTimer(executingPhase?.startedAt ?? null);
  const totalDuration = planPhases.length > 0 ? calculateTotalDuration(planPhases) : 0;

  return (
    <div
      className={`work-progress-card status-${work.status}${isStale ? ' stale' : ''}${isIssue ? ' clickable' : ''}`}
      onClick={isIssue ? handleCardClick : undefined}
      role={isIssue ? 'button' : undefined}
      tabIndex={isIssue ? 0 : undefined}
      onKeyDown={isIssue ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      } : undefined}
    >
      <div className="work-progress-header">
        <span className="work-progress-type">{isIssue ? "Issue" : "Release"}</span>
        {isStale && (
          <span className="work-progress-stale-icon" title="Stale: no recent activity">
            &#9888;
          </span>
        )}
        <span className={`work-progress-status ${work.status}`}>
          {pipelineLabel || work.status}
        </span>
      </div>

      {isStale && (
        <div className="work-progress-stale-timestamp">last activity {staleHours}h ago</div>
      )}

      <div className="work-progress-title">
        {isIssue ? (
          <>
            <span className="work-progress-number">#{issueNumber}</span>
            <span className="work-progress-name">{issueTitle || `Issue #${issueNumber}`}</span>
          </>
        ) : (
          <span className="work-progress-version">{work.release.version}</span>
        )}
      </div>

      {/* Phase progress bar segments */}
      {showPhaseProgress && (
        <div className="work-progress-phases">
          <div className="phase-segments">
            {Array.from({ length: totalPhases }).map((_, index) => {
              const phaseNum = index + 1;
              const segmentStatus = getPhaseSegmentStatus(phaseNum, currentPhase, phaseStatus);
              const planPhase = planPhases.find((p) => p.number === phaseNum);
              const duration = planPhase
                ? calculatePhaseDuration(planPhase.startedAt ?? null, planPhase.completedAt ?? null)
                : null;
              const durationStr = duration !== null ? ` (${formatDuration(duration)})` : "";
              return (
                <div
                  key={phaseNum}
                  className={`phase-segment segment-${segmentStatus}`}
                  title={`Phase ${phaseNum}: ${segmentStatus}${durationStr}`}
                />
              );
            })}
          </div>
          <span className="work-progress-text">
            Phase {currentPhase}/{totalPhases}
            {isParallel && parallelExecution && (
              <span
                className="parallel-badge"
                title={`Phases ${parallelExecution.phases.join(", ")} running in parallel`}
              >
                parallel: {parallelExecution.phases.length}
              </span>
            )}
            {liveTimer && <span className="work-progress-timer"> {liveTimer}</span>}
            {!liveTimer && totalDuration > 0 && (
              <span className="work-progress-total-duration"> ({formatDuration(totalDuration)})</span>
            )}
          </span>
        </div>
      )}

      {!isIssue && (
        <div className="work-progress-release">
          <span>
            {work.release.completedIssues?.length ?? 0} / {work.release.issues.length} issues
          </span>
          {work.release.currentIssue && (
            <span className="work-progress-current">
              Working on #{work.release.currentIssue}
            </span>
          )}
        </div>
      )}

      {isIssue && !showConfirmRemove && (
        <div className="work-progress-actions">
          <button
            className="work-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleAction('pause');
            }}
            title="Pause this work item"
          >
            Pause
          </button>
          <button
            className="work-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleAction('reset');
            }}
            title="Reset to pending"
          >
            Reset
          </button>
          <button
            className="work-action-btn work-action-btn--danger"
            onClick={(e) => {
              e.stopPropagation();
              setShowConfirmRemove(true);
            }}
            title="Remove this work item"
          >
            Remove
          </button>
        </div>
      )}

      {showConfirmRemove && (
        <div className="work-progress-confirm-remove">
          <span>Remove this item?</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleAction('remove');
              setShowConfirmRemove(false);
            }}
          >
            Confirm
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowConfirmRemove(false);
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
