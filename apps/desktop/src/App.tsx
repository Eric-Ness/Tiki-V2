import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppLayout, Sidebar, MainContent, DetailPanel } from "./components/layout";
import { useLayoutStore } from "./stores";
import "./App.css";

// Types matching Rust state structures
interface IssueContext {
  type: "issue";
  issueNumber: number;
  title: string;
  status: "pending" | "executing" | "paused" | "completed" | "failed";
  currentPhase?: number;
  totalPhases?: number;
  startedAt: string;
  lastActivity?: string;
}

interface ReleaseContext {
  type: "release";
  version: string;
  issues: number[];
  status: "pending" | "executing" | "paused" | "completed" | "failed";
  currentIssue?: number;
  completedIssues: number[];
  startedAt: string;
  lastActivity?: string;
}

type WorkContext = IssueContext | ReleaseContext;

interface TikiState {
  schemaVersion: number;
  activeWork: Record<string, WorkContext>;
  history?: {
    lastCompletedIssue?: { number: number; completedAt: string };
    lastCompletedRelease?: { version: string; completedAt: string };
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
  const panelSizes = useLayoutStore((state) => state.panelSizes);

  // Load initial state
  useEffect(() => {
    async function loadState() {
      try {
        const path = await invoke<string>("get_tiki_path");
        setTikiPath(path);

        const currentState = await invoke<TikiState | null>("get_state", {});
        setState(currentState);
      } catch (e) {
        setError(String(e));
      }
    }

    loadState();
  }, []);

  // Listen for file changes
  useEffect(() => {
    const unlisten = listen<FileEvent>("tiki-file-changed", async (event) => {
      console.log("File changed:", event.payload);
      if (event.payload.type === "stateChanged") {
        try {
          const currentState = await invoke<TikiState | null>("get_state", {});
          setState(currentState);
        } catch (e) {
          console.error("Failed to reload state:", e);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const activeWorkEntries = state ? Object.entries(state.activeWork) : [];

  return (
    <div className="app">
      <header className="header">
        <h1>Tiki</h1>
        <span className="subtitle">GitHub Issue Workflow</span>
      </header>

      <AppLayout>
        <Sidebar defaultSize={panelSizes.sidebar} minSize={15}>
          <h3>Navigation</h3>
          <nav className="nav-list">
            <a href="#" className="nav-item active">Active Work</a>
            <a href="#" className="nav-item">History</a>
            <a href="#" className="nav-item">Settings</a>
          </nav>
        </Sidebar>

        <MainContent defaultSize={panelSizes.main} minSize={30}>
          <main className="main">
            <section className="section">
              <h2>Active Work</h2>
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

              {state && activeWorkEntries.length === 0 && (
                <div className="empty-state">
                  <p>No active work.</p>
                  <p className="hint">
                    Run <code>tiki:get #issue</code> to start working on an issue.
                  </p>
                </div>
              )}

              {activeWorkEntries.length > 0 && (
                <div className="work-list">
                  {activeWorkEntries.map(([key, work]) => (
                    <WorkCard key={key} work={work} />
                  ))}
                </div>
              )}
            </section>

            {state?.history && (
              <section className="section">
                <h2>Recent Activity</h2>
                <div className="history">
                  {state.history.lastCompletedIssue && (
                    <div className="history-item">
                      <span className="label">Last completed issue:</span>
                      <span className="value">
                        #{state.history.lastCompletedIssue.number}
                      </span>
                    </div>
                  )}
                  {state.history.lastCompletedRelease && (
                    <div className="history-item">
                      <span className="label">Last completed release:</span>
                      <span className="value">
                        {state.history.lastCompletedRelease.version}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}
          </main>
        </MainContent>

        <DetailPanel defaultSize={panelSizes.detail} minSize={15}>
          <h3>Details</h3>
          <p className="hint">Select an item to view details</p>
        </DetailPanel>
      </AppLayout>

      <footer className="footer">
        <span className="path">{tikiPath}</span>
        <button
          className="reset-layout-btn"
          onClick={() => useLayoutStore.getState().resetLayout()}
          title="Reset layout to defaults"
        >
          Reset Layout
        </button>
      </footer>
    </div>
  );
}

function WorkCard({ work }: { work: WorkContext }) {
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

export default App;
