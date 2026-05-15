import type { TikiReleaseIssue } from '../stores';

/** Minimal issue shape needed to look up titles by number. */
interface IssueLookup {
  number: number;
  title: string;
}

/**
 * Build the pre-populated `initialIssues` payload for the
 * ReleaseDialog from a selection of issue numbers, looking up titles
 * from the issues store. Falls back to `#${number}` when an issue
 * isn't found in the lookup list (e.g. it was filtered out).
 *
 * Used by the bulk-action toolbar's "Add to release" button (#203).
 */
export function buildPrePopulatedRelease(
  selected: number[],
  allIssues: IssueLookup[]
): { initialIssues: TikiReleaseIssue[] } {
  return {
    initialIssues: selected.map((n) => {
      const found = allIssues.find((i) => i.number === n);
      return found ? { number: n, title: found.title } : { number: n, title: `#${n}` };
    }),
  };
}
