/**
 * Live success-criteria verification, derived from phase completion.
 *
 * This is a local mirror of `deriveCriteriaVerification` in `@tiki/shared`
 * (packages/shared/src/types/plan.ts). The desktop app keeps local type
 * mirrors rather than importing `@tiki/shared` at runtime, so the logic is
 * replicated here (and unit-tested) instead of introducing a cross-package
 * runtime dependency. Keep the two implementations in sync.
 *
 * A criterion is considered verified iff it has at least one covering phase in
 * the coverage matrix AND every covering phase has status === "completed".
 */

export interface ChecklistPhase {
  number: number;
  status: string;
}

export interface ChecklistCriterion {
  id: string;
  description: string;
}

export interface ChecklistPlanLike {
  successCriteria: ChecklistCriterion[];
  phases: ChecklistPhase[];
  coverageMatrix: Record<string, number[]>;
}

export interface CriterionVerification {
  id: string;
  description: string;
  /** Phase numbers that cover this criterion (from the coverage matrix). */
  coveringPhases: number[];
  /** True iff every covering phase is completed (and there is at least one). */
  verified: boolean;
}

/**
 * Pure: derive the verification state of each success criterion from phase
 * completion. Does not mutate the input plan.
 */
export function deriveCriteriaChecklist(
  plan: ChecklistPlanLike | null,
): CriterionVerification[] {
  if (!plan) return [];

  const statusByNumber = new Map<number, string>();
  for (const phase of plan.phases) {
    statusByNumber.set(phase.number, phase.status);
  }

  return plan.successCriteria.map((criterion) => {
    const coveringPhases = plan.coverageMatrix[criterion.id] ?? [];
    const verified =
      coveringPhases.length > 0 &&
      coveringPhases.every(
        (phaseNumber) => statusByNumber.get(phaseNumber) === "completed",
      );

    return {
      id: criterion.id,
      description: criterion.description,
      coveringPhases,
      verified,
    };
  });
}

/** Count verified vs total success criteria. */
export function criteriaChecklistProgress(plan: ChecklistPlanLike | null): {
  verified: number;
  total: number;
} {
  const rows = deriveCriteriaChecklist(plan);
  return {
    verified: rows.filter((r) => r.verified).length,
    total: rows.length,
  };
}
