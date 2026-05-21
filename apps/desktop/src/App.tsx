import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { Panel, Separator, Group } from "react-resizable-panels";
import { MotionConfig } from "framer-motion";
import { checkForAppUpdates } from "./utils/updater";
import { ProjectsSection } from "./components/sidebar/ProjectsSection";
import { IssuesSection } from "./components/sidebar/IssuesSection";
import { PullRequestsSection } from "./components/sidebar/PullRequestsSection";
import { ReleasesSection } from "./components/sidebar/ReleasesSection";
import { ResearchSection } from "./components/sidebar/ResearchSection";
import { StateSection } from "./components/sidebar/StateSection";
import { ClaudeUsageSection } from "./components/sidebar/ClaudeUsageSection";
import { TerminalPane } from "./components/terminal";
import { IssueDetail, PullRequestDetail, ReleaseDetail, ResearchDetail, TikiReleaseDetail, DetailEmptyState } from "./components/detail";
import { CenterTabs } from "./components/layout/CenterTabs";
import { KanbanBoard } from "./components/kanban";
import { DependencyGraph } from "./components/dependencies/DependencyGraph";
import { SettingsPage } from "./components/settings";
import { ToastContainer } from "./components/ui/ToastContainer";
import { BulkActionToolbar } from "./components/BulkActionToolbar";
import { BulkYoloDialog } from "./components/BulkYoloDialog";
import { CommandPalette, ErrorBoundary, KeyboardShortcuts } from "./components/ui";
import { useCommandActions, useStaleWorkDetection } from "./hooks";
import { StateRecoveryDialog } from "./components/recovery";
import type { WorkContext } from "./components/work";
import { useLayoutStore, useDetailStore, useIssuesStore, useReleasesStore, useProjectsStore, useTikiReleasesStore, useTikiStateStore, useTerminalStore, useToastStore, usePullRequestsStore, useCommandPaletteStore, useResearchStore, useSettingsStore, useBulkYoloStore, type CompletedRelease } from "./stores";
import type { GitHubIssue, ResearchDocMeta, TikiRelease } from "./stores";
import { terminalFocusRegistry } from "./stores/terminalStore";
import { detectGithubRefreshTriggers } from "./utils/githubRefreshTriggers";
import { dispatchNextBulkYolo } from "./utils/bulkYoloDispatch";
import "./App.css";
import "./components/layout/layout.css";

// Per-surface trailing-edge debounce for GitHub re-fetches triggered by
// state.json transitions. The watcher already coalesces filesystem-level
// events, but logical events (e.g. shipping a 5-issue release writes
// state.json many times in quick succession) still produce N triggers per
// surface. 500ms trailing-edge collapses that to one fetch per surface.
type RefreshSurface = 'issues' | 'prs' | 'releases';
const pendingRefreshTriggers: Map<RefreshSurface, ReturnType<typeof setTimeout>> = new Map();
const REFRESH_DEBOUNCE_MS = 500;

function scheduleRefresh(surface: RefreshSurface, fire: () => void): void {
  const existing = pendingRefreshTriggers.get(surface);
  if (existing) clearTimeout(existing);
  pendingRefreshTriggers.set(
    surface,
    setTimeout(() => {
      pendingRefreshTriggers.delete(surface);
      fire();
    }, REFRESH_DEBOUNCE_MS),
  );
}

// Stable empty-fallback constants. Prevent fresh-object allocations in
// hook arguments that would otherwise trigger infinite re-render loops
// via useEffect dep instability (same bug class as #210 — see #212).
const EMPTY_ACTIVE_WORK: Record<string, WorkContext> = {};
const EMPTY_RECENT_ISSUES: Array<{ number: number; title?: string; completedAt: string }> = [];
const EMPTY_RECENT_RELEASES: CompletedRelease[] = [];

// Normalize raw history.recentReleases (where `issues` may be absent) into the
// store's CompletedRelease shape (`issues: number[]`). Returns the stable
// EMPTY_RECENT_RELEASES const when there is nothing, so consumers never see a
// fresh empty-array ref (same fresh-ref bug class as #210/#212).
function normalizeRecentReleases(
  raw: Array<{ version: string; issues?: number[]; completedAt: string; tag?: string }> | undefined,
): CompletedRelease[] {
  if (!raw || raw.length === 0) return EMPTY_RECENT_RELEASES;
  return raw.map((r) => ({
    version: r.version,
    issues: r.issues ?? [],
    completedAt: r.completedAt,
    ...(r.tag !== undefined ? { tag: r.tag } : {}),
  }));
}

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
  type: "stateChanged" | "planChanged" | "releaseChanged" | "researchChanged";
  issueNumber?: number;
  version?: string;
  filename?: string;
}

function detectStateChanges(
  oldState: TikiState | null,
  newState: TikiState | null,
) {
  if (!oldState || !newState) return;
  const addToast = useToastStore.getState().addToast;
  const oldWork = oldState.activeWork;
  const newWork = newState.activeWork;

  for (const [workId, newItem] of Object.entries(newWork)) {
    const oldItem = oldWork[workId];
    if (!oldItem) continue;

    // Detect status changes
    if (oldItem.status !== newItem.status) {
      if (newItem.status === 'completed' && newItem.type === 'issue') {
        addToast(`Issue #${newItem.issue.number} completed`, 'success', 5000);
      } else if (newItem.status === 'failed' && newItem.type === 'issue') {
        addToast(`Issue #${newItem.issue.number} failed`, 'error', 8000);
      } else if (newItem.status === 'shipping' && newItem.type === 'issue') {
        addToast(`Shipping issue #${newItem.issue.number}...`, 'info', 3000);
      }
    }

    // Detect phase completion for issues
    if (newItem.type === 'issue' && oldItem.type === 'issue') {
      const oldPhase = oldItem.phase;
      const newPhase = newItem.phase;
      if (oldPhase && newPhase && oldPhase.current !== newPhase.current && newPhase.current > oldPhase.current) {
        addToast(`Phase ${newPhase.current}/${newPhase.total} completed`, 'success', 4000);
      }
    }

    // Detect pipeline step transitions
    if (oldItem.pipelineStep !== newItem.pipelineStep) {
      if (oldItem.pipelineStep === 'AUDIT' && newItem.pipelineStep === 'EXECUTE') {
        addToast('Audit passed', 'success', 3000);
      }
    }
  }

  // Detect work removed from activeWork (completed and moved to history)
  for (const [workId, oldItem] of Object.entries(oldWork)) {
    if (!newWork[workId] && oldItem.type === 'issue') {
      addToast(`Issue #${oldItem.issue.number} shipped`, 'success', 5000);
    }
  }
}

function App() {
  const [state, setState] = useState<TikiState | null>(null);
  const [tikiPath, setTikiPath] = useState<string>("");
  const [error, setError] = useState<string>("");
  // Surfaces when `get_state` returns a terminal parse error (after
  // `read_json_resilient`'s 3 retries). Triggers the StateRecoveryDialog
  // so the user can pick a backup, edit manually, or start fresh — see
  // issue #146. Distinct from `error`: the sidebar `error` is the
  // historical fallback, the dialog is the new recovery UX.
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const openShortcuts = useCallback(() => setShowShortcuts(true), []);
  const prevStateRef = useRef<TikiState | null>(null);
  const panelSizes = useLayoutStore((s) => s.panelSizes);
  const activeView = useLayoutStore((s) => s.activeView);
  const actions = useCommandActions({ onOpenShortcuts: openShortcuts });

  // Active project
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const activeProjectId = useProjectsStore((s) => s.activeProjectId) ?? 'default';

  // Apply theme from settings
  const theme = useSettingsStore((s) => s.appearance.theme);
  const stalenessThresholdHours = useSettingsStore((s) => s.workflow.stalenessThresholdHours);

  // Stale work detection: flags issues whose last activity exceeds the threshold
  const staleFlags = useStaleWorkDetection(state?.activeWork ?? EMPTY_ACTIVE_WORK, stalenessThresholdHours);
  useEffect(() => {
    const applyTheme = (resolved: 'dark' | 'light') => {
      document.documentElement.setAttribute('data-theme', resolved);
    };

    if (theme === 'dark' || theme === 'light') {
      applyTheme(theme);
      return;
    }

    // theme === 'system'
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(mediaQuery.matches ? 'dark' : 'light');

    const handler = (e: MediaQueryListEvent) => {
      applyTheme(e.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  // Detail panel state (project-scoped)
  const selectedIssue = useDetailStore((s) => s.selectionByProject[activeProjectId]?.selectedIssue ?? null);
  const selectedRelease = useDetailStore((s) => s.selectionByProject[activeProjectId]?.selectedRelease ?? null);
  const selectedTikiRelease = useDetailStore((s) => s.selectionByProject[activeProjectId]?.selectedTikiRelease ?? null);
  const selectedPr = useDetailStore((s) => s.selectionByProject[activeProjectId]?.selectedPr ?? null);
  const selectedResearchDoc = useDetailStore((s) => s.selectionByProject[activeProjectId]?.selectedResearchDoc ?? null);
  const issues = useIssuesStore((s) => s.issues);
  const releases = useReleasesStore((s) => s.releases);
  const tikiReleases = useTikiReleasesStore((s) => s.releases);
  const prs = usePullRequestsStore((s) => s.prs);

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
  const selectedPrData = selectedPr
    ? prs.find((p) => p.number === selectedPr) ?? null
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

  // Hoisted into useCallback so the recovery dialog's `onRecovered` handler
  // can re-trigger it after a successful restore/start-fresh action.
  const loadState = useCallback(async () => {
    if (!activeProject) {
      // No active project, use default cwd-based path
      try {
        const path = await invoke<string>("get_tiki_path");
        setTikiPath(path);
        console.log("Tiki path (default):", path);

        const currentState = await invoke<TikiState | null>("get_state", {});
        console.log("State loaded:", currentState);
        prevStateRef.current = currentState;
        setState(currentState);
        setRecoveryError(null);
        // Sync to tikiStateStore for Kanban
        if (currentState?.activeWork) {
          useTikiStateStore.getState().setActiveWork(currentState.activeWork);
        }
        // Sync recentIssues + recentReleases for Completed column
        useTikiStateStore.getState().setRecentIssues(currentState?.history?.recentIssues ?? EMPTY_RECENT_ISSUES);
        useTikiStateStore.getState().setRecentReleases(normalizeRecentReleases(currentState?.history?.recentReleases));
      } catch (e) {
        console.error("Error loading state:", e);
        setError(String(e));
        setRecoveryError(String(e));
      }
      return;
    }

    // Use the active project's .tiki path
    const projectTikiPath = `${activeProject.path}/.tiki`;
    setTikiPath(projectTikiPath);
    console.log("Tiki path (project):", projectTikiPath);

    try {
      const currentState = await invoke<TikiState | null>("get_state", {
        tikiPath: projectTikiPath,
      });
      console.log("State loaded:", currentState);
      prevStateRef.current = currentState;
      setState(currentState);
      setRecoveryError(null);
      // Sync to tikiStateStore for Kanban
      if (currentState?.activeWork) {
        useTikiStateStore.getState().setActiveWork(currentState.activeWork);
      }
      // Sync recentIssues + recentReleases for Completed column
      useTikiStateStore.getState().setRecentIssues(currentState?.history?.recentIssues ?? EMPTY_RECENT_ISSUES);
      useTikiStateStore.getState().setRecentReleases(normalizeRecentReleases(currentState?.history?.recentReleases));
    } catch (e) {
      console.error("Error loading state:", e);
      setError(String(e));
      setRecoveryError(String(e));
    }
  }, [activeProject]);

  // Load initial state when active project changes
  useEffect(() => {
    void loadState();
  }, [loadState]);

  // Listen for file changes
  useEffect(() => {
    const unlisten = listen<FileEvent>("tiki-file-changed", async (event) => {
      console.log("File changed:", event.payload);
      if (event.payload.type === "stateChanged") {
        try {
          const projectTikiPath = activeProject ? `${activeProject.path}/.tiki` : undefined;
          const currentState = await invoke<TikiState | null>("get_state", {
            tikiPath: projectTikiPath,
          });
          console.log("State reloaded, activeWork keys:", currentState?.activeWork ? Object.keys(currentState.activeWork) : 'none');
          const prev = prevStateRef.current;
          detectStateChanges(prev, currentState);
          // Detect activeWork → history transitions to drive sidebar GitHub re-fetches
          // (issue close, release ship). Debounced per-surface to coalesce bursts.
          if (prev && currentState) {
            const triggers = detectGithubRefreshTriggers(prev, currentState);
            if (triggers.issuesRefresh) {
              scheduleRefresh('issues', () => useIssuesStore.getState().triggerRefetch());
            }
            if (triggers.prsRefresh) {
              scheduleRefresh('prs', () => usePullRequestsStore.getState().triggerRefetch());
            }
            if (triggers.releasesRefresh) {
              scheduleRefresh('releases', () => useReleasesStore.getState().triggerRefetch());
            }

            // Bulk YOLO cascade: when state.json transitions the run's
            // current issue from activeWork into history, advance the
            // queue and dispatch the next /tiki:yolo. Detect failure
            // (activeWork[issue].status === 'failed') and pause + toast.
            const projectId =
              useProjectsStore.getState().activeProjectId ?? 'default';
            const bulkRun =
              useBulkYoloStore.getState().runByProject[projectId] ?? null;
            if (bulkRun && bulkRun.status === 'running') {
              const currentIssue = bulkRun.queue[bulkRun.currentIndex];
              if (currentIssue !== undefined) {
                const wasActive =
                  `issue:${currentIssue}` in (prev.activeWork ?? {});
                const nowDone = (
                  currentState.history?.recentIssues ?? EMPTY_RECENT_ISSUES
                ).some((i) => i.number === currentIssue);
                const nowFailed =
                  currentState.activeWork?.[`issue:${currentIssue}`]
                    ?.status === 'failed';

                if (wasActive && nowDone) {
                  // Issue shipped — advance the queue and dispatch the next.
                  useBulkYoloStore.getState().advance();
                  void dispatchNextBulkYolo(projectId);
                } else if (nowFailed) {
                  useBulkYoloStore
                    .getState()
                    .recordFailure(`Issue #${currentIssue} pipeline failed`);
                  useToastStore.getState().addToast(
                    `Bulk YOLO paused: issue #${currentIssue} failed. Fix and resume from the dialog.`,
                    'error',
                  );
                }
              }
            }
          }
          prevStateRef.current = currentState;
          setState(currentState);
          // Sync to tikiStateStore for Kanban
          if (currentState?.activeWork) {
            console.log("Syncing to tikiStateStore:", Object.entries(currentState.activeWork).map(([k, v]) => `${k}: ${v.status}`));
            useTikiStateStore.getState().setActiveWork(currentState.activeWork);
          }
          // Sync recentIssues + recentReleases for Completed column
          useTikiStateStore.getState().setRecentIssues(currentState?.history?.recentIssues ?? EMPTY_RECENT_ISSUES);
          useTikiStateStore.getState().setRecentReleases(normalizeRecentReleases(currentState?.history?.recentReleases));
        } catch (e) {
          console.error("Failed to reload state:", e);
        }
      } else if (event.payload.type === "releaseChanged") {
        try {
          const projectTikiPath = activeProject ? `${activeProject.path}/.tiki` : undefined;
          const loadedReleases = await invoke<TikiRelease[]>("load_tiki_releases", { tikiPath: projectTikiPath });
          useTikiReleasesStore.getState().setReleases(loadedReleases);
        } catch (e) {
          console.error("Failed to reload releases:", e);
        }
      } else if (event.payload.type === "researchChanged") {
        try {
          const projectTikiPath = activeProject ? `${activeProject.path}/.tiki` : undefined;
          const loadedDocs = await invoke<ResearchDocMeta[]>("list_research_docs", { tikiPath: projectTikiPath });
          useResearchStore.getState().setDocs(loadedDocs);
        } catch (e) {
          console.error("Failed to reload research docs:", e);
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
      // Command palette toggle (Ctrl+K / Cmd+K)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
        return;
      }

      // Keyboard shortcuts panel (Ctrl+/)
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }

      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === '1') {
          e.preventDefault();
          useLayoutStore.getState().setActiveView('terminal');
        } else if (e.key === '2') {
          e.preventDefault();
          useLayoutStore.getState().setActiveView('kanban');
        } else if (e.key === '3') {
          e.preventDefault();
          useLayoutStore.getState().setActiveView('dependencies');
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
    // E52 — framer-motion respects the user's OS prefers-reduced-motion
    // setting for every motion.X / AnimatePresence under this provider.
    // Pairs with the CSS-layer override in index.css for non-framer animations.
    <MotionConfig reducedMotion="user">
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
                <StateSection activeWork={state.activeWork} staleFlags={staleFlags} />
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
              <PullRequestsSection />
              <ReleasesSection />
              <ResearchSection />
              <ClaudeUsageSection />
            </div>
            <div className="sidebar-footer">
              <div className="sidebar-footer-actions">
              <button
                className="sidebar-settings-btn"
                onClick={() => setShowShortcuts(true)}
                title="Keyboard Shortcuts (Ctrl+/)"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
                  <text x="8" y="11" textAnchor="middle" fill="currentColor" fontSize="9" fontWeight="600" fontFamily="inherit">?</text>
                </svg>
              </button>
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
              <ErrorBoundary label="center-pane">
                <section className={`section terminal-section ${activeView !== 'terminal' ? 'hidden' : ''}`}>
                  <ErrorBoundary label="terminal-view">
                    <TerminalPane />
                  </ErrorBoundary>
                </section>
                <section className={`section terminal-section ${activeView !== 'kanban' ? 'hidden' : ''}`}>
                  <ErrorBoundary label="kanban-view">
                    <KanbanBoard />
                  </ErrorBoundary>
                </section>
                <section className={`section terminal-section ${activeView !== 'dependencies' ? 'hidden' : ''}`}>
                  <ErrorBoundary label="dependencies-view">
                    <DependencyGraph />
                  </ErrorBoundary>
                </section>
                <section className={`section terminal-section ${activeView !== 'settings' ? 'hidden' : ''}`}>
                  <ErrorBoundary label="settings-view">
                    <SettingsPage />
                  </ErrorBoundary>
                </section>
              </ErrorBoundary>
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
            ) : selectedPrData ? (
              <PullRequestDetail pr={selectedPrData} />
            ) : selectedReleaseData ? (
              <ReleaseDetail release={selectedReleaseData} />
            ) : selectedTikiReleaseData ? (
              <TikiReleaseDetail release={selectedTikiReleaseData} />
            ) : selectedResearchDoc ? (
              <ResearchDetail filename={selectedResearchDoc} projectPath={activeProject?.path} />
            ) : (
              <DetailEmptyState />
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

      <ToastContainer />
      <BulkActionToolbar />
      <BulkYoloDialog />
      <CommandPalette actions={actions} />
      <KeyboardShortcuts isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {recoveryError && (
        <StateRecoveryDialog
          error={recoveryError}
          tikiPath={tikiPath}
          onRecovered={() => {
            setRecoveryError(null);
            setError("");
            void loadState();
          }}
          onDismiss={() => setRecoveryError(null)}
        />
      )}
    </div>
    </MotionConfig>
  );
}

export default App;
