import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppLayout, Sidebar, MainContent, DetailPanel } from "./components/layout";
import { ProjectsSection } from "./components/sidebar/ProjectsSection";
import { IssuesSection } from "./components/sidebar/IssuesSection";
import { ReleasesSection } from "./components/sidebar/ReleasesSection";
import { StateSection } from "./components/sidebar/StateSection";
import { Terminal } from "./components/terminal/Terminal";
import type { WorkContext } from "./components/work";
import { useLayoutStore } from "./stores";
import "./App.css";

// Types matching Rust state structures
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

  const handleResetLayout = () => {
    useLayoutStore.getState().resetLayout();
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Tiki</h1>
        <span className="subtitle">GitHub Issue Workflow</span>
      </header>

      <AppLayout>
        <Sidebar defaultSize={panelSizes.sidebar} minSize={15}>
          <ProjectsSection />
          <IssuesSection />
          <ReleasesSection />

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

          {state && (
            <StateSection activeWork={state.activeWork} />
          )}
        </Sidebar>

        <MainContent defaultSize={panelSizes.main} minSize={30}>
          <main className="main">
            <section className="section terminal-section">
              <h2>Terminal</h2>
              <Terminal />
            </section>
          </main>
        </MainContent>

        <DetailPanel defaultSize={panelSizes.detail} minSize={15}>
          <h3>Recent Activity</h3>
          {state?.history ? (
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
          ) : (
            <p className="hint">No recent activity</p>
          )}
        </DetailPanel>
      </AppLayout>

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
