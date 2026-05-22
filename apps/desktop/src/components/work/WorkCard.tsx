// The desktop consumes a TRIMMED/augmented shape of the canonical @tiki/shared
// work types (a smaller `issue`, an optional `lastActivity`, and a UI-only
// `auditPassed`). Rather than re-declaring them — which drifted before (#231) —
// these view models are DERIVED from shared via Pick/Omit, so a field rename or
// type change in shared becomes a compile error here (#237). Type-only imports
// → erased at build (no @tiki/shared at runtime).
import type {
  WorkStatus,
  PhaseStatus,
  PipelineStep,
  PipelineStepRecord,
  IssueWork,
  ReleaseWork,
  IssueInfo,
  PhaseProgress,
  ParallelExecution,
  ReleaseInfo,
} from "@tiki/shared";

// Re-export the canonical primitives/records so existing
// `import ... from "../work/WorkCard"` sites keep resolving.
export type { WorkStatus, PhaseStatus, PipelineStep, PipelineStepRecord, ReleaseInfo };

/** Phase progress — alias of the shared canonical shape. */
export type PhaseInfo = PhaseProgress;
/** Parallel-execution group tracking — alias of the shared canonical shape. */
export type ParallelExecutionInfo = ParallelExecution;

/**
 * Desktop view model: the shared IssueWork with a trimmed `issue` (the sidebar
 * only needs number/title/url), an optional `lastActivity`, and the UI-only
 * `auditPassed` flag. Everything else (status, pipelineStep, phase,
 * parallelExecution, parentRelease, …) tracks shared automatically.
 */
export type IssueContext = Omit<IssueWork, "issue" | "lastActivity"> & {
  issue: Pick<IssueInfo, "number" | "title" | "url">;
  lastActivity?: string;
  auditPassed?: boolean;
};

/** Desktop view model: the shared ReleaseWork with an optional `lastActivity`. */
export type ReleaseContext = Omit<ReleaseWork, "lastActivity"> & {
  lastActivity?: string;
};

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
