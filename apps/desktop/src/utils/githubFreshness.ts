/**
 * GitHub freshness re-sync policy (#221 / epic #218).
 *
 * The desktop watcher only watches `.tiki/`; it has no GitHub freshness
 * mechanism, so issues/PRs/releases closed outside the app (PR-merge auto-close,
 * `gh` CLI, github.com) stay stale until a manual refresh. These pure helpers
 * decide WHEN to re-sync; the wiring (listeners, timers, store refetch) lives in
 * App.tsx. Kept pure (no React, no DOM) so the policy is unit-tested directly.
 */

import { severityFor, type RateLimitStatus } from '../components/RateLimitIndicator';

/** Never poll faster than this, even if a smaller interval is configured. */
export const MIN_POLL_SECONDS = 60;

/**
 * Should a visibility/focus change trigger a GitHub re-sync? We only refresh
 * when the document is actually becoming visible and focus-refresh is enabled
 * (the default). The dominant workflow — run a `gh`/PR command in the terminal,
 * then alt-tab back — is exactly a `visible` transition.
 */
export function shouldRefreshOnVisibility(
  focusRefreshEnabled: boolean,
  visibilityState: DocumentVisibilityState,
): boolean {
  return focusRefreshEnabled && visibilityState === 'visible';
}

/**
 * Is it safe (rate-limit-wise) to fire an AUTOMATIC interval poll? We refuse to
 * spend the last sliver of the core budget on background polling so interactive
 * fetches keep working. A missing/unknown status fails OPEN (allow) — the #110
 * indicator surfaces the real ceiling, and focus refresh is never gated.
 */
export function canIntervalPoll(status: RateLimitStatus | null | undefined): boolean {
  if (!status) return true;
  return severityFor(status.core.remaining, status.core.limit) !== 'critical';
}

/**
 * Resolve the effective poll interval in ms, or null when polling is OFF.
 * `pollIntervalSeconds <= 0` (the default) means OFF; any enabled value is
 * clamped to MIN_POLL_SECONDS so a typo can't hammer the API.
 */
export function effectiveIntervalMs(
  pollIntervalSeconds: number | undefined | null,
): number | null {
  if (!pollIntervalSeconds || pollIntervalSeconds <= 0) return null;
  return Math.max(pollIntervalSeconds, MIN_POLL_SECONDS) * 1000;
}
