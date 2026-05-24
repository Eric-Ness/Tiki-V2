/**
 * Durable phase-progress derivation for dependency-graph nodes.
 *
 * Phase truth has two sources: the live `activeWork[issue:N].phase` (deleted on
 * completion) and the durable per-phase `plan.phases[].status`. This helper
 * derives progress from the DURABLE source so a node can show N/M even after a
 * work item completes (and `activeWork.phase` is gone).
 *
 * The desktop app keeps local type mirrors rather than importing `@tiki/shared`
 * at runtime, so the minimal phase shape is mirrored here (see
 * `utils/criteriaVerification.ts` for the same pattern). `PhaseStatus` in
 * `@tiki/shared` is `'pending' | 'executing' | 'completed' | 'failed' | 'skipped'`.
 */

/** Minimal local mirror of a plan phase (we only need its status). */
export interface PhaseLike {
  status: string;
}

/**
 * Pure: derive durable phase progress from a plan's per-phase statuses.
 *
 * - Returns `undefined` when there is no plan to derive from (phases undefined
 *   or empty) so callers can omit the indicator entirely — NOT `{ current: 0,
 *   total: 0 }`.
 * - `total` is the phase count.
 * - `current` counts phases that are `'completed'` OR `'skipped'` (a skipped
 *   phase is "done" for progress purposes).
 * - A `'failed'` phase is simply not-yet-completed and is not counted.
 */
export function derivePhaseProgressFromPlan(
  phases: PhaseLike[] | undefined,
): { current: number; total: number } | undefined {
  if (!phases || phases.length === 0) return undefined;

  const current = phases.filter(
    (phase) => phase.status === "completed" || phase.status === "skipped",
  ).length;

  return { current, total: phases.length };
}
