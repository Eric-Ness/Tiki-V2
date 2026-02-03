import { CollapsibleSection } from "../ui/CollapsibleSection";
import { WorkProgressCard } from "./WorkProgressCard";
import type { WorkContext, WorkStatus } from "../work/WorkCard";
import "./StateSection.css";

interface StateSectionProps {
  activeWork: Record<string, WorkContext>;
}

/**
 * Determines if a work status indicates active/busy state
 */
function isActiveStatus(status: WorkStatus): boolean {
  return status === "executing" || status === "planning" || status === "shipping";
}

/**
 * Gets the overall system status based on all active work
 */
function getGlobalStatus(workEntries: [string, WorkContext][]): {
  label: string;
  status: "idle" | "busy" | "paused" | "failed";
} {
  if (workEntries.length === 0) {
    return { label: "Idle", status: "idle" };
  }

  const hasExecuting = workEntries.some(([, work]) => isActiveStatus(work.status));
  const hasFailed = workEntries.some(([, work]) => work.status === "failed");
  const hasPaused = workEntries.some(([, work]) => work.status === "paused");

  if (hasFailed) {
    return { label: "Failed", status: "failed" };
  }
  if (hasExecuting) {
    return { label: "Busy", status: "busy" };
  }
  if (hasPaused) {
    return { label: "Paused", status: "paused" };
  }
  return { label: "Idle", status: "idle" };
}

export function StateSection({ activeWork }: StateSectionProps) {
  const workEntries = Object.entries(activeWork);
  const activeCount = workEntries.length;
  const globalStatus = getGlobalStatus(workEntries);

  const stateIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 8H4L5.5 4L7.5 12L9.5 6L11 8H14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <CollapsibleSection
      title="Active Work"
      icon={stateIcon}
      badge={activeCount > 0 ? activeCount : undefined}
      className="state-section"
    >
      <div className="state-section-content">
        {/* Global Status Indicator */}
        <div className="global-status-indicator">
          <span className={`status-dot status-${globalStatus.status}`} />
          <span className="status-label">{globalStatus.label}</span>
        </div>

        {workEntries.length > 0 && (
          <div className="state-section-list">
            {workEntries.map(([key, work]) => (
              <WorkProgressCard key={key} work={work} />
            ))}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
