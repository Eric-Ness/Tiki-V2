/**
 * Pure helpers for building the Kanban "Completed" column (issue #219).
 *
 * Background: `/tiki:release` removes child issues from `activeWork` but
 * historically only recorded the release in `history.recentReleases` — never
 * appending the individual issues to `history.recentIssues`. The Completed
 * column read ONLY `recentIssues`, so release-shipped issues vanished from the
 * board. These helpers union both sources so release children stay visible
 * even when the per-issue history append is missing (older state files) or when
 * a release lists issues that never had a standalone recentIssues entry.
 *
 * Kept as standalone pure functions (env:'node' testable, like
 * utils/githubRefreshTriggers.ts) so they can be unit-tested without React.
 */

import type { GitHubIssue } from '../../stores';
import type { CompletedIssue, CompletedRelease } from '../../stores';

/**
 * Union of every completed issue number, drawn from BOTH
 * `recentIssues[].number` and every `recentReleases[].issues[]`. Uncapped —
 * this is the exclusion set that keeps already-completed issues out of the
 * other columns, so it must be exhaustive regardless of how many there are.
 */
export function collectCompletedIssueNumbers(
  recentIssues: CompletedIssue[],
  recentReleases: CompletedRelease[],
): Set<number> {
  const set = new Set<number>();
  for (const issue of recentIssues) {
    if (issue && Number.isFinite(issue.number)) {
      set.add(issue.number);
    }
  }
  for (const release of recentReleases) {
    if (!release || !Array.isArray(release.issues)) continue;
    for (const num of release.issues) {
      if (Number.isFinite(num)) {
        set.add(num);
      }
    }
  }
  return set;
}

/**
 * Build the synthesized GitHubIssue cards for the Completed column.
 *
 * Sources, in precedence order:
 *  1. `recentIssues` — these carry a real title + completedAt, so they win.
 *  2. `recentReleases[].issues[]` — number-only entries; synthesized into a
 *     placeholder card ONLY when the number isn't already present from (1).
 *     This means a future release whose children DO appear in recentIssues
 *     (with real titles) take precedence over the number-only release entry.
 *
 * Deduped by issue number, sorted by completedAt descending, then capped.
 */
export function buildCompletedCards(
  recentIssues: CompletedIssue[],
  recentReleases: CompletedRelease[],
  cap = 50,
): GitHubIssue[] {
  const byNumber = new Map<number, GitHubIssue>();

  // (1) recentIssues first — they own the number and the real title.
  for (const recent of recentIssues) {
    if (!recent || !Number.isFinite(recent.number)) continue;
    if (byNumber.has(recent.number)) continue;
    byNumber.set(recent.number, {
      number: recent.number,
      title: recent.title || `Issue #${recent.number}`,
      state: 'CLOSED',
      body: '',
      labels: [],
      url: `#${recent.number}`,
      createdAt: recent.completedAt,
      updatedAt: recent.completedAt,
    });
  }

  // (2) release children that aren't already covered by recentIssues.
  for (const release of recentReleases) {
    if (!release || !Array.isArray(release.issues)) continue;
    for (const num of release.issues) {
      if (!Number.isFinite(num) || byNumber.has(num)) continue;
      byNumber.set(num, {
        number: num,
        title: `Issue #${num}`,
        state: 'CLOSED',
        body: '',
        labels: [],
        url: `#${num}`,
        createdAt: release.completedAt,
        updatedAt: release.completedAt,
      });
    }
  }

  return [...byNumber.values()]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, cap);
}
