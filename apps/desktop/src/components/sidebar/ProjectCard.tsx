import type { Project } from "../../stores";
import "./ProjectCard.css";

export interface ProjectCardProps {
  project: Project;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

export function ProjectCard({
  project,
  isActive,
  onSelect,
  onRemove,
}: ProjectCardProps) {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };

  const handleRemoveClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onRemove();
  };

  // Truncate path for display
  const truncatePath = (path: string, maxLength = 40) => {
    if (path.length <= maxLength) return path;
    return "..." + path.slice(-maxLength + 3);
  };

  return (
    <div
      className={`project-card ${isActive ? "active" : ""}`}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-pressed={isActive}
    >
      <div className="project-card-content">
        <div className="project-card-name">{project.name}</div>
        <div className="project-card-path" title={project.path}>
          {truncatePath(project.path)}
        </div>
      </div>
      <button
        className="project-card-remove"
        onClick={handleRemoveClick}
        aria-label={`Remove ${project.name}`}
        title="Remove project"
        type="button"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 3L11 11M3 11L11 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
