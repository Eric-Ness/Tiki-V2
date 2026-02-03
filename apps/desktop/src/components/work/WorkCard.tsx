export type WorkStatus = "pending" | "planning" | "executing" | "paused" | "completed" | "failed" | "shipping";
export type PhaseStatus = "pending" | "running" | "executing" | "completed" | "failed";
export type PipelineStep = "GET" | "REVIEW" | "PLAN" | "AUDIT" | "EXECUTE" | "SHIP";

export interface PhaseInfo {
  total: number;
  current: number;
  status: PhaseStatus;
}

export interface IssueContext {
  type: "issue";
  issue: {
    number: number;
    title: string;
    url: string;
  };
  status: WorkStatus;
  pipelineStep?: PipelineStep;
  phase?: PhaseInfo;
  createdAt: string;
  lastActivity?: string;
  auditPassed?: boolean;
}

export interface ReleaseContext {
  type: "release";
  version: string;
  issues: number[];
  status: WorkStatus;
  pipelineStep?: PipelineStep;
  currentIssue?: number;
  completedIssues: number[];
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
            <span className="title">{work.issue.title}</span>
          </>
        ) : (
          <span className="version">{work.version}</span>
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
          </span>
        </div>
      )}

      {!isIssue && (
        <div className="release-progress">
          <span>
            {work.completedIssues.length} / {work.issues.length} issues
            completed
          </span>
          {work.currentIssue && (
            <span className="current">Working on #{work.currentIssue}</span>
          )}
        </div>
      )}
    </div>
  );
}
