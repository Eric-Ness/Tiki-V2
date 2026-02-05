/**
 * Tiki State Types
 * Matches: schemas/state.schema.json
 */

/** Status of a work item */
export type WorkStatus =
  | 'pending'
  | 'reviewing'
  | 'planning'
  | 'executing'
  | 'paused'
  | 'shipping'
  | 'completed'
  | 'failed';

/** Status of an individual phase */
export type PhaseStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'skipped';

/** Pipeline step in the Tiki workflow */
export type PipelineStep =
  | 'GET'
  | 'REVIEW'
  | 'PLAN'
  | 'AUDIT'
  | 'EXECUTE'
  | 'SHIP';

/** ISO 8601 timestamp string */
export type Timestamp = string;

/** GitHub label with full metadata */
export interface GitHubLabelInfo {
  /** Unique identifier */
  id: string;
  /** Label name */
  name: string;
  /** Hex color (without #) */
  color: string;
  /** Optional description */
  description?: string;
}

/** Issue metadata cached from GitHub */
export interface IssueInfo {
  /** GitHub issue number */
  number: number;
  /** Issue title (cached from GitHub) */
  title?: string;
  /** Issue body/description */
  body?: string;
  /** Issue state (OPEN or CLOSED) */
  state?: 'OPEN' | 'CLOSED' | string;
  /** Full GitHub issue URL */
  url?: string;
  /** Labels as string array (backward compatible) */
  labels?: string[];
  /** Labels with full metadata (preferred over labels) */
  labelDetails?: GitHubLabelInfo[];
  /** GitHub created timestamp */
  createdAt?: Timestamp;
  /** GitHub updated timestamp */
  updatedAt?: Timestamp;
}

/** Current phase execution state */
export interface PhaseProgress {
  /** Current phase number (1-indexed) */
  current: number;
  /** Total number of phases */
  total: number;
  /** Current phase status */
  status: PhaseStatus;
}

/** Error details for failed work */
export interface WorkError {
  message: string;
  /** Phase where failure occurred */
  phase?: number;
  /** Issue where failure occurred (for releases) */
  issue?: number;
  timestamp: Timestamp;
}

/** State for a single issue being worked on */
export interface IssueWork {
  type: 'issue';
  issue: IssueInfo;
  status: WorkStatus;
  /** Current pipeline step (GET, REVIEW, PLAN, AUDIT, EXECUTE, SHIP) */
  pipelineStep?: PipelineStep;
  phase?: PhaseProgress;
  createdAt: Timestamp;
  lastActivity: Timestamp;
  error?: WorkError;
}

/** Release metadata */
export interface ReleaseInfo {
  /** Semantic version (e.g., 'v1.2.0', '1.2', 'v2.0-beta') */
  version: string;
  /** Issue numbers included in this release */
  issues: number[];
  /** Currently executing issue number */
  currentIssue?: number;
  /** Issue numbers that have been completed */
  completedIssues?: number[];
  /** GitHub milestone name (if different from version) */
  milestone?: string;
}

/** State for a release (group of issues) */
export interface ReleaseWork {
  type: 'release';
  release: ReleaseInfo;
  status: WorkStatus;
  /** Current pipeline step (GET, REVIEW, PLAN, AUDIT, EXECUTE, SHIP) */
  pipelineStep?: PipelineStep;
  /** Current phase of current issue */
  phase?: PhaseProgress;
  createdAt: Timestamp;
  lastActivity: Timestamp;
  error?: WorkError;
}

/** Union type for any work item */
export type Work = IssueWork | ReleaseWork;

/** Record of a completed issue */
export interface CompletedIssueRecord {
  number: number;
  title?: string;
  completedAt: Timestamp;
}

/** Record of a completed release */
export interface CompletedReleaseRecord {
  version: string;
  issues?: number[];
  completedAt: Timestamp;
}

/** History of completed work */
export interface WorkHistory {
  lastCompletedIssue?: CompletedIssueRecord;
  lastCompletedRelease?: CompletedReleaseRecord;
  /** Recently completed issues (for quick reference) */
  recentIssues?: CompletedIssueRecord[];
}

/** Work ID pattern: 'issue:42' or 'release:v1.2' */
export type WorkId = `issue:${number}` | `release:${string}`;

/** Active work map keyed by work ID */
export interface ActiveWork {
  [key: WorkId]: Work;
}

/**
 * Root state object for Tiki
 * Stored in: .tiki/state.json
 */
export interface TikiState {
  /** Schema version for migrations */
  schemaVersion: 1;
  /** All currently active work items */
  activeWork: ActiveWork;
  /** Record of completed work */
  history?: WorkHistory;
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Create a work ID for an issue */
export function issueWorkId(issueNumber: number): WorkId {
  return `issue:${issueNumber}`;
}

/** Create a work ID for a release */
export function releaseWorkId(version: string): WorkId {
  return `release:${version}` as WorkId;
}

/** Parse a work ID to get its type and identifier */
export function parseWorkId(workId: WorkId): { type: 'issue' | 'release'; id: string } {
  const [type, id] = workId.split(':') as ['issue' | 'release', string];
  return { type, id };
}

/** Check if work is an issue */
export function isIssueWork(work: Work): work is IssueWork {
  return work.type === 'issue';
}

/** Check if work is a release */
export function isReleaseWork(work: Work): work is ReleaseWork {
  return work.type === 'release';
}

/** Create initial empty state */
export function createEmptyState(): TikiState {
  return {
    schemaVersion: 1,
    activeWork: {},
  };
}

/** Create a new issue work entry */
export function createIssueWork(issueNumber: number, title?: string): IssueWork {
  const now = new Date().toISOString();
  return {
    type: 'issue',
    issue: {
      number: issueNumber,
      title,
    },
    status: 'pending',
    createdAt: now,
    lastActivity: now,
  };
}

/** Create a new release work entry */
export function createReleaseWork(version: string, issues: number[] = []): ReleaseWork {
  const now = new Date().toISOString();
  return {
    type: 'release',
    release: {
      version,
      issues,
      completedIssues: [],
    },
    status: 'pending',
    createdAt: now,
    lastActivity: now,
  };
}
