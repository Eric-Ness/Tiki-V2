/**
 * Detects state-transition events that warrant a GitHub re-fetch in the sidebar
 * lists (Issues / Pull Requests / Releases).
 *
 * The watcher already coalesces filesystem-level event storms (50ms leading
 * edge), but it doesn't know which logical events correspond to GitHub-side
 * mutations. This helper inspects two consecutive state snapshots and returns
 * a per-surface boolean describing whether each sidebar list should re-fetch
 * from GitHub.
 *
 * Detection rules (issue #196):
 *
 * 1. **Issue completion** — an `issue:N` entry that was in `prev.activeWork`
 *    is no longer in `next.activeWork` AND it now appears in
 *    `next.history.recentIssues`. Triggers `issuesRefresh + prsRefresh`
 *    (shipping a tiki issue may merge a PR; closing an issue may close PRs).
 *
 * 2. **Release completion** — same shape for `release:V` entries landing in
 *    `next.history.recentReleases`. Triggers all three refreshes (a release
 *    ship closes child issues, opens/merges PRs, and creates the GitHub
 *    Release).
 *
 * Issue removal that does NOT land in history (e.g. manual delete from the
 * desktop UI) is a no-op — nothing on GitHub changed, so no refresh fires.
 */

/** Minimal shape of `TikiState.activeWork` entries we care about. */
interface ActiveWorkLike {
  type?: string;
}

/** Minimal shape of `TikiState.history` we care about. */
interface HistoryLike {
  recentIssues?: Array<{ number: number; [key: string]: unknown }>;
  recentReleases?: Array<{ version: string; [key: string]: unknown }>;
}

/** Minimal `TikiState` shape — kept structural so tests can supply plain objects. */
export interface TikiStateLike {
  activeWork?: Record<string, ActiveWorkLike> | null;
  history?: HistoryLike | null;
}

export interface GithubRefreshTriggers {
  issuesRefresh: boolean;
  prsRefresh: boolean;
  releasesRefresh: boolean;
}

const ISSUE_PREFIX = 'issue:';
const RELEASE_PREFIX = 'release:';

export function detectGithubRefreshTriggers(
  prev: TikiStateLike,
  next: TikiStateLike,
): GithubRefreshTriggers {
  const out: GithubRefreshTriggers = {
    issuesRefresh: false,
    prsRefresh: false,
    releasesRefresh: false,
  };

  const prevActive = prev.activeWork ?? {};
  const nextActive = next.activeWork ?? {};
  const nextHistory = next.history ?? {};
  const recentIssues = nextHistory.recentIssues ?? [];
  const recentReleases = nextHistory.recentReleases ?? [];

  // 1. Issue completion: prev had issue:N in activeWork, next does not, and
  //    next.history.recentIssues includes it.
  const prevIssueKeys = Object.keys(prevActive).filter((k) => k.startsWith(ISSUE_PREFIX));
  const nextIssueKeys = new Set(Object.keys(nextActive).filter((k) => k.startsWith(ISSUE_PREFIX)));
  for (const key of prevIssueKeys) {
    if (nextIssueKeys.has(key)) continue;
    const num = Number(key.slice(ISSUE_PREFIX.length));
    if (!Number.isFinite(num)) continue;
    const inHistory = recentIssues.some((i) => i.number === num);
    if (inHistory) {
      out.issuesRefresh = true;
      out.prsRefresh = true;
    }
  }

  // 2. Release completion: same shape for release:V entries.
  const prevReleaseKeys = Object.keys(prevActive).filter((k) => k.startsWith(RELEASE_PREFIX));
  const nextReleaseKeys = new Set(Object.keys(nextActive).filter((k) => k.startsWith(RELEASE_PREFIX)));
  for (const key of prevReleaseKeys) {
    if (nextReleaseKeys.has(key)) continue;
    const version = key.slice(RELEASE_PREFIX.length);
    const inHistory = recentReleases.some((r) => r.version === version);
    if (inHistory) {
      out.issuesRefresh = true;
      out.prsRefresh = true;
      out.releasesRefresh = true;
    }
  }

  return out;
}
