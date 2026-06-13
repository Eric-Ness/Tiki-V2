import type { TikiRelease } from "../stores/tikiReleasesStore";

/**
 * Whether a release should be treated as "completed" (shipped) for display.
 *
 * Location (the `archived` flag, stamped by the `load_tiki_releases` Tauri command
 * from whether the def lives in `releases/` vs `releases/archive/`) is the SOLE
 * truth. The on-disk `status` field is NO LONGER consulted (#276): the ship
 * teardown moves a release into `releases/archive/` WITHOUT reliably flipping its
 * `status`, so an archived file can still say `"status":"active"` — making `status`
 * an unreliable, footgun-prone signal for a completion decision.
 *
 * The previous `status === "shipped" || status === "completed"` disjuncts were a
 * dead fallback: since #259 the Rust loader stamps `archived` from location on
 * every load, so it always survives the Tauri IPC boundary (guarded by the
 * `tiki_release_archived_survives_serialization` test). With `archived` always
 * present, the status disjuncts could only ever *mislead* (e.g. a stale-active
 * archived def, or — in the inverse — a non-archived def someone hand-edited to
 * "shipped"), never add correct information. So they are removed: location wins.
 *
 * Centralizing this avoids the drift that caused the duplicated copies in the
 * sidebar and the detail panel to disagree. Covered by releaseDisplayStatus.test.ts.
 */
export function isReleaseCompleted(
  release: Pick<TikiRelease, "archived" | "status">
): boolean {
  return Boolean(release.archived);
}
