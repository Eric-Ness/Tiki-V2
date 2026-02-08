import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { Panel, Separator, Group } from "react-resizable-panels";
import { checkForAppUpdates } from "./utils/updater";
import { ProjectsSection } from "./components/sidebar/ProjectsSection";
import { IssuesSection } from "./components/sidebar/IssuesSection";
import { ReleasesSection } from "./components/sidebar/ReleasesSection";
import { StateSection } from "./components/sidebar/StateSection";
import { ClaudeUsageSection } from "./components/sidebar/ClaudeUsageSection";
import { TerminalPane } from "./components/terminal";
import { IssueDetail, ReleaseDetail, TikiReleaseDetail } from "./components/detail";
import { CenterTabs } from "./components/layout/CenterTabs";
import { KanbanBoard } from "./components/kanban";
import { SettingsPage } from "./components/settings";
import type { WorkContext } from "./components/work";
import { useLayoutStore, useDetailStore, useIssuesStore, useReleasesStore, useProjectsStore, useTikiReleasesStore, useTikiStateStore, useTerminalStore } from "./stores";
import type { GitHubIssue, TikiRelease } from "./stores";
import { terminalFocusRegistry } from "./stores/terminalStore";
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
  const [appVersion, setAppVersion] = useState<string>("");
  const panelSizes = useLayoutStore((s) => s.panelSizes);
  const activeView = useLayoutStore((s) => s.activeView);

  // Active project
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const activeProjectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';

  // Detail panel state (project-scoped)
  const selectedIssue = useDetailStore((s) => s.selectionByProject[activeProjectId]?.selectedIssue ?? null);
  const selectedRelease = useDetailStore((s) => s.selectionByProject[activeProjectId]?.selectedRelease ?? null);
  const selectedTikiRelease = useDetailStore((s) => s.selectionByProject[activeProjectId]?.selectedTikiRelease ?? null);
  const issues = useIssuesStore((s) => s.issues);
  const releases = useReleasesStore((s) => s.releases);
  const tikiReleases = useTikiReleasesStore((s) => s.releases);

  // Get the selected issue/release objects
  const [fetchedIssue, setFetchedIssue] = useState<GitHubIssue | null>(null);
  const issueFromStore = selectedIssue
    ? issues.find((i) => i.number === selectedIssue) ?? null
    : null;
  const selectedIssueData = issueFromStore ?? fetchedIssue;
  const selectedReleaseData = selectedRelease
    ? releases.find((r) => r.tagName === selectedRelease)
    : null;
  const selectedTikiReleaseData = selectedTikiRelease
    ? tikiReleases.find((r) => r.version === selectedTikiRelease)
    : null;

  // Fetch issue on demand when not found in store (e.g. completed/closed issues)
  useEffect(() => {
    if (!selectedIssue) {
      setFetchedIssue(null);
      return;
    }
    if (issueFromStore) {
      setFetchedIssue(null);
      return;
    }
    let cancelled = false;
    invoke<GitHubIssue>("fetch_github_issue_by_number", {
      number: selectedIssue,
      projectPath: activeProject?.path ?? null,
    })
      .then((issue) => { if (!cancelled) setFetchedIssue(issue); })
      .catch((err) => { console.error("Failed to fetch issue:", err); });
    return () => { cancelled = true; };
  }, [selectedIssue, issueFromStore, activeProject?.path]);

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
          // Refresh issues sidebar so completed/changed issues update
          useIssuesStore.getState().triggerRefetch();
        } catch (e) {
          console.error("Failed to reload state:", e);
        }
      } else if (event.payload.type === "releaseChanged") {
        try {
          const projectTikiPath = activeProject ? `${activeProject.path}\\.tiki` : undefined;
          const loadedReleases = await invoke<TikiRelease[]>("load_tiki_releases", { tikiPath: projectTikiPath });
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
        } else if (e.key === ',') {
          e.preventDefault();
          useLayoutStore.getState().setActiveView('settings');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch app version and check for updates on mount
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
    checkForAppUpdates(false);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>Tiki</h1>
          <span className="subtitle">GitHub Issue Workflow</span>
        </div>
        <div className="header-center">
          {activeProject && <span className="project-title">{activeProject.name}</span>}
        </div>
        <div className="header-right" />
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
              <ClaudeUsageSection />
            </div>
            <div className="sidebar-footer">
              <div className="sidebar-footer-actions">
              <button
                className="sidebar-settings-btn"
                onClick={() => useLayoutStore.getState().setActiveView('settings')}
                title="Settings (Ctrl+,)"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.5 1.5L6.8 3.1C6.1 3.4 5.5 3.8 5 4.3L3.5 3.7L2 6.3L3.3 7.3C3.2 7.5 3.2 7.7 3.2 8C3.2 8.3 3.2 8.5 3.3 8.7L2 9.7L3.5 12.3L5 11.7C5.5 12.2 6.1 12.6 6.8 12.9L6.5 14.5H9.5L9.2 12.9C9.9 12.6 10.5 12.2 11 11.7L12.5 12.3L14 9.7L12.7 8.7C12.8 8.5 12.8 8.3 12.8 8C12.8 7.7 12.8 7.5 12.7 7.3L14 6.3L12.5 3.7L11 4.3C10.5 3.8 9.9 3.4 9.2 3.1L9.5 1.5H6.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              </button>
              <button
                className="start-claude-btn"
                onClick={async () => {
                  const projectId = useProjectsStore.getState().activeProjectId ?? 'default';
                  const termState = useTerminalStore.getState();
                  const tabs = termState.tabsByProject[projectId] ?? [];
                  const activeTabId = termState.activeTabByProject[projectId] ?? null;
                  const activeTab = tabs.find((t) => t.id === activeTabId);
                  if (!activeTab) return;
                  try {
                    await invoke("write_terminal", {
                      id: activeTab.activeTerminalId,
                      data: "claude --dangerously-skip-permissions\n",
                    });
                    // Focus the terminal so Enter doesn't re-trigger the button
                    terminalFocusRegistry.focus(activeTab.activeTerminalId);
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
              <section className={`section terminal-section ${activeView !== 'settings' ? 'hidden' : ''}`}>
                <SettingsPage />
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
        {appVersion && <span className="app-version">v{appVersion}</span>}
        <button
          className="reset-layout-btn"
          onClick={() => checkForAppUpdates(true)}
          title="Check for updates"
        >
          Check for Updates
        </button>
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
