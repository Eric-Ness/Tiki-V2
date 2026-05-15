import { describe, it, expect } from 'vitest';
import { detectGithubRefreshTriggers, type TikiStateLike } from '../githubRefreshTriggers';

describe('detectGithubRefreshTriggers', () => {
  it('fires issues + PRs refresh when an issue moves from activeWork to history', () => {
    const prev: TikiStateLike = {
      activeWork: {
        'issue:42': { type: 'issue' },
      },
      history: { recentIssues: [], recentReleases: [] },
    };
    const next: TikiStateLike = {
      activeWork: {},
      history: {
        recentIssues: [{ number: 42, title: 'X', completedAt: '2026-05-15T00:00:00Z' }],
        recentReleases: [],
      },
    };

    const out = detectGithubRefreshTriggers(prev, next);

    expect(out.issuesRefresh).toBe(true);
    expect(out.prsRefresh).toBe(true);
    expect(out.releasesRefresh).toBe(false);
  });

  it('fires all three refreshes when a release moves from activeWork to history', () => {
    const prev: TikiStateLike = {
      activeWork: {
        'release:v1.0': { type: 'release' },
      },
      history: { recentIssues: [], recentReleases: [] },
    };
    const next: TikiStateLike = {
      activeWork: {},
      history: {
        recentIssues: [],
        recentReleases: [
          { version: 'v1.0', issues: [1], completedAt: '2026-05-15T00:00:00Z', tag: 'v1.0' },
        ],
      },
    };

    const out = detectGithubRefreshTriggers(prev, next);

    expect(out.issuesRefresh).toBe(true);
    expect(out.prsRefresh).toBe(true);
    expect(out.releasesRefresh).toBe(true);
  });

  it('does NOT fire any refresh when an issue is manually removed (not in history)', () => {
    const prev: TikiStateLike = {
      activeWork: {
        'issue:99': { type: 'issue' },
      },
      history: { recentIssues: [], recentReleases: [] },
    };
    const next: TikiStateLike = {
      activeWork: {},
      history: { recentIssues: [], recentReleases: [] },
    };

    const out = detectGithubRefreshTriggers(prev, next);

    expect(out.issuesRefresh).toBe(false);
    expect(out.prsRefresh).toBe(false);
    expect(out.releasesRefresh).toBe(false);
  });
});
