/**
 * Tiki Shared Types
 * Re-exports all types from the shared package
 */

// State types
export type {
  WorkStatus,
  PhaseStatus,
  Timestamp,
  IssueInfo,
  PhaseProgress,
  WorkError,
  IssueWork,
  ReleaseInfo,
  ReleaseWork,
  Work,
  CompletedIssueRecord,
  CompletedReleaseRecord,
  WorkHistory,
  WorkId,
  ActiveWork,
  TikiState,
} from './state.js';

export {
  issueWorkId,
  releaseWorkId,
  parseWorkId,
  isIssueWork,
  isReleaseWork,
  createEmptyState,
  createIssueWork,
  createReleaseWork,
} from './state.js';

// Plan types
export type {
  CriteriaCategory,
  CriterionId,
  SuccessCriterion,
  PhaseError,
  Phase,
  PlanIssue,
  CoverageMatrix,
  TikiPlan,
} from './plan.js';

export {
  criterionId,
  createEmptyPlan,
  createPhase,
  createCriterion,
  getIncompletePhases,
  getNextPhase,
  isPlanComplete,
  getUnverifiedCriteria,
  buildCoverageMatrix,
  getPlanPath,
} from './plan.js';
