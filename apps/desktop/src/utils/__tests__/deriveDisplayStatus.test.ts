import { describe, it, expect } from 'vitest';
import {
  deriveDisplayStatus,
  type DeriveDisplayStatusInput,
} from '../deriveDisplayStatus';

/**
 * The fixtures mandated by #218/#222 — each is a status-desync scenario that has
 * historically rendered inconsistently across surfaces. If these all resolve to
 * one DisplayStatus, every surface that consumes the selector agrees by
 * construction.
 */
describe('deriveDisplayStatus — #218 precedence table', () => {
  it('216-mid-cascade: Tiki completed/shipping + GitHub still open → Open badge, NOT all-green, anomaly', () => {
    const input: DeriveDisplayStatusInput = {
      number: 216,
      work: { status: 'completed', pipelineStep: 'SHIP', parentRelease: 'v0.6.6' },
      githubState: { state: 'open' },
      history: null,
    };
    const out = deriveDisplayStatus(input);
    expect(out.badge).toBe('Open');
    expect(out.pipelineState).not.toBe('complete');
    expect(out.pipelineState).toBe('active');
    expect(out.anomaly).toBeTruthy();
    expect(out.column).toBe('completed');
  });

  it('release-child-shipped: in recentReleases + GitHub closed → Completed, all-green, Closed badge', () => {
    const out = deriveDisplayStatus({
      number: 216,
      work: null,
      githubState: { state: 'closed' },
      history: { recentIssues: [], recentReleases: [{ issues: [214, 215, 216] }] },
    });
    expect(out.column).toBe('completed');
    expect(out.badge).toBe('Closed');
    expect(out.pipelineState).toBe('complete');
    expect(out.anomaly).toBeUndefined();
  });

  it('reopened: in history but GitHub open again → Review column, Open badge, pipeline reset, anomaly', () => {
    const out = deriveDisplayStatus({
      number: 99,
      work: null,
      githubState: { state: 'open' },
      history: { recentIssues: [{ number: 99 }], recentReleases: [] },
    });
    expect(out.column).toBe('review');
    expect(out.badge).toBe('Open');
    expect(out.pipelineState).toBe('reset');
    expect(out.anomaly).toBeTruthy();
  });

  it('closed-not-merged: in history + GitHub closed + merged=false → Completed, Closed badge, partial pipeline', () => {
    const out = deriveDisplayStatus({
      number: 77,
      work: null,
      githubState: { state: 'closed', merged: false },
      history: { recentIssues: [{ number: 77 }] },
    });
    expect(out.column).toBe('completed');
    expect(out.badge).toBe('Closed');
    expect(out.pipelineState).toBe('partial');
  });

  it('failed: activeWork status=failed → Execute column, Failed label, failed pipeline', () => {
    const out = deriveDisplayStatus({
      number: 42,
      work: { status: 'failed', pipelineStep: 'EXECUTE' },
      githubState: { state: 'open' },
    });
    expect(out.column).toBe('execute');
    expect(out.label).toBe('Failed');
    expect(out.pipelineState).toBe('failed');
    expect(out.badge).toBe('Open');
  });

  it('paused: activeWork status=paused → Execute column, Paused label, paused pipeline', () => {
    const out = deriveDisplayStatus({
      number: 43,
      work: { status: 'paused', pipelineStep: 'EXECUTE' },
      githubState: { state: 'open' },
    });
    expect(out.column).toBe('execute');
    expect(out.label).toBe('Paused');
    expect(out.pipelineState).toBe('paused');
  });
});

describe('deriveDisplayStatus — supporting rows', () => {
  it('in-flight executing → Execute column, active pipeline, GitHub badge', () => {
    const out = deriveDisplayStatus({
      number: 5,
      work: { status: 'executing', pipelineStep: 'EXECUTE' },
      githubState: { state: 'open' },
    });
    expect(out.column).toBe('execute');
    expect(out.pipelineState).toBe('active');
    expect(out.badge).toBe('Open');
  });

  it('completed in Tiki AND GitHub closed → Completed, all-green, no anomaly', () => {
    const out = deriveDisplayStatus({
      number: 6,
      work: { status: 'completed' },
      githubState: { state: 'closed' },
    });
    expect(out.column).toBe('completed');
    expect(out.pipelineState).toBe('complete');
    expect(out.anomaly).toBeUndefined();
  });

  it('not tracked at all + GitHub open → Open column/badge, no pipeline', () => {
    const out = deriveDisplayStatus({ number: 1000, githubState: { state: 'open' } });
    expect(out.column).toBe('open');
    expect(out.badge).toBe('Open');
    expect(out.pipelineState).toBe('none');
  });

  it('not tracked at all + GitHub closed → Completed column, Closed badge', () => {
    const out = deriveDisplayStatus({ number: 1001, githubState: { state: 'closed' } });
    expect(out.column).toBe('completed');
    expect(out.badge).toBe('Closed');
  });
});

describe('deriveDisplayStatus — determinism', () => {
  it('returns deep-equal output for identical inputs (referential safety)', () => {
    const input: DeriveDisplayStatusInput = {
      number: 216,
      work: { status: 'executing', pipelineStep: 'EXECUTE' },
      githubState: { state: 'open' },
      history: { recentIssues: [{ number: 1 }], recentReleases: [{ issues: [2, 3] }] },
    };
    const a = deriveDisplayStatus(input);
    const b = deriveDisplayStatus(input);
    expect(a).toEqual(b);
  });
});
