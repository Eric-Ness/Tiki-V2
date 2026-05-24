// Wires the Rust watcher's `tiki-file-changed` events into the frontend (#234,
// extracted from App.tsx). On a state change it reloads state.json, emits
// transition toasts, drives debounced GitHub re-fetches, advances the bulk-YOLO
// cascade, and syncs tikiStateStore. Release/research changes reload their
// stores.

import { useEffect, type Dispatch, type SetStateAction, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  useIssuesStore,
  usePullRequestsStore,
  useReleasesStore,
  useTikiReleasesStore,
  useResearchStore,
  useTikiStateStore,
  type ResearchDocMeta,
  type TikiRelease,
} from "../stores";
import { scheduleRefresh } from "../utils/scheduleRefresh";
import { detectGithubRefreshTriggers } from "../utils/githubRefreshTriggers";
import { detectStateChanges, syncTikiStateStore, type TikiState } from "../utils/tikiStateSync";

interface FileEvent {
  type: "stateChanged" | "planChanged" | "releaseChanged" | "researchChanged";
  issueNumber?: number;
  version?: string;
  filename?: string;
}

interface UseTikiFileSyncParams {
  /**
   * Active project PATH (or null/undefined for the default cwd-based path).
   *
   * Deliberately a primitive string, NOT the whole project object: the project
   * object is reallocated on every framework-version stamp (projectsStore
   * setProjectFrameworkVersion does `projects.map(p => ({...p}))`), which would
   * make this effect's dep change on each stamp and tear down + re-subscribe the
   * async `tiki-file-changed` listener — any state write landing in that gap is
   * lost. Keying on the path string keeps the subscription stable across stamps,
   * so it re-subscribes only on a real project switch (#249 / epic #244).
   */
  activeProjectPath: string | null | undefined;
  /** App's previous-state ref, updated after each reload for change detection. */
  prevStateRef: RefObject<TikiState | null>;
  /** App's state setter — the reloaded state is pushed here for rendering. */
  setState: Dispatch<SetStateAction<TikiState | null>>;
  /** Bump the detail-panel refresh nonce (re-fetches the open issue's GH state). */
  bumpDetailRefresh: () => void;
  /** Called with (prev, next) on every state change — drives the bulk-YOLO cascade. */
  onStateChange: (prev: TikiState, next: TikiState) => void;
}

export function useTikiFileSync({
  activeProjectPath,
  prevStateRef,
  setState,
  bumpDetailRefresh,
  onStateChange,
}: UseTikiFileSyncParams): void {
  useEffect(() => {
    const unlisten = listen<FileEvent>("tiki-file-changed", async (event) => {
      console.log("File changed:", event.payload);
      if (event.payload.type === "stateChanged") {
        try {
          const projectTikiPath = activeProjectPath ? `${activeProjectPath}/.tiki` : undefined;
          const currentState = await invoke<TikiState | null>("get_state", {
            tikiPath: projectTikiPath,
          });
          console.log("State reloaded, activeWork keys:", currentState?.activeWork ? Object.keys(currentState.activeWork) : 'none');
          const prev = prevStateRef.current;
          detectStateChanges(prev, currentState);
          // Re-fetch the open detail issue's GitHub state on every state change
          // so a close-elsewhere (e.g. release-child ship) updates the badge
          // without reselection (#220, pairs with deriveDisplayStatus).
          bumpDetailRefresh();
          // Detect activeWork → history transitions to drive sidebar GitHub
          // re-fetches (issue close, release ship). Debounced per-surface.
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
            // Bulk-YOLO cascade: advance the queue / pause on failure.
            onStateChange(prev, currentState);
          }
          prevStateRef.current = currentState;
          setState(currentState);
          syncTikiStateStore(currentState);
        } catch (e) {
          console.error("Failed to reload state:", e);
        }
      } else if (event.payload.type === "releaseChanged") {
        try {
          const projectTikiPath = activeProjectPath ? `${activeProjectPath}/.tiki` : undefined;
          // #258: must mirror the sidebar mount loader (ReleasesSection.tsx) by
          // passing includeArchived:true. This is a full setReleases() replace, so
          // omitting the flag would drop every shipped release from the store on
          // any releaseChanged event (a release file is created live then moved to
          // archive/ during a ship) — leaving stale 'active' badges or vanishing
          // completed releases until a manual refresh remounts the sidebar.
          // Completes the #255 archived-aware loading fix (mount path was fixed; this
          // watcher path was missed).
          const loadedReleases = await invoke<TikiRelease[]>("load_tiki_releases", {
            tikiPath: projectTikiPath,
            includeArchived: true,
          });
          useTikiReleasesStore.getState().setReleases(loadedReleases);
        } catch (e) {
          console.error("Failed to reload releases:", e);
        }
      } else if (event.payload.type === "researchChanged") {
        try {
          const projectTikiPath = activeProjectPath ? `${activeProjectPath}/.tiki` : undefined;
          const loadedDocs = await invoke<ResearchDocMeta[]>("list_research_docs", { tikiPath: projectTikiPath });
          useResearchStore.getState().setDocs(loadedDocs);
        } catch (e) {
          console.error("Failed to reload research docs:", e);
        }
      } else if (event.payload.type === "planChanged") {
        // #256: the Rust watcher fires planChanged per issue when a
        // .tiki/plans/issue-N.json file is written, but this listener
        // previously had no branch for it, so plan edits were silently
        // dropped. Bump a per-issue nonce so the dependency graph re-derives
        // plan-based phase progress (and #257's criteria panel) live, without
        // a full release re-fetch. EXECUTE writes the plan file as each phase
        // completes, so this is the live tick source for plan-derived UI.
        const planIssue = event.payload.issueNumber;
        if (typeof planIssue === "number") {
          useTikiStateStore.getState().bumpPlanNonce(planIssue);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeProjectPath, prevStateRef, setState, bumpDetailRefresh, onStateChange]);
}
