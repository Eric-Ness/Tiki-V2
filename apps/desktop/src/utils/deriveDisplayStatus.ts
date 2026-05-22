/**
 * Single source of truth for how a work item's status is displayed across every
 * UI surface — Kanban column, Active Work sidebar, detail GitHub badge, pipeline
 * timeline, issues list. Issue #222 / epic #218.
 *
 * The recurring status desync (#218, ~12 recurrences) has one master cause:
 * ~4 surfaces each derive "status" independently from ~5 in-flight sources, on
 * different cadences, with nothing forcing them to agree. This selector replaces
 * that with ONE pure function implementing the canonical first-match precedence
 * table from #218. Every surface MUST consume it — shipping divergent per-surface
 * precedence rules IS the bug.
 *
 * Design (mirrors `githubRefreshTriggers.ts`):
 *   - Pure function. No React, no Zustand imports, no side effects.
 *   - Minimal *structural* input interfaces (duck types) so tests pass plain
 *     objects with no mocking.
 *   - Returns a fresh object each call. Callers consume it inside `useMemo`
 *     keyed on its inputs. NEVER pass this as a `useSyncExternalStore` selector
 *     (that is the #210/#212 fresh-ref crash class — guarded by freshRefGuard).
 */

export type DisplayColumn =
  | 'open'
  | 'review'
  | 'plan'
  | 'execute'
  | 'shipping'
  | 'completed';

/**
 * How the pipeline timeline should render the steps:
 *   active   – green before currentStep, active AT currentStep, NOT all-green
 *   complete – all steps green
 *   failed   – green before currentStep, red AT currentStep
 *   paused   – like active but dimmed at currentStep
 *   reset    – all pending (reopened after completion)
 *   partial  – all green except the final SHIP step (closed-not-merged)
 *   none     – not tracked by Tiki; render nothing meaningful
 */
export type PipelineState =
  | 'active'
  | 'complete'
  | 'failed'
  | 'paused'
  | 'reset'
  | 'partial'
  | 'none';

export type DisplayBadge = 'Open' | 'Closed';

export interface DisplayStatus {
  column: DisplayColumn;
  label: string;
  pipelineState: PipelineState;
  badge: DisplayBadge;
  /**
   * Set ONLY when GitHub and Tiki disagree in a way a human should notice
   * (e.g. Tiki says "shipping"/"completed" but GitHub is still open). Surfaced
   * explicitly, never silently resolved — that visibility is the point of #218.
   */
  anomaly?: string;
}

export type GithubStateValue = 'open' | 'closed';

export interface GithubStateLike {
  state: GithubStateValue;
  /**
   * For the closed-not-merged distinction on PR-backed work. Absent ⇒ treated as
   * a normal (merged/expected) close.
   */
  merged?: boolean;
}

export interface WorkLike {
  status: string; // WorkStatus
  pipelineStep?: string; // PipelineStep
  parentRelease?: string;
}

export interface HistoryLike {
  recentIssues?: ReadonlyArray<{ number: number }> | null;
  recentReleases?: ReadonlyArray<{ issues?: number[] }> | null;
}

export interface DeriveDisplayStatusInput {
  /** Issue number — used to test history membership. */
  number: number;
  /** The activeWork entry for this item, or null/undefined if not in activeWork. */
  work?: WorkLike | null;
  /** GitHub state for this item, or null/undefined if GitHub data is unavailable. */
  githubState?: GithubStateLike | null;
  /** history.recentIssues + history.recentReleases. */
  history?: HistoryLike | null;
  /**
   * True when the item is in-flight but its tracked state has not advanced for a
   * while (computed by the caller — this function stays pure and clockless). Used
   * to surface a stale-tracking anomaly so a silently-frozen pipeline is visible
   * rather than appearing stuck (#246 / epic #244). Only applied to active
   * in-flight rows; never overrides a higher-priority anomaly.
   */
  stale?: boolean;
}

const STATUS_TO_COLUMN: Record<string, DisplayColumn> = {
  pending: 'review',
  reviewing: 'review',
  planning: 'plan',
  executing: 'execute',
  shipping: 'shipping',
  completed: 'completed',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  reviewing: 'Reviewing',
  planning: 'Planning',
  executing: 'Executing',
  shipping: 'Shipping',
  completed: 'Completed',
  paused: 'Paused',
  failed: 'Failed',
};

function isInHistory(num: number, history: HistoryLike | null | undefined): boolean {
  if (!history) return false;
  if (history.recentIssues) {
    for (const i of history.recentIssues) {
      if (i.number === num) return true;
    }
  }
  if (history.recentReleases) {
    for (const r of history.recentReleases) {
      const issues = r.issues;
      if (issues && issues.indexOf(num) !== -1) return true;
    }
  }
  return false;
}

/**
 * Resolve the one true display status for a work item. First match wins, in the
 * exact order of the #218 precedence table.
 */
export function deriveDisplayStatus(input: DeriveDisplayStatusInput): DisplayStatus {
  const { number, work, githubState, history, stale } = input;
  const gh = githubState?.state; // 'open' | 'closed' | undefined
  const ghBadge: DisplayBadge = gh === 'closed' ? 'Closed' : 'Open';
  const tikiStatus = work?.status;
  const inHistory = isInHistory(number, history);

  // ---- Rows requiring an activeWork entry --------------------------------
  if (work && tikiStatus) {
    // Row 1 — Tiki reports done/shipping but GitHub is still open. Anomaly:
    // keep the Tiki column, show the real GitHub badge, do NOT green the
    // pipeline. (This is exactly the #216 screenshot the epic was filed over.)
    if ((tikiStatus === 'completed' || tikiStatus === 'shipping') && gh === 'open') {
      return {
        column: STATUS_TO_COLUMN[tikiStatus] ?? 'execute',
        label: STATUS_LABEL[tikiStatus] ?? tikiStatus,
        pipelineState: 'active', // capped at currentStep — NOT all-green
        badge: 'Open',
        anomaly: `GitHub still open while Tiki reports "${tikiStatus}"`,
      };
    }

    // Row 2 — failed.
    if (tikiStatus === 'failed') {
      return { column: 'execute', label: 'Failed', pipelineState: 'failed', badge: ghBadge };
    }

    // Row 3 — paused.
    if (tikiStatus === 'paused') {
      return { column: 'execute', label: 'Paused', pipelineState: 'paused', badge: ghBadge };
    }

    // Completed in Tiki and GitHub agrees (closed, or no GitHub data) → Completed.
    if (tikiStatus === 'completed') {
      return { column: 'completed', label: 'Completed', pipelineState: 'complete', badge: ghBadge };
    }

    // Row 4 — any other in-flight status (pending/reviewing/planning/executing/shipping).
    const column = STATUS_TO_COLUMN[tikiStatus];
    if (column) {
      return {
        column,
        label: STATUS_LABEL[tikiStatus] ?? tikiStatus,
        pipelineState: 'active',
        badge: ghBadge,
        // Surface a stalled pipeline (in-flight but not advancing) so a silent
        // freeze is visible. The reconciler (#245) prevents most freezes; this
        // is the safety net for a genuinely stuck run (#246).
        ...(stale ? { anomaly: 'Pipeline stalled — no tracked progress recently' } : {}),
      };
    }
    // Unknown Tiki status — fall through to the history/GitHub rows.
  }

  // ---- History rows ------------------------------------------------------
  if (inHistory) {
    // Row 6 — reopened: in history but GitHub is open again.
    if (gh === 'open') {
      return {
        column: 'review',
        label: 'Reopened',
        pipelineState: 'reset', // NOT all-green
        badge: 'Open',
        anomaly: 'Reopened on GitHub after completion',
      };
    }
    // Row 7 — closed-not-merged (PR-backed): completed but no SHIP green.
    if (gh === 'closed' && githubState?.merged === false) {
      return { column: 'completed', label: 'Closed', pipelineState: 'partial', badge: 'Closed' };
    }
    // Row 5 — in history AND closed (or GitHub unknown) → Completed, all-green.
    return { column: 'completed', label: 'Completed', pipelineState: 'complete', badge: 'Closed' };
  }

  // ---- Row 8 — not tracked by Tiki at all → pure GitHub state ------------
  if (gh === 'closed') {
    return { column: 'completed', label: 'Closed', pipelineState: 'none', badge: 'Closed' };
  }
  return { column: 'open', label: 'Open', pipelineState: 'none', badge: 'Open' };
}
