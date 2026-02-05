import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { ProjectCard } from "./ProjectCard";
import { useProjectsStore, useTerminalStore, useDetailStore, useKanbanStore } from "../../stores";
import "./ProjectsSection.css";

export function ProjectsSection() {
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const addProject = useProjectsStore((state) => state.addProject);
  const removeProject = useProjectsStore((state) => state.removeProject);
  const setActiveProject = useProjectsStore((state) => state.setActiveProject);
  const getActiveProject = useProjectsStore((state) => state.getActiveProject);

  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const previousActiveIdRef = useRef<string | null>(null);

  // Switch file watcher when active project changes
  useEffect(() => {
    const switchWatcher = async () => {
      // Skip on initial mount or if no change
      if (previousActiveIdRef.current === activeProjectId) {
        return;
      }
      previousActiveIdRef.current = activeProjectId;

      const activeProject = getActiveProject();
      if (!activeProject) {
        return;
      }

      try {
        await invoke("switch_project", { path: activeProject.path });
        console.log("Switched to project:", activeProject.name);
      } catch (err) {
        console.error("Failed to switch project watcher:", err);
        // Don't show error to user - watcher issues shouldn't block UI
      }
    };

    switchWatcher();
  }, [activeProjectId, getActiveProject]);

  const handleAddProject = async () => {
    setError(null);
    setIsAdding(true);

    try {
      // Open native folder picker
      const selectedPath = await invoke<string | null>("select_project_directory");

      if (!selectedPath) {
        // User cancelled
        setIsAdding(false);
        return;
      }

      // Validate the directory contains .tiki
      const isValid = await invoke<boolean>("validate_tiki_directory", {
        path: selectedPath,
      });

      if (!isValid) {
        setError("Selected folder is not a valid Tiki project (no .tiki directory found)");
        setIsAdding(false);
        return;
      }

      // Extract folder name from path
      const pathParts = selectedPath.replace(/\\/g, "/").split("/");
      const folderName = pathParts[pathParts.length - 1] || "Unknown";

      // Check if project already exists
      const existingProject = projects.find((p) => p.path === selectedPath);
      if (existingProject) {
        setError("This project has already been added");
        setIsAdding(false);
        return;
      }

      // Add to store
      addProject(selectedPath, folderName);
    } catch (err) {
      setError(`Failed to add project: ${String(err)}`);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveProject = (projectId: string, projectName: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to remove "${projectName}" from the list?\n\nThis will not delete any files.`
    );

    if (confirmed) {
      removeProject(projectId);
      // Clean up project-scoped state from all stores
      useTerminalStore.getState().cleanupProject(projectId);
      useDetailStore.getState().cleanupProject(projectId);
      useKanbanStore.getState().cleanupProject(projectId);
      setError(null);
    }
  };

  const handleSelectProject = (projectId: string) => {
    setActiveProject(projectId);
    setError(null);
  };

  const projectIcon = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 4C2 3.44772 2.44772 3 3 3H6.17157C6.43679 3 6.69114 3.10536 6.87868 3.29289L7.70711 4.12132C7.89464 4.30886 8.149 4.41421 8.41421 4.41421H13C13.5523 4.41421 14 4.86193 14 5.41421V12C14 12.5523 13.5523 13 13 13H3C2.44772 13 2 12.5523 2 12V4Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <CollapsibleSection
      title="Projects"
      icon={projectIcon}
      badge={projects.length > 0 ? projects.length : undefined}
      className="projects-section"
    >
      <div className="projects-section-content">
        {error && (
          <div className="projects-section-error">
            <span>{error}</span>
            <button
              className="projects-section-error-dismiss"
              onClick={() => setError(null)}
              type="button"
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="projects-section-empty">
            No projects added yet
          </div>
        ) : (
          <div className="projects-section-list">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                isActive={project.id === activeProjectId}
                onSelect={() => handleSelectProject(project.id)}
                onRemove={() => handleRemoveProject(project.id, project.name)}
              />
            ))}
          </div>
        )}

        <button
          className="projects-section-add"
          onClick={handleAddProject}
          disabled={isAdding}
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
              d="M7 2V12M2 7H12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          {isAdding ? "Adding..." : "Add Project"}
        </button>
      </div>
    </CollapsibleSection>
  );
}
