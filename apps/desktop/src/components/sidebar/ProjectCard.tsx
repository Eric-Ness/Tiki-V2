import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../../stores";
import { useProjectsStore, useToastStore } from "../../stores";
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
  const setProjectFrameworkVersion = useProjectsStore(
    (s) => s.setProjectFrameworkVersion
  );
  const [isInstalling, setIsInstalling] = useState(false);
  const isInstallingRef = useRef(false);

  const runInstall = async () => {
    if (isInstallingRef.current) return;
    isInstallingRef.current = true;
    setIsInstalling(true);
    try {
      const installed = await invoke<string>("install_framework", {
        projectPath: project.path,
      });
      setProjectFrameworkVersion(project.id, installed, false);
      useToastStore
        .getState()
        .addToast(`Framework updated to v${installed}`, "success", 4000);
    } catch (err) {
      useToastStore
        .getState()
        .addToast(`Framework update failed: ${err}`, "error", 8000);
    } finally {
      isInstallingRef.current = false;
      setIsInstalling(false);
    }
  };

  const handleInstallFramework = async (event: React.MouseEvent) => {
    event.stopPropagation();
    await runInstall();
  };

  // Listen for toast-action-triggered install requests targeting this project.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectPath: string }>).detail;
      if (detail?.projectPath === project.path) {
        void runInstall();
      }
    };
    window.addEventListener("tiki:install-framework", handler);
    return () => {
      window.removeEventListener("tiki:install-framework", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.path]);
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
      {project.frameworkOutdated && (
        <button
          className="project-card-update"
          onClick={handleInstallFramework}
          disabled={isInstalling}
          aria-label={`Update Tiki framework for ${project.name}`}
          title="Update Tiki framework files for this project"
          type="button"
        >
          {isInstalling ? "..." : "Update"}
        </button>
      )}
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
