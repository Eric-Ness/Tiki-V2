// GitHub freshness (#221, extracted from App.tsx in #234). The watcher only
// watches .tiki/, so issues/PRs/releases closed outside the app stay stale.
// Re-sync on window focus / tab visibility (default on) and, optionally, on a
// rate-limit-gated interval (off by default).

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, useIssuesStore, usePullRequestsStore, useReleasesStore } from "../stores";
import { scheduleRefresh } from "../utils/scheduleRefresh";
import { shouldRefreshOnVisibility, canIntervalPoll, effectiveIntervalMs } from "../utils/githubFreshness";
import type { RateLimitStatus } from "../components/RateLimitIndicator";

export function useGithubFreshness(bumpDetailRefresh: () => void): void {
  const githubFocusRefresh = useSettingsStore((s) => s.github.focusRefresh);
  const githubPollSeconds = useSettingsStore((s) => s.github.pollIntervalSeconds);

  useEffect(() => {
    const refreshAll = () => {
      scheduleRefresh('issues', () => useIssuesStore.getState().triggerRefetch());
      scheduleRefresh('prs', () => usePullRequestsStore.getState().triggerRefetch());
      scheduleRefresh('releases', () => useReleasesStore.getState().triggerRefetch());
      // Invalidate the detail single-issue cache too (pairs with #220).
      bumpDetailRefresh();
    };

    const onVisibility = () => {
      if (shouldRefreshOnVisibility(githubFocusRefresh ?? true, document.visibilityState)) {
        refreshAll();
      }
    };
    window.addEventListener('focus', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);

    // Optional periodic poll — off by default, rate-limit-gated when enabled.
    const intervalMs = effectiveIntervalMs(githubPollSeconds);
    let timer: number | null = null;
    if (intervalMs !== null) {
      timer = window.setInterval(() => {
        void invoke<RateLimitStatus>('fetch_rate_limit_status', { projectPath: null })
          .then((status) => { if (canIntervalPoll(status)) refreshAll(); })
          .catch(() => { if (canIntervalPoll(null)) refreshAll(); });
      }, intervalMs);
    }

    return () => {
      window.removeEventListener('focus', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [githubFocusRefresh, githubPollSeconds, bumpDetailRefresh]);
}
