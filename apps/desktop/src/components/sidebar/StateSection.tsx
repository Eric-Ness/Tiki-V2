import { CollapsibleSection } from "../ui/CollapsibleSection";
import { WorkProgressCard } from "./WorkProgressCard";
import type { WorkContext } from "../work/WorkCard";
import "./StateSection.css";

interface StateSectionProps {
  activeWork: Record<string, WorkContext>;
}

export function StateSection({ activeWork }: StateSectionProps) {
  const workEntries = Object.entries(activeWork);
  const activeCount = workEntries.length;

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
        {workEntries.length === 0 ? (
          <div className="state-section-empty" />
        ) : (
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
