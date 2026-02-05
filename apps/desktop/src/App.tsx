import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Panel, Separator, Group } from "react-resizable-panels";
import { ProjectsSection } from "./components/sidebar/ProjectsSection";
import { IssuesSection } from "./components/sidebar/IssuesSection";
import { ReleasesSection } from "./components/sidebar/ReleasesSection";
import { StateSection } from "./components/sidebar/StateSection";
import { TerminalPane } from "./components/terminal";
import { IssueDetail, ReleaseDetail, TikiReleaseDetail } from "./components/detail";
import { CenterTabs } from "./components/layout/CenterTabs";
import { KanbanBoard } from "./components/kanban";
import type { WorkContext } from "./components/work";
import { useLayoutStore, useDetailStore, useIssuesStore, useReleasesStore, useProjectsStore, useTikiReleasesStore, useTikiStateStore, useTerminalStore } from "./stores";
import "./App.css";
import "./components/layout/layout.css";

// Types matching Rust state structures
interface TikiState {
  schemaVersion: number;
  activeWork: Record<string, WorkContext>;
  history?: {
    lastCompletedIssue?: { number: number; title?: string; completedAt: string };
    lastCompletedRelease?: { version: string; completedAt: string };
    recentIssues?: Array<{ number: number; title?: string; completedAt: string }>;
    recentReleases?: Array<{ version: string; issues?: number[]; completedAt: string; tag?: string }>;
  };
}

interface FileEvent {
  type: "stateChanged" | "planChanged" | "releaseChanged";
  issueNumber?: number;
  version?: string;
}

function App() {
  const [state, setState] = useState<TikiState | null>(null);
  const [tikiPath, setTikiPath] = useState<string>("");
  const [error, setError] = useState<string>("");
  const panelSizes = useLayoutStore((s) => s.panelSizes);
  const activeView = useLayoutStore((s) => s.activeView);

  // Detail panel state
  const selectedIssue = useDetailStore((s) => s.selectedIssue);
  const selectedRelease = useDetailStore((s) => s.selectedRelease);
  const selectedTikiRelease = useDetailStore((s) => s.selectedTikiRelease);
  const issues = useIssuesStore((s) => s.issues);
  const releases = useReleasesStore((s) => s.releases);
  const tikiReleases = useTikiReleasesStore((s) => s.releases);

  // Active project
  const activeProject = useProjectsStore((s) => s.getActiveProject());

  // Get the selected issue/release objects
  const selectedIssueData = selectedIssue
    ? issues.find((i) => i.number === selectedIssue)
    : null;
  const selectedReleaseData = selectedRelease
    ? releases.find((r) => r.tagName === selectedRelease)
    : null;
  const selectedTikiReleaseData = selectedTikiRelease
    ? tikiReleases.find((r) => r.version === selectedTikiRelease)
    : null;

  // Get work context for selected issue
  const selectedIssueWork = selectedIssue && state?.activeWork
    ? state.activeWork[`issue:${selectedIssue}`]
    : null;

  // Load initial state when active project changes
  useEffect(() => {
    async function loadState() {
      if (!activeProject) {
        // No active project, use default cwd-based path
        try {
          const path = await invoke<string>("get_tiki_path");
          setTikiPath(path);
          console.log("Tiki path (default):", path);

          const currentState = await invoke<TikiState | null>("get_state", {});
          console.log("State loaded:", currentState);
          setState(currentState);
          // Sync to tikiStateStore for Kanban
          if (currentState?.activeWork) {
            useTikiStateStore.getState().setActiveWork(currentState.activeWork);
          }
          // Sync recentIssues for Completed column
          useTikiStateStore.getState().setRecentIssues(currentState?.history?.recentIssues || []);
        } catch (e) {
          console.error("Error loading state:", e);
          setError(String(e));
        }
        return;
      }

      // Use the active project's .tiki path
      const projectTikiPath = `${activeProject.path}\\.tiki`;
      setTikiPath(projectTikiPath);
      console.log("Tiki path (project):", projectTikiPath);

      try {
        const currentState = await invoke<TikiState | null>("get_state", {
          tikiPath: projectTikiPath,
        });
        console.log("State loaded:", currentState);
        setState(currentState);
        // Sync to tikiStateStore for Kanban
        if (currentState?.activeWork) {
          useTikiStateStore.getState().setActiveWork(currentState.activeWork);
        }
        // Sync recentIssues for Completed column
        useTikiStateStore.getState().setRecentIssues(currentState?.history?.recentIssues || []);
      } catch (e) {
        console.error("Error loading state:", e);
        setError(String(e));
      }
    }

    loadState();
  }, [activeProject]);

  // Listen for file changes
  useEffect(() => {
    const unlisten = listen<FileEvent>("tiki-file-changed", async (event) => {
      console.log("File changed:", event.payload);
      if (event.payload.type === "stateChanged") {
        try {
          const projectTikiPath = activeProject ? `${activeProject.path}\\.tiki` : undefined;
          const currentState = await invoke<TikiState | null>("get_state", {
            tikiPath: projectTikiPath,
          });
          console.log("State reloaded, activeWork keys:", currentState?.activeWork ? Object.keys(currentState.activeWork) : 'none');
          setState(currentState);
          // Sync to tikiStateStore for Kanban
          if (currentState?.activeWork) {
            console.log("Syncing to tikiStateStore:", Object.entries(currentState.activeWork).map(([k, v]) => `${k}: ${v.status}`));
            useTikiStateStore.getState().setActiveWork(currentState.activeWork);
          }
          // Sync recentIssues for Completed column
          useTikiStateStore.getState().setRecentIssues(currentState?.history?.recentIssues || []);
        } catch (e) {
          console.error("Failed to reload state:", e);
        }
      } else if (event.payload.type === "releaseChanged") {
        try {
          const loadedReleases = await invoke<Array<{ version: string; status: string; issues: Array<{ number: number; title: string }>; createdAt: string }>>("load_tiki_releases");
          useTikiReleasesStore.getState().setReleases(loadedReleases);
        } catch (e) {
          console.error("Failed to reload releases:", e);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeProject]);

  const handleResetLayout = () => {
    useLayoutStore.getState().resetLayout();
  };

  // Keyboard shortcuts for view switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === '1') {
          e.preventDefault();
          useLayoutStore.getState().setActiveView('terminal');
        } else if (e.key === '2') {
          e.preventDefault();
          useLayoutStore.getState().setActiveView('kanban');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>Tiki</h1>
        <span className="subtitle">GitHub Issue Workflow</span>
      </header>

      <Group orientation="horizontal" className="app-layout">
        <Panel
          id="sidebar"
          defaultSize={panelSizes.sidebar}
          minSize={15}
          className="panel sidebar-panel"
        >
          <div className="sidebar-content">
            <div className="sidebar-sections">
              {/* Active Work at the top for visibility */}
              {state && (
                <StateSection activeWork={state.activeWork} />
              )}

              {error && <div className="error">{error}</div>}

              {!state && !error && (
                <div className="empty-state">
                  <p>No .tiki directory found.</p>
                  <p className="hint">
                    Run <code>tiki:get #issue</code> in Claude Code to start
                    tracking an issue.
                  </p>
                </div>
              )}

              <ProjectsSection />
              <IssuesSection />
              <ReleasesSection />
            </div>
            <div className="sidebar-footer">
              <button
                className="start-claude-btn"
                onClick={async () => {
                  const { tabs, activeTabId } = useTerminalStore.getState();
                  const activeTab = tabs.find((t) => t.id === activeTabId);
                  if (!activeTab) return;
                  try {
                    await invoke("write_terminal", {
                      id: activeTab.activeTerminalId,
                      data: "claude --dangerously-skip-permissions\n",
                    });
                  } catch (err) {
                    console.error("Failed to write to terminal:", err);
                  }
                }}
                title="Paste 'claude --dangerously-skip-permissions' into the active terminal"
              >
                Start Claude
              </button>
            </div>
          </div>
        </Panel>

        <Separator className="resize-handle" />

        <Panel
          id="main-content"
          defaultSize={panelSizes.main}
          minSize={30}
          className="panel main-content-panel"
        >
          <div className="main-content">
            <CenterTabs />
            <main className="main">
              <section className={`section terminal-section ${activeView !== 'terminal' ? 'hidden' : ''}`}>
                <TerminalPane />
              </section>
              <section className={`section terminal-section ${activeView !== 'kanban' ? 'hidden' : ''}`}>
                <KanbanBoard />
              </section>
            </main>
          </div>
        </Panel>

        <Separator className="resize-handle" />

        <Panel
          id="detail-panel"
          defaultSize={panelSizes.detail}
          minSize={15}
          className="panel detail-panel"
        >
          <div className="detail-content">
            {selectedIssueData ? (
              <IssueDetail issue={selectedIssueData} work={selectedIssueWork} />
            ) : selectedReleaseData ? (
              <ReleaseDetail release={selectedReleaseData} />
            ) : selectedTikiReleaseData ? (
              <TikiReleaseDetail release={selectedTikiReleaseData} />
            ) : (
              <>
                <h3>Detail</h3>
                <p className="hint">
                  Select an issue or release from the sidebar to view details
                </p>
              </>
            )}
          </div>
        </Panel>
      </Group>

      <footer className="footer">
        <span className="path">{tikiPath}</span>
        <button
          className="reset-layout-btn"
          onClick={handleResetLayout}
          title="Reset layout to defaults"
        >
          Reset Layout
        </button>
      </footer>
    </div>
  );
}

export default App;
