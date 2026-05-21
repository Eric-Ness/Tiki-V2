/**
 * Tiki Plan Types
 * Matches: schemas/plan.schema.json
 */

import type { Timestamp, PhaseStatus } from './state.js';

/** Category of success criterion */
export type CriteriaCategory =
  | 'functional'
  | 'testing'
  | 'performance'
  | 'security'
  | 'documentation'
  | 'other';

/** Success criterion ID pattern: SC1, SC2, etc. */
export type CriterionId = `SC${number}`;

/** A single success criterion that must be met */
export interface SuccessCriterion {
  /** Unique identifier (e.g., 'SC1', 'SC2') */
  id: CriterionId;
  /** Category of this criterion */
  category?: CriteriaCategory;
  /** What needs to be true */
  description: string;
  /** Whether this criterion has been verified as met */
  verified?: boolean;
  /** When this criterion was verified */
  verifiedAt?: Timestamp;
}

/** Error details for a failed phase */
export interface PhaseError {
  message: string;
  timestamp: Timestamp;
}

/** A single execution phase */
export interface Phase {
  /** Phase number (1-indexed, matches execution order) */
  number: number;
  /** Short title describing the phase */
  title: string;
  /** Current status */
  status: PhaseStatus;
  /** Detailed instructions for this phase */
  content: string;
  /** How to verify this phase was completed correctly */
  verification?: string[];
  /** Success criteria IDs this phase addresses */
  addressesCriteria?: CriterionId[];
  /** Files expected to be created or modified */
  files?: string[];
  /** Phase numbers that must complete before this one (for future parallel execution) */
  dependencies?: number[];
  /** When execution of this phase started */
  startedAt?: Timestamp;
  /** When this phase completed */
  completedAt?: Timestamp;
  /** Summary of what was accomplished (filled after completion) */
  summary?: string;
  /** Error details if phase failed */
  error?: PhaseError;
}

/** GitHub issue metadata for a plan */
export interface PlanIssue {
  /** GitHub issue number */
  number: number;
  /** Issue title */
  title: string;
  /** Full GitHub issue URL */
  url?: string;
  /** Issue labels */
  labels?: string[];
  /** Associated milestone name */
  milestone?: string;
}

/** Maps success criteria IDs to the phases that address them */
export interface CoverageMatrix {
  [criterionId: CriterionId]: number[];
}

/**
 * Plan for executing a GitHub issue
 * Stored in: .tiki/plans/issue-{number}.json
 */
export interface TikiPlan {
  /** Schema version for migrations */
  schemaVersion: 1;
  /** GitHub issue metadata */
  issue: PlanIssue;
  /** When this plan was created */
  createdAt: Timestamp;
  /** When this plan was last modified */
  updatedAt?: Timestamp;
  /** What needs to be true for this issue to be considered complete */
  successCriteria?: SuccessCriterion[];
  /** Ordered list of execution phases */
  phases: Phase[];
  /** Maps success criteria IDs to the phases that address them */
  coverageMatrix?: CoverageMatrix;
  /** Research documents referenced during planning */
  research?: string[];
  /** Additional planning notes or context */
  notes?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Create a success criterion ID */
export function criterionId(num: number): CriterionId {
  return `SC${num}` as CriterionId;
}

/** Create an empty plan for an issue */
export function createEmptyPlan(issueNumber: number, title: string): TikiPlan {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    issue: {
      number: issueNumber,
      title,
    },
    createdAt: now,
    phases: [],
  };
}

/** Create a new phase */
export function createPhase(
  number: number,
  title: string,
  content: string
): Phase {
  return {
    number,
    title,
    status: 'pending',
    content,
  };
}

/** Create a new success criterion */
export function createCriterion(
  num: number,
  description: string,
  category?: CriteriaCategory
): SuccessCriterion {
  return {
    id: criterionId(num),
    description,
    category,
  };
}

/** Get all incomplete phases */
export function getIncompletePhases(plan: TikiPlan): Phase[] {
  return plan.phases.filter(
    (p) => p.status !== 'completed' && p.status !== 'skipped'
  );
}

/** Get the next pending phase */
export function getNextPhase(plan: TikiPlan): Phase | undefined {
  return plan.phases.find((p) => p.status === 'pending');
}

/** Check if all phases are complete */
export function isPlanComplete(plan: TikiPlan): boolean {
  return plan.phases.every(
    (p) => p.status === 'completed' || p.status === 'skipped'
  );
}

/** Get unverified success criteria */
export function getUnverifiedCriteria(plan: TikiPlan): SuccessCriterion[] {
  return (plan.successCriteria ?? []).filter((c) => !c.verified);
}

/** Build a coverage matrix from phases */
export function buildCoverageMatrix(phases: Phase[]): CoverageMatrix {
  const matrix: CoverageMatrix = {};
  for (const phase of phases) {
    for (const criterionId of phase.addressesCriteria ?? []) {
      if (!matrix[criterionId]) {
        matrix[criterionId] = [];
      }
      matrix[criterionId].push(phase.number);
    }
  }
  return matrix;
}

/** Get plan file path for an issue */
export function getPlanPath(issueNumber: number): string {
  return `.tiki/plans/issue-${issueNumber}.json`;
}

/**
 * Derive the verification state of each success criterion from phase completion.
 *
 * Pure: does not mutate the input plan. Returns a fresh array of success
 * criteria, each marked `verified: true` (with an ISO `verifiedAt` timestamp)
 * iff EVERY phase listed for that criterion in `plan.coverageMatrix` has
 * `status === 'completed'`. A criterion with no coverageMatrix entry (or an
 * empty one) stays unverified.
 *
 * Phase status lives on `plan.phases[].status`, keyed by `phase.number`.
 */
export function deriveCriteriaVerification(plan: TikiPlan): SuccessCriterion[] {
  const criteria = plan.successCriteria ?? [];
  const coverage = plan.coverageMatrix ?? {};
  const now = new Date().toISOString();

  // Map phase number -> status for O(1) lookups.
  const statusByNumber = new Map<number, PhaseStatus>();
  for (const phase of plan.phases) {
    statusByNumber.set(phase.number, phase.status);
  }

  return criteria.map((criterion) => {
    const coveringPhases = coverage[criterion.id] ?? [];
    const verified =
      coveringPhases.length > 0 &&
      coveringPhases.every(
        (phaseNumber) => statusByNumber.get(phaseNumber) === 'completed'
      );

    if (verified) {
      return {
        ...criterion,
        verified: true,
        // Preserve an existing timestamp if the criterion was already verified.
        verifiedAt: criterion.verifiedAt ?? now,
      };
    }

    // Not verified: strip any stale verified/verifiedAt fields.
    const { verified: _verified, verifiedAt: _verifiedAt, ...rest } = criterion;
    return { ...rest, verified: false };
  });
}

/** Count how many success criteria are verified (by phase completion). */
export function criteriaProgress(plan: TikiPlan): {
  verified: number;
  total: number;
} {
  const derived = deriveCriteriaVerification(plan);
  return {
    verified: derived.filter((c) => c.verified).length,
    total: derived.length,
  };
}
