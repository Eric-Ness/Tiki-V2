import { useState, useEffect } from "react";
import type { WorkContext } from "../work/WorkCard";
import "./WorkProgressCard.css";

interface WorkProgressCardProps {
  work: WorkContext;
}

/**
 * Formats a timestamp as a relative time string
 * e.g., "just now", "5m ago", "2h ago", "3d ago"
 */
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "just now";
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else {
    return `${days}d ago`;
  }
}

export function WorkProgressCard({ work }: WorkProgressCardProps) {
  // Force re-render every 30 seconds to update relative timestamps
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const isIssue = work.type === "issue";

  // Calculate progress percentage for issues
  const progressPercent =
    isIssue && work.currentPhase && work.totalPhases
      ? (work.currentPhase / work.totalPhases) * 100
      : 0;

  // Get the timestamp to display (prefer lastActivity, fall back to startedAt)
  const timestamp = work.lastActivity || work.startedAt;

  return (
    <div className={`work-progress-card status-${work.status}`}>
      <div className="work-progress-header">
        <span className="work-progress-type">{isIssue ? "Issue" : "Release"}</span>
        <span className={`work-progress-status ${work.status}`}>{work.status}</span>
      </div>

      <div className="work-progress-title">
        {isIssue ? (
          <>
            <span className="work-progress-number">#{work.issueNumber}</span>
            <span className="work-progress-name">{work.title}</span>
          </>
        ) : (
          <span className="work-progress-version">{work.version}</span>
        )}
      </div>

      {isIssue && work.currentPhase && work.totalPhases && (
        <div className="work-progress-bar-container">
          <div className="work-progress-bar">
            <div
              className="work-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="work-progress-text">
            Phase {work.currentPhase} of {work.totalPhases}
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

      <div className="work-progress-timestamp">
        {formatRelativeTime(timestamp)}
      </div>
    </div>
  );
}
