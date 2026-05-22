// Canonical status/pipeline unions live in @tiki/shared. Import them for local use AND
// re-export so the existing `import ... from "../work/WorkCard"` sites keep working,
// while @tiki/shared remains the single source of truth. Type-only → erased at build
// (no runtime import). Fixes prior PhaseStatus drift: the local copy was missing
// "skipped" and carried a non-canonical "running".
import type { WorkStatus, PhaseStatus, PipelineStep } from "@tiki/shared";
export type { WorkStatus, PhaseStatus, PipelineStep };

export interface PhaseInfo {
  total: number;
  current: number;
  status: PhaseStatus;
}

/**
 * Parallel execution tracking — present only when multiple phases are running concurrently.
 * When set, sub-agents are dispatched for each phase in `phases`; once all return, the
 * parent clears this field and advances to the next group.
 */
export interface ParallelExecutionInfo {
  /** Phase numbers currently running in parallel */
  phases: number[];
  /** Phase numbers in this group that have already completed */
  completedInGroup: number[];
  /** Total phases in this parallel group (for progress display) */
  totalInGroup: number;
  /** ISO timestamp when the group started */
  startedAt: string;
}

export interface PipelineStepRecord {
  step: PipelineStep;
  startedAt: string;
  completedAt?: string;
}

export interface IssueContext {
  type: "issue";
  issue: {
    number: number;
    title?: string;
    url?: string;
  };
  status: WorkStatus;
  pipelineStep?: PipelineStep;
  pipelineHistory?: PipelineStepRecord[];
  phase?: PhaseInfo;
  /** Set only while a multi-phase parallel group is in flight; cleared when group completes */
  parallelExecution?: ParallelExecutionInfo;
  createdAt: string;
  lastActivity?: string;
  auditPassed?: boolean;
  parentRelease?: string;
}

export interface ReleaseInfo {
  version: string;
  issues: number[];
  currentIssue?: number;
  completedIssues?: number[];
  milestone?: string;
}

export interface ReleaseContext {
  type: "release";
  release: ReleaseInfo;
  status: WorkStatus;
  pipelineStep?: PipelineStep;
  createdAt: string;
  lastActivity?: string;
}

export type WorkContext = IssueContext | ReleaseContext;

interface WorkCardProps {
  work: WorkContext;
}

export function WorkCard({ work }: WorkCardProps) {
  const isIssue = work.type === "issue";

  return (
    <div className={`work-card status-${work.status}`}>
      <div className="work-header">
        <span className="work-type">{isIssue ? "Issue" : "Release"}</span>
        <span className={`status-badge ${work.status}`}>{work.status}</span>
      </div>

      <div className="work-title">
        {isIssue ? (
          <>
            <span className="issue-number">#{work.issue.number}</span>
            <span className="title">{work.issue.title || `Issue #${work.issue.number}`}</span>
          </>
        ) : (
          <span className="version">{work.release.version}</span>
        )}
      </div>

      {isIssue && work.phase && work.phase.total > 0 && (
        <div className="progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(work.phase.current / work.phase.total) * 100}%` }}
            />
          </div>
          <span className="progress-text">
            Phase {work.phase.current} of {work.phase.total}
            {work.parallelExecution && work.parallelExecution.phases.length > 1 && (
              <span
                className="parallel-badge"
                title={`Phases ${work.parallelExecution.phases.join(", ")} running in parallel`}
              >
                parallel: {work.parallelExecution.phases.length}
              </span>
            )}
          </span>
        </div>
      )}

      {!isIssue && (
        <div className="release-progress">
          <span>
            {work.release.completedIssues?.length ?? 0} / {work.release.issues.length} issues
            completed
          </span>
          {work.release.currentIssue && (
            <span className="current">Working on #{work.release.currentIssue}</span>
          )}
        </div>
      )}
    </div>
  );
}
