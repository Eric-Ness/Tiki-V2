// Per-surface trailing-edge debounce for GitHub re-fetches triggered by
// state.json transitions. The watcher already coalesces filesystem-level
// events, but logical events (e.g. shipping a 5-issue release writes
// state.json many times in quick succession) still produce N triggers per
// surface. 500ms trailing-edge collapses that to one fetch per surface.
//
// Extracted from App.tsx (#234) so both useGithubFreshness and useTikiFileSync
// share one debounce map.
export type RefreshSurface = 'issues' | 'prs' | 'releases';

const pendingRefreshTriggers: Map<RefreshSurface, ReturnType<typeof setTimeout>> = new Map();
const REFRESH_DEBOUNCE_MS = 500;

export function scheduleRefresh(surface: RefreshSurface, fire: () => void): void {
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
