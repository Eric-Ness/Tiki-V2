export interface IssueContext {
  type: "issue";
  issueNumber: number;
  title: string;
  status: "pending" | "executing" | "paused" | "completed" | "failed";
  currentPhase?: number;
  totalPhases?: number;
  startedAt: string;
  lastActivity?: string;
}

export interface ReleaseContext {
  type: "release";
  version: string;
  issues: number[];
  status: "pending" | "executing" | "paused" | "completed" | "failed";
  currentIssue?: number;
  completedIssues: number[];
  startedAt: string;
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
            <span className="issue-number">#{work.issueNumber}</span>
            <span className="title">{work.title}</span>
          </>
        ) : (
          <span className="version">{work.version}</span>
        )}
      </div>

      {isIssue && work.currentPhase && work.totalPhases && (
        <div className="progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(work.currentPhase / work.totalPhases) * 100}%` }}
            />
          </div>
          <span className="progress-text">
            Phase {work.currentPhase} of {work.totalPhases}
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
