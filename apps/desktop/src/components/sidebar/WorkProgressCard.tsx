import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WorkContext, WorkStatus, PhaseStatus, PipelineStep } from "../work/WorkCard";
import {
  useProjectsStore,
  useDetailStore,
  useTerminalStore,
  useLayoutStore,
  useToastStore,
  EMPTY_TABS,
} from "../../stores";
import { resolveWorkTerminal, terminalFocusRegistry } from "../../stores/terminalStore";
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
    if (phaseStatus === "executing") return "running";
    if (phaseStatus === "completed" || phaseStatus === "skipped") return "completed";
    return "pending";
  } else {
    return "pending";
  }
}

type ResumeAction = { label: string; command: string };

/**
 * Derive the next-step action for an issue from its current pipeline state.
 * Returns null when no resume action is meaningful (e.g. completed). The
 * disable predicate at the call site additionally covers the live-executing
 * case so the button is rendered-but-disabled while a phase is in flight.
 */
function getResumeAction(
  status: WorkStatus,
  pipelineStep: PipelineStep | undefined,
  issueNumber: number
): ResumeAction | null {
  switch (status) {
    case "pending":
      return { label: "Start", command: `/tiki:get ${issueNumber}` };
    case "reviewing":
    case "planning":
      // Map by pipelineStep when present so AUDIT can resume into AUDIT correctly.
      if (pipelineStep === "AUDIT") return { label: "Continue Audit", command: `/tiki:audit ${issueNumber}` };
      return { label: "Continue Planning", command: `/tiki:plan ${issueNumber}` };
    case "executing":
    case "paused":
      return { label: "Resume", command: `/tiki:execute ${issueNumber}` };
    case "failed":
      // No stored last-command; pick by pipelineStep, fall back to execute.
      if (pipelineStep === "GET") return { label: "Retry", command: `/tiki:get ${issueNumber}` };
      if (pipelineStep === "PLAN") return { label: "Retry", command: `/tiki:plan ${issueNumber}` };
      if (pipelineStep === "AUDIT") return { label: "Retry", command: `/tiki:audit ${issueNumber}` };
      if (pipelineStep === "SHIP") return { label: "Retry Ship", command: `/tiki:ship ${issueNumber}` };
      return { label: "Retry", command: `/tiki:execute ${issueNumber}` };
    case "shipping":
      return { label: "Ship", command: `/tiki:ship ${issueNumber}` };
    case "completed":
      return null;
    default:
      return null;
  }
}

export function WorkProgressCard({ work, workId, isStale }: WorkProgressCardProps) {
  const isIssue = work.type === "issue";
  const [planPhases, setPlanPhases] = useState<PlanPhase[]>([]);
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);
  const activeProject = useProjectsStore((state) => state.getActiveProject());
  const activeProjectId = useProjectsStore((state) => state.activeProjectId) ?? "default";
  const setSelectedIssue = useDetailStore((s) => s.setSelectedIssue);
  // E7 Resume button — mirrors the IssueDetail "Jump to terminal" selectors
  // so the same terminal-association data backs both affordances.
  const projectTabs = useTerminalStore((s) => s.tabsByProject[activeProjectId] ?? EMPTY_TABS);
  const workTerminalMap = useTerminalStore(
    (s) => s.terminalByWorkIdByProject[activeProjectId]
  );

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

  // E7 Resume button — derive label/command from current pipeline state.
  // Pass issueNumber after the !== undefined guard so the helper can assume
  // a concrete number (avoids leaking the discriminated-union narrowing).
  const resumeAction =
    issueNumber !== undefined
      ? getResumeAction(work.status, pipelineStep, issueNumber)
      : null;
  // Disable while a phase is actively running — re-sending the command mid-phase
  // would queue a duplicate /tiki:execute behind the live one. PhaseStatus
  // "executing" represents an in-flight phase.
  const isActivelyRunning =
    work.status === "executing" && phaseStatus === "executing";
  const resumeDisabled = resumeAction === null || isActivelyRunning;

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (resumeDisabled || !resumeAction || issueNumber === undefined) return;

    // Switch view to Terminal regardless of association state.
    useLayoutStore.getState().setActiveView("terminal");

    const jumpTarget = resolveWorkTerminal(workTerminalMap, projectTabs, issueNumber);
    if (jumpTarget === null) {
      // No terminal associated yet — create a tab, record the association,
      // surface a toast. Skip the write this click: the PTY won't be ready
      // synchronously, and trying to time it adds fragility. Second click
      // resolves cleanly via the now-recorded association.
      const newTabId = useTerminalStore.getState().addTab();
      // Bind the freshly-created tab's terminal id from the store snapshot.
      const newTab = useTerminalStore
        .getState()
        .tabsByProject[activeProjectId]?.find((t) => t.id === newTabId);
      const newTerminalId = newTab?.activeTerminalId;
      if (newTerminalId) {
        useTerminalStore.getState().associateWorkTerminal(issueNumber, newTerminalId);
      }
      useToastStore.getState().addToast(
        `Opened a new terminal for issue #${issueNumber}. Click ${resumeAction.label} again to send the command.`,
        "info",
        5000,
      );
      return;
    }

    // Terminal already associated — activate the tab and write the command immediately.
    useTerminalStore.getState().setActiveTab(jumpTarget.tabId);
    try {
      await invoke("write_terminal", {
        id: jumpTarget.terminalId,
        data: `${resumeAction.command}\r`,
      });
    } catch (err) {
      console.error("write_terminal failed:", err);
    }
    terminalFocusRegistry.focus(jumpTarget.terminalId);
  };

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
          {resumeAction !== null && (
            <button
              type="button"
              className="work-action-btn work-action-btn--primary"
              onClick={handleResume}
              disabled={resumeDisabled}
              title={`Sends "${resumeAction.command}" to the issue's terminal`}
            >
              {resumeAction.label}
            </button>
          )}
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
