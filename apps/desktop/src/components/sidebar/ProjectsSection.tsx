import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { ProjectCard } from "./ProjectCard";
import {
  useProjectsStore,
  useTerminalStore,
  useDetailStore,
  useKanbanStore,
  useToastStore,
  useLayoutStore,
} from "../../stores";
import { terminalFocusRegistry } from "../../stores/terminalStore";
import "./ProjectsSection.css";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve a specific project's active terminal id (getState() reads, not hooks).
 * After `setActiveProject`, TerminalPane auto-creates the project's initial tab
 * asynchronously, so this is wrapped in a short bounded retry by callers.
 */
function resolveActiveTerminalId(projectId: string): string | null {
  const termState = useTerminalStore.getState();
  const tabs = termState.tabsByProject[projectId] ?? [];
  const activeTabId = termState.activeTabByProject[projectId] ?? null;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  return activeTab?.activeTerminalId ?? null;
}

/**
 * Write a command to a SPECIFIC project's active terminal and focus it. Unlike
 * the generic `writeToActiveTerminal` in `useCommandActions.ts`, this targets a
 * project by id so the command can never land in a different project's terminal.
 * Polls a handful of times (~1s total) to let TerminalPane's auto-created initial
 * terminal appear after a project switch. Returns the terminal id on success, or
 * null if no terminal materializes within the retry window.
 */
async function writeToProjectTerminal(
  projectId: string,
  command: string
): Promise<string | null> {
  let terminalId: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    terminalId = resolveActiveTerminalId(projectId);
    if (terminalId) break;
    await sleep(200);
  }
  if (!terminalId) return null;

  try {
    await invoke("write_terminal", { id: terminalId, data: command });
    terminalFocusRegistry.focus(terminalId);
    return terminalId;
  } catch {
    return null;
  }
}

export function ProjectsSection() {
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const addProject = useProjectsStore((state) => state.addProject);
  const removeProject = useProjectsStore((state) => state.removeProject);
  const setActiveProject = useProjectsStore((state) => state.setActiveProject);
  const getActiveProject = useProjectsStore((state) => state.getActiveProject);
  const setProjectFrameworkVersion = useProjectsStore(
    (state) => state.setProjectFrameworkVersion
  );

  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const previousActiveIdRef = useRef<string | null>(null);

  // Switch file watcher and refresh framework version when active project changes
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

      // Read installed framework version and warn if outdated.
      // The bundled framework version equals the desktop binary version
      // (kept in lockstep by version-bump.mjs), so getVersion() is the truth.
      try {
        const [installed, bundled] = await Promise.all([
          invoke<string | null>("read_framework_version", {
            projectPath: activeProject.path,
          }),
          getVersion(),
        ]);
        const outdated = installed !== bundled;
        setProjectFrameworkVersion(activeProject.id, installed, outdated);
        if (outdated) {
          useToastStore
            .getState()
            .addToast(
              `Tiki framework outdated for ${activeProject.name} — click Update to install v${bundled}`,
              "warning",
              8000,
              {
                label: "Update",
                onClick: () => {
                  window.dispatchEvent(
                    new CustomEvent("tiki:install-framework", {
                      detail: { projectPath: activeProject.path },
                    })
                  );
                },
              }
            );
        }
      } catch (err) {
        console.error("Failed to read framework version:", err);
      }
    };

    switchWatcher();
  }, [activeProjectId, getActiveProject, setProjectFrameworkVersion]);

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

      // Extract folder name from path
      const pathParts = selectedPath.replace(/\\/g, "/").split("/");
      const folderName = pathParts[pathParts.length - 1] || "Unknown";

      // Check if project already exists (keep dedupe ahead of init)
      const existingProject = projects.find((p) => p.path === selectedPath);
      if (existingProject) {
        setError("This project has already been added");
        setIsAdding(false);
        return;
      }

      // Validate the directory contains .tiki
      const isValid = await invoke<boolean>("validate_tiki_directory", {
        path: selectedPath,
      });

      if (!isValid) {
        // Not a Tiki project yet — offer to initialize one here instead of
        // dead-ending. Matches the window.confirm convention used elsewhere.
        const confirmed = window.confirm(
          "This folder is not a Tiki project yet. Initialize Tiki here?"
        );

        if (!confirmed) {
          // User declined — cancel quietly, no error.
          setIsAdding(false);
          return;
        }

        try {
          setIsInitializing(true);
          // 1. Initialize the project (creates .tiki first); returns warnings.
          const warnings = await invoke<string[]>("init_tiki_project", {
            projectPath: selectedPath,
          });
          // 2. Switch the watcher — must come AFTER init since switch_project
          //    hard-requires .tiki to exist.
          await invoke("switch_project", { path: selectedPath });
          // 3. Add to the store and explicitly select the NEW project so it's
          //    highlighted and `activeProjectId` points at it. addProject's
          //    global rule only auto-selects when nothing is active, so when
          //    another project is already active we must select it here — both
          //    so the UI highlights it AND so the create-repo handoff below
          //    targets the new project's terminal (#297).
          addProject(selectedPath, folderName);
          const newProjectId = useProjectsStore
            .getState()
            .projects.find((p) => p.path === selectedPath)?.id;
          if (newProjectId) {
            setActiveProject(newProjectId);
          }

          // Surface any non-fatal init warnings as a toast.
          if (warnings.length > 0) {
            useToastStore
              .getState()
              .addToast(
                `Tiki initialized with warnings: ${warnings.join("; ")}`,
                "warning",
                8000
              );
          }

          // 4. Init creates a LOCAL git repo + .gitignore but NO GitHub remote.
          //    Proactively offer to create one so the user isn't left with
          //    "Not in a GitHub repository" banners and no guidance (#295).
          const createRepo = window.confirm(
            "Tiki initialized. Create a GitHub repo for this project now?"
          );
          if (createRepo) {
            // `gh repo create --source=. --remote=origin` creates the repo AND
            // wires `origin` in one shot. The gh command prompts for auth in the
            // terminal itself, so no auth preflight here. Hand off to the NEW
            // project's terminal *by id* — never a different (previously-active)
            // project's terminal (#297). setActiveProject above makes
            // TerminalPane auto-create that terminal asynchronously, so the
            // helper polls briefly for it to appear.
            const terminalId = newProjectId
              ? await writeToProjectTerminal(
                  newProjectId,
                  "gh repo create --source=. --remote=origin\n"
                )
              : null;
            if (terminalId === null) {
              useToastStore
                .getState()
                .addToast(
                  `Open a terminal in ${folderName}, then create the repo from Settings → readiness checklist`,
                  "warning",
                  8000
                );
            } else {
              useLayoutStore.getState().setActiveView("terminal");
            }
          }
        } catch (err) {
          // init is idempotent, so a retry is safe.
          setError(`Failed to initialize Tiki: ${String(err)}`);
        } finally {
          setIsInitializing(false);
        }
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
          disabled={isAdding || isInitializing}
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
          {isInitializing
            ? "Initializing..."
            : isAdding
              ? "Adding..."
              : "Add Project"}
        </button>
      </div>
    </CollapsibleSection>
  );
}
