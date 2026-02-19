/**
 * Duration formatting utilities for phase timing display.
 */

/**
 * Format a duration in milliseconds to a human-readable string.
 * - Under 60s: "42s"
 * - Under 60m: "3m 42s"
 * - 60m+: "1h 12m"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return "0s";

  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Calculate duration between two ISO timestamps in milliseconds.
 * Returns null if either timestamp is missing.
 */
export function calculatePhaseDuration(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined
): number | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  return Math.max(0, end - start);
}

/**
 * Calculate total execution time across all phases that have timing data.
 */
export function calculateTotalDuration(
  phases: Array<{ startedAt?: string | null; completedAt?: string | null }>
): number {
  return phases.reduce((total, phase) => {
    const duration = calculatePhaseDuration(
      phase.startedAt ?? null,
      phase.completedAt ?? null
    );
    return total + (duration ?? 0);
  }, 0);
}

/**
 * Get milliseconds elapsed since a given ISO timestamp.
 */
export function getElapsedSince(startedAt: string): number {
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return 0;
  return Math.max(0, Date.now() - start);
}
