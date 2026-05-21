import { describe, it, expect } from 'vitest';
import {
  shouldRefreshOnVisibility,
  canIntervalPoll,
  effectiveIntervalMs,
  MIN_POLL_SECONDS,
} from '../githubFreshness';
import type { RateLimitStatus } from '../../components/RateLimitIndicator';

function mkStatus(remaining: number, limit: number): RateLimitStatus {
  const bucket = { limit, used: limit - remaining, remaining, reset: 0 };
  return { core: bucket, search: bucket, graphql: bucket, fetchedAtEpoch: 0 };
}

describe('shouldRefreshOnVisibility', () => {
  it('refreshes when enabled and the document becomes visible', () => {
    expect(shouldRefreshOnVisibility(true, 'visible')).toBe(true);
  });
  it('does not refresh when the document is hidden', () => {
    expect(shouldRefreshOnVisibility(true, 'hidden')).toBe(false);
  });
  it('does not refresh when focus-refresh is disabled', () => {
    expect(shouldRefreshOnVisibility(false, 'visible')).toBe(false);
  });
});

describe('canIntervalPoll', () => {
  it('allows polling when the core budget is healthy', () => {
    expect(canIntervalPoll(mkStatus(4000, 5000))).toBe(true);
  });
  it('blocks polling when the core budget is critical (<10% remaining)', () => {
    expect(canIntervalPoll(mkStatus(50, 5000))).toBe(false);
  });
  it('fails open when status is unknown', () => {
    expect(canIntervalPoll(null)).toBe(true);
    expect(canIntervalPoll(undefined)).toBe(true);
  });
});

describe('effectiveIntervalMs', () => {
  it('returns null when polling is off (default 0)', () => {
    expect(effectiveIntervalMs(0)).toBeNull();
    expect(effectiveIntervalMs(undefined)).toBeNull();
    expect(effectiveIntervalMs(null)).toBeNull();
    expect(effectiveIntervalMs(-5)).toBeNull();
  });
  it('clamps an enabled interval up to the minimum floor', () => {
    expect(effectiveIntervalMs(10)).toBe(MIN_POLL_SECONDS * 1000);
  });
  it('honors an interval above the floor', () => {
    expect(effectiveIntervalMs(300)).toBe(300_000);
  });
});
