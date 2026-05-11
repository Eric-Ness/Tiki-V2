import { beforeEach, describe, expect, it } from 'vitest';
import { useTikiStateStore } from '../tikiStateStore';
import type { WorkContext } from '../../components/work';

const makeIssue = (number: number, status: WorkContext['status']): WorkContext => ({
  type: 'issue',
  issue: { number, title: `issue ${number}` },
  status,
  createdAt: '2026-05-11T00:00:00.000Z',
});

const makeRelease = (version: string): WorkContext => ({
  type: 'release',
  release: { version, issues: [1, 2], completedIssues: [] },
  status: 'executing',
  createdAt: '2026-05-11T00:00:00.000Z',
});

describe('tikiStateStore.getIssueWorkStatus', () => {
  beforeEach(() => {
    useTikiStateStore.setState({ activeWork: {}, recentIssues: [] });
  });

  it('returns the status string when the issue is in activeWork', () => {
    useTikiStateStore.getState().setActiveWork({
      'issue:42': makeIssue(42, 'executing'),
    });
    expect(useTikiStateStore.getState().getIssueWorkStatus(42)).toBe('executing');
  });

  it('returns null when the issue is not in activeWork', () => {
    useTikiStateStore.getState().setActiveWork({});
    expect(useTikiStateStore.getState().getIssueWorkStatus(999)).toBeNull();
  });

  it('returns null when the key exists but points to a release, not an issue', () => {
    // A release stored under "release:v0.3.0" should never be returned by
    // getIssueWorkStatus, even when the caller asks for an issue number that
    // happens to be in the release.issues array.
    useTikiStateStore.getState().setActiveWork({
      'release:v0.3.0': makeRelease('v0.3.0'),
    });
    expect(useTikiStateStore.getState().getIssueWorkStatus(1)).toBeNull();
  });

  it('distinguishes between an issue key and a release with similar numbering', () => {
    useTikiStateStore.getState().setActiveWork({
      'issue:7': makeIssue(7, 'pending'),
      'issue:8': makeIssue(8, 'shipping'),
      'release:v0.3.0': makeRelease('v0.3.0'),
    });
    expect(useTikiStateStore.getState().getIssueWorkStatus(7)).toBe('pending');
    expect(useTikiStateStore.getState().getIssueWorkStatus(8)).toBe('shipping');
    expect(useTikiStateStore.getState().getIssueWorkStatus(9)).toBeNull();
  });
});
