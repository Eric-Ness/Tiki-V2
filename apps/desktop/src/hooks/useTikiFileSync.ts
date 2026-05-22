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
  /** Active project (or null/undefined for the default cwd-based path). */
  activeProject: { path: string } | null | undefined;
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
  activeProject,
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
          const projectTikiPath = activeProject ? `${activeProject.path}/.tiki` : undefined;
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
  }, [activeProject, prevStateRef, setState, bumpDetailRefresh, onStateChange]);
}
