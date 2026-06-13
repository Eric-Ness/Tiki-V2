import { describe, it, expect } from 'vitest';
import { isReleaseCompleted } from '../releaseDisplayStatus';

/**
 * Consumer-side guard for the #255/#258/#276 bug class.
 *
 * The Rust `tiki_release_archived_survives_serialization` test guarantees the
 * location-derived `archived` flag crosses the IPC boundary; this guards what the
 * frontend DOES with it. Per #276, location is the SOLE truth: completion is
 * decided purely by `archived`, never by the on-disk `status` field. The sidebar
 * and the detail panel share this single helper, so they can't drift apart again.
 */
describe('isReleaseCompleted', () => {
  it('treats an archived release as completed even when status is the stale "active"', () => {
    // The exact v0.7.7 / v0.8.1 / v0.9.0 residue: in archive/, status left at
    // "active". Location (archived) wins — it is completed.
    expect(isReleaseCompleted({ archived: true, status: 'active' })).toBe(true);
  });

  it('treats an archived release as completed regardless of status', () => {
    expect(isReleaseCompleted({ archived: true, status: 'shipped' })).toBe(true);
    expect(isReleaseCompleted({ archived: true, status: 'completed' })).toBe(true);
    expect(isReleaseCompleted({ archived: true, status: 'not_planned' })).toBe(true);
  });

  it('does NOT treat status alone as completed — archived is the only signal (#276)', () => {
    // A non-archived def whose status says "shipped"/"completed" is NOT completed:
    // location is truth, and in practice the Rust loader always stamps archived
    // from location, so a shipped-but-not-archived def should never exist. The old
    // status fallback is gone; status no longer drives this decision.
    expect(isReleaseCompleted({ archived: false, status: 'shipped' })).toBe(false);
    expect(isReleaseCompleted({ archived: false, status: 'completed' })).toBe(false);
    // ...even if archived never arrived (e.g. a Node-written JSON with no flag).
    expect(isReleaseCompleted({ status: 'shipped' })).toBe(false);
    expect(isReleaseCompleted({ status: 'completed' })).toBe(false);
  });

  it('treats a live, non-archived "active" release as NOT completed', () => {
    expect(isReleaseCompleted({ archived: false, status: 'active' })).toBe(false);
    expect(isReleaseCompleted({ status: 'active' })).toBe(false);
  });
});
