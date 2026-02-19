import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WorkContext, PhaseStatus, PipelineStep } from "../work/WorkCard";
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

export function WorkProgressCard({ work }: WorkProgressCardProps) {
  const isIssue = work.type === "issue";
  const [planPhases, setPlanPhases] = useState<PlanPhase[]>([]);

  // Extract issue-specific fields with proper type narrowing
  const issueNumber = work.type === "issue" ? work.issue.number : undefined;
  const issueTitle = work.type === "issue" ? work.issue.title : undefined;

  // Get pipeline step and display label
  const pipelineStep = work.pipelineStep;
  const pipelineLabel = pipelineStep ? STEP_DISPLAY_LABELS[pipelineStep] : null;

  // For issues, get phase info
  const phase = isIssue ? work.phase : null;
  const totalPhases = phase?.total || 0;
  const currentPhase = phase?.current || 0;
  const phaseStatus = phase?.status || "pending";

  // Show phase progress when we have phases (during EXECUTE or any phase-based work)
  const showPhaseProgress = phase && totalPhases > 0;

  // Load plan for phase duration data
  useEffect(() => {
    if (!issueNumber || !showPhaseProgress) return;
    invoke<{ phases: PlanPhase[] } | null>("get_plan", { issueNumber })
      .then((plan) => setPlanPhases(plan?.phases ?? []))
      .catch(() => setPlanPhases([]));
  }, [issueNumber, showPhaseProgress, currentPhase]);

  // Find executing phase's startedAt for live timer
  const executingPhase = planPhases.find((p) => p.status === "executing");
  const liveTimer = useElapsedTimer(executingPhase?.startedAt ?? null);
  const totalDuration = planPhases.length > 0 ? calculateTotalDuration(planPhases) : 0;

  return (
    <div className={`work-progress-card status-${work.status}`}>
      <div className="work-progress-header">
        <span className="work-progress-type">{isIssue ? "Issue" : "Release"}</span>
        <span className={`work-progress-status ${work.status}`}>
          {pipelineLabel || work.status}
        </span>
      </div>

      <div className="work-progress-title">
        {isIssue ? (
          <>
            <span className="work-progress-number">#{issueNumber}</span>
            <span className="work-progress-name">{issueTitle || `Issue #${issueNumber}`}</span>
          </>
        ) : (
          <span className="work-progress-version">{work.version}</span>
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
            {work.completedIssues.length} / {work.issues.length} issues
          </span>
          {work.currentIssue && (
            <span className="work-progress-current">
              Working on #{work.currentIssue}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
