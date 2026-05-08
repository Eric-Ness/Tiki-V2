import { useEffect, useRef, useState } from 'react';
import type { WorkContext } from '../components/work/WorkCard';
import { useToastStore } from '../stores/toastStore';

/**
 * Statuses that are excluded from stale detection.
 * Items in these states are not considered "actively working" and so
 * shouldn't fire stale warnings even when their lastActivity is old.
 */
const STALE_STATUSES = new Set<string>(['paused', 'completed', 'failed', 'shipping']);

/**
 * Compute a map of workId -> isStale for the given activeWork map.
 * Only issue-type entries are considered. Entries whose status is in
 * STALE_STATUSES are skipped (never flagged stale). For the rest, a
 * timestamp of `lastActivity ?? createdAt` is used and an entry is
 * considered stale if elapsed time exceeds `thresholdHours` hours.
 */
export function computeStaleFlags(
  activeWork: Record<string, WorkContext>,
  thresholdHours: number,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  const thresholdMs = thresholdHours * 3_600_000;
  const now = Date.now();

  for (const [key, work] of Object.entries(activeWork)) {
    if (work.type !== 'issue') continue;
    if (STALE_STATUSES.has(work.status)) continue;
    const timestamp = work.lastActivity ?? work.createdAt;
    const elapsed = now - new Date(timestamp).getTime();
    result[key] = elapsed > thresholdMs;
  }

  return result;
}

/**
 * Hook that polls for stale work items every 5 minutes and fires a deduped
 * toast notification once per newly-detected stale issue.
 *
 * Returns a Record<workId, boolean> indicating which entries are stale.
 */
export function useStaleWorkDetection(
  activeWork: Record<string, WorkContext>,
  thresholdHours: number,
): Record<string, boolean> {
  const [staleFlags, setStaleFlags] = useState<Record<string, boolean>>(() =>
    computeStaleFlags(activeWork, thresholdHours),
  );
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const runDetection = () => {
      const nextFlags = computeStaleFlags(activeWork, thresholdHours);
      setStaleFlags(nextFlags);

      const notified = notifiedRef.current;
      const addToast = useToastStore.getState().addToast;

      for (const [key, isStale] of Object.entries(nextFlags)) {
        if (isStale && !notified.has(key)) {
          const work = activeWork[key];
          if (work && work.type === 'issue') {
            const timestamp = work.lastActivity ?? work.createdAt;
            const elapsedHours = (Date.now() - new Date(timestamp).getTime()) / 3_600_000;
            const msg = `Issue #${work.issue.number} has been executing for ${Math.floor(elapsedHours)}h with no activity`;
            addToast(msg, 'warning', 8000);
            notified.add(key);
          }
        } else if (!isStale && notified.has(key)) {
          notified.delete(key);
        }
      }

      // Also clear any notified entries that no longer exist in activeWork
      for (const key of Array.from(notified)) {
        if (!(key in nextFlags)) {
          notified.delete(key);
        }
      }
    };

    runDetection();
    const id = setInterval(runDetection, 300_000);
    return () => clearInterval(id);
  }, [activeWork, thresholdHours]);

  return staleFlags;
}
