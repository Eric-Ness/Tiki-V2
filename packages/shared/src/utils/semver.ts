/**
 * Semver comparison utilities.
 *
 * Extracted from the per-file local copy that lived in the desktop sidebar
 * (the #120 → #148 declined-abstraction class) so the multi-digit-aware
 * comparator has a single, unit-tested home.
 */

/**
 * Compare two version strings by semver, DESCENDING.
 *
 * Strips a leading 'v', splits on '.', and numerically compares the first
 * three parts. Returns a negative number when `a` is the newer version (so it
 * sorts first in an ascending `.sort()`), positive when `b` is newer, 0 when
 * equal. Missing parts are treated as 0, so 'v1.2' equals 'v1.2.0'.
 *
 * Numeric (not lexicographic) comparison is the point: 'v0.2.10' is newer than
 * 'v0.2.9' and therefore sorts first in descending order.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
}

/**
 * Sort a copy of `items` by semver descending, deriving each item's version
 * string via `getVersion`. Does not mutate the input array.
 */
export function sortBySemverDesc<T>(items: readonly T[], getVersion: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareSemver(getVersion(a), getVersion(b)));
}
