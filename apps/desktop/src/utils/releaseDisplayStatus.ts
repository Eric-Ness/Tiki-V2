import type { TikiRelease } from "../stores/tikiReleasesStore";

/**
 * Whether a release should be treated as "completed" (shipped) for display.
 *
 * The authoritative signal is the location-derived `archived` flag stamped by the
 * `load_tiki_releases` Tauri command — the on-disk `status` is unreliable because
 * the ship teardown moves a release into `releases/archive/` WITHOUT flipping its
 * `status`, so an archived file can still say `"status":"active"`.
 *
 * `archived` only reaches the frontend if it is serialized across the Tauri IPC
 * boundary; the Rust struct must keep it serializable (see `TikiRelease.archived`
 * and the `tiki_release_archived_survives_serialization` guard test). We still
 * accept an explicit `shipped`/`completed` status as a fallback so a
 * self-consistent JSON also reads as completed even if `archived` is absent.
 *
 * Centralizing this avoids the drift that caused the duplicated copies in the
 * sidebar and the detail panel to disagree. Covered by releaseDisplayStatus.test.ts.
 */
export function isReleaseCompleted(
  release: Pick<TikiRelease, "archived" | "status">
): boolean {
  return (
    Boolean(release.archived) ||
    release.status === "shipped" ||
    release.status === "completed"
  );
}
