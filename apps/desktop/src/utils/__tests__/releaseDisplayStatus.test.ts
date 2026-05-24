import { describe, it, expect } from 'vitest';
import { isReleaseCompleted } from '../releaseDisplayStatus';

/**
 * Consumer-side guard for the #255/#258 bug class.
 *
 * The Rust `tiki_release_archived_survives_serialization` test guarantees the
 * `archived` flag crosses the IPC boundary; this guards what the frontend DOES
 * with it: a shipped release whose on-disk `status` is still the stale "active"
 * must still render as completed, in BOTH the sidebar and the detail panel (they
 * now share this single helper, so they can't drift apart again).
 */
describe('isReleaseCompleted', () => {
  it('treats an archived release as completed even when status is the stale "active"', () => {
    // The exact v0.7.7 / v0.8.1 situation: in archive/, status left at "active".
    expect(isReleaseCompleted({ archived: true, status: 'active' })).toBe(true);
  });

  it('treats explicit shipped/completed status as completed (status fallback)', () => {
    expect(isReleaseCompleted({ archived: false, status: 'shipped' })).toBe(true);
    expect(isReleaseCompleted({ archived: false, status: 'completed' })).toBe(true);
    // ...even if archived never arrived (e.g. a Node-written JSON with no flag).
    expect(isReleaseCompleted({ status: 'shipped' })).toBe(true);
  });

  it('treats a live, non-archived "active" release as NOT completed', () => {
    expect(isReleaseCompleted({ archived: false, status: 'active' })).toBe(false);
    expect(isReleaseCompleted({ status: 'active' })).toBe(false);
  });
});
