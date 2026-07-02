/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  deriveDisplayStatus,
  type DisplayColumn,
  type DisplayStatus,
} from '../deriveDisplayStatus';
import {
  classifyKanbanMove,
  COLUMN_STATUSES,
  type ColumnId,
  type KanbanMove,
} from '../../components/kanban/kanbanMoves';
import { derivePhaseProgressFromPlan } from '../../components/dependencies/phaseProgress';
import { isReleaseCompleted } from '../releaseDisplayStatus';
import { deriveCriteriaChecklist, type ChecklistPlanLike } from '../criteriaVerification';
import {
  diagnosticsSummary,
  type DiagnosticsReport,
  type ReleaseCheck,
} from '../diagnosticsSummary';
import type { TikiReleaseStatus } from '../../stores/tikiReleasesStore';

/**
 * Drift harness — frontend derivation layer (#302).
 *
 * Consumes the SAME golden fixture trees as the framework suite
 * (packages/framework/__tests__/drift-harness.test.mjs) and the cargo suite
 * (apps/desktop/src-tauri/src/drift_harness_tests.rs): canonical `.tiki/`
 * workspaces under packages/shared/fixtures/tiki-workspaces/, each with an
 * expected.json declaring what every layer must derive. This layer asserts
 * every display-facing derivation — deriveDisplayStatus, kanban column
 * placement + classifyKanbanMove, derivePhaseProgressFromPlan,
 * isReleaseCompleted, deriveCriteriaChecklist, diagnosticsSummary — so
 * "state says X, desktop shows Y" becomes a red test instead of a screenshot.
 *
 * The diagnosticsSummary input is built from expected.doctor — the DRIFT
 * fields the cargo layer asserts the real `tiki_doctor` returns for the same
 * tree — plus NEUTRAL install ambience (empty unresolvedScriptPaths, no hook,
 * no copy install). Fixture dirs are workspaces, not installs: the real
 * doctor reports the canonical 4-script floor there (pinned on the cargo
 * side in doctor_ambient_install_fields_are_the_fixture_constants), which
 * would flip every fixture to "warnings" and drown the drift signal. The
 * summary pin therefore answers: what would the panel show for a HEALTHY
 * install with this .tiki tree?
 *
 * The SC5 meta-test applies the SAME mutation as the framework half
 * (mid-execute plan phase 1 completed -> pending, in memory only) and proves
 * this second layer fails on it too. Fixtures on disk are never mutated.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// __tests__ -> utils -> src -> desktop -> apps -> repo root
const FIXTURES = path.resolve(
  here, '..', '..', '..', '..', '..',
  'packages', 'shared', 'fixtures', 'tiki-workspaces',
);

interface ExpectedDisplay {
  column: DisplayColumn;
  label: string;
  pipelineState: DisplayStatus['pipelineState'];
  badge: DisplayStatus['badge'];
  anomaly?: string;
}

interface ExpectedIssue {
  githubState: { state: 'open' | 'closed' };
  display: ExpectedDisplay;
  kanban: { toExecute: KanbanMove; toShipping: KanbanMove };
  planLocation: 'active' | 'archive' | null;
  planPhaseStatuses: string[] | null;
  phaseProgress: { current: number; total: number } | null;
  criteria: { verifiedIds: string[]; unverifiedIds: string[] } | null;
}

interface ExpectedDoctor {
  stateValid: boolean;
  activeWorkCount: number;
  releaseChecks: ReleaseCheck[];
  recentReleasesMissingJson: string[];
  staleActivePlans: { issue: number; planPath: string }[];
  unverifiedShippedCriteria: { issue: number; id: string; description: string }[];
  summary: { status: 'healthy' | 'warnings'; actions: string[] };
}

interface Expected {
  description: string;
  state: { activeWork: Record<string, unknown> };
  issues: Record<string, ExpectedIssue>;
  releases: { version: string; location: 'active' | 'archive'; status: string; completed: boolean }[];
  doctor: ExpectedDoctor;
  reconcile?: {
    workId: string;
    healedStatus: string;
    healedStep: string;
    healedDisplayColumn: DisplayColumn;
  };
}

interface FixtureWork {
  status: string;
  pipelineStep?: string;
  parentRelease?: string;
}

interface FixtureState {
  activeWork?: Record<string, FixtureWork>;
  history?: {
    recentIssues?: { number: number }[];
    recentReleases?: { issues?: number[] }[];
  };
}

interface FixturePlan {
  phases: { number: number; status: string }[];
  successCriteria: { id: string; description: string }[];
  coverageMatrix: Record<string, number[]>;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T;
}

function loadFixture(name: string): { expected: Expected; state: FixtureState; tiki: string } {
  const dir = path.join(FIXTURES, name);
  return {
    expected: readJson<Expected>(path.join(dir, 'expected.json')),
    state: readJson<FixtureState>(path.join(dir, 'tiki', 'state.json')),
    tiki: path.join(dir, 'tiki'),
  };
}

function loadPlan(tiki: string, issue: number, location: 'active' | 'archive'): FixturePlan {
  const file =
    location === 'active'
      ? path.join(tiki, 'plans', `issue-${issue}.json`)
      : path.join(tiki, 'plans', 'archive', `issue-${issue}.json`);
  return readJson<FixturePlan>(file);
}

const FIXTURE_NAMES = readdirSync(FIXTURES).sort();

it('fixture set is complete (all nine canonical workspaces present)', () => {
  expect(FIXTURE_NAMES).toEqual(
    [
      'archived-release',
      'drift-dropped-transition',
      'drift-ghost-release',
      'drift-stale-active-def',
      'drift-stale-active-plan',
      'fresh-get',
      'mid-execute',
      'shipped-release-child',
      'shipped-standalone',
    ],
  );
});

describe.each(FIXTURE_NAMES)('drift harness fixture: %s', (name: string) => {
  const { expected, state, tiki } = loadFixture(name);

  describe.each(Object.entries(expected.issues))('issue #%s', (num: string, exp: ExpectedIssue) => {
    const issueNumber = Number(num);
    const work = state.activeWork?.[`issue:${num}`] ?? null;

    it('deriveDisplayStatus matches expected.display exactly', () => {
      const out = deriveDisplayStatus({
        number: issueNumber,
        work,
        githubState: exp.githubState,
        history: state.history ?? null,
      });
      expect(out).toEqual(exp.display);
    });

    it('kanban column placement + move classification match', () => {
      if (work) {
        // The column the display derivation picked must actually host the
        // work's status per the board's column<->status map (#280 parity).
        expect(COLUMN_STATUSES[exp.display.column]).toContain(work.status);
      }
      const from = exp.display.column as ColumnId;
      expect(classifyKanbanMove(from, 'execute')).toBe(exp.kanban.toExecute);
      expect(classifyKanbanMove(from, 'shipping')).toBe(exp.kanban.toShipping);
    });

    it('durable phase progress (N/M) matches', () => {
      if (exp.planLocation === null) {
        expect(exp.phaseProgress).toBeNull();
        return;
      }
      const plan = loadPlan(tiki, issueNumber, exp.planLocation);
      expect(derivePhaseProgressFromPlan(plan.phases)).toEqual(exp.phaseProgress ?? undefined);
    });

    it('coverage-derived criteria checklist matches', () => {
      if (exp.planLocation === null || exp.criteria === null) return;
      const plan = loadPlan(tiki, issueNumber, exp.planLocation);
      const rows = deriveCriteriaChecklist(plan as ChecklistPlanLike);
      expect(rows.filter((r) => r.verified).map((r) => r.id)).toEqual(exp.criteria.verifiedIds);
      expect(rows.filter((r) => !r.verified).map((r) => r.id)).toEqual(exp.criteria.unverifiedIds);
    });
  });

  it('release completion derives from LOCATION, never the status field', () => {
    for (const rel of expected.releases) {
      // Keep expected.json honest: the def must really live where it claims.
      const file =
        rel.location === 'archive'
          ? path.join(tiki, 'releases', 'archive', `${rel.version}.json`)
          : path.join(tiki, 'releases', `${rel.version}.json`);
      expect(existsSync(file), `${rel.version} def at declared location`).toBe(true);

      const completed = isReleaseCompleted({
        archived: rel.location === 'archive',
        status: rel.status as TikiReleaseStatus,
      });
      expect(completed, `${rel.version} completed`).toBe(rel.completed);
    }
  });

  it('diagnosticsSummary of the doctor report (as pinned by the cargo layer) matches', () => {
    const d = expected.doctor;
    // Drift fields come from expected.doctor (pinned against the real
    // tiki_doctor by the cargo layer); install ambience is neutralized to the
    // healthy-install baseline (see the module doc: the real doctor reports
    // the canonical missing-script floor for bare fixture dirs).
    const report: DiagnosticsReport = {
      frameworkVersion: null,
      stateValid: d.stateValid,
      schemaVersion: d.stateValid ? 1 : null,
      activeWorkCount: d.activeWorkCount,
      releaseChecks: d.releaseChecks,
      recentReleasesMissingJson: d.recentReleasesMissingJson,
      reconcilerHookInstalled: false,
      unresolvedScriptPaths: [],
      copyInstallDetected: false,
      unverifiedShippedCriteria: d.unverifiedShippedCriteria,
      staleActivePlans: d.staleActivePlans.map((p) => ({ ...p, newestTimestamp: null })),
    };
    const summary = diagnosticsSummary(report);
    expect(summary.status).toBe(d.summary.status);
    const actions = summary.findings
      .map((f) => f.action)
      .filter((a): a is NonNullable<typeof a> => a !== undefined)
      .sort();
    expect(actions).toEqual([...d.summary.actions].sort());
  });

  it('reconciled state renders in the healed column (cross-check with the framework heal)', () => {
    if (!expected.reconcile) return;
    const healed = deriveDisplayStatus({
      number: Number(expected.reconcile.workId.replace('issue:', '')),
      work: {
        status: expected.reconcile.healedStatus,
        pipelineStep: expected.reconcile.healedStep,
      },
      githubState: { state: 'open' },
      history: state.history ?? null,
    });
    expect(healed.column).toBe(expected.reconcile.healedDisplayColumn);
  });
});

// ---------------------------------------------------------------------------
// SC5 mutation meta-test (vitest half). Twin of the framework half in
// packages/framework/__tests__/drift-harness.test.mjs: the SAME single
// mutation (mid-execute plan phase 1 completed -> pending) must fail THIS
// layer's derivations too, proving the fixture couples at least two layers.
// The mutation exists only in memory — never on disk.
// ---------------------------------------------------------------------------

describe('SC5: mutated mid-execute fixture fails the derivation layer', () => {
  const { expected, tiki } = loadFixture('mid-execute');
  const exp = expected.issues['42'];
  const plan = loadPlan(tiki, 42, 'active');

  it('baseline: the untouched plan satisfies expected.json', () => {
    expect(derivePhaseProgressFromPlan(plan.phases)).toEqual(exp.phaseProgress);
    const verified = deriveCriteriaChecklist(plan as ChecklistPlanLike)
      .filter((r) => r.verified)
      .map((r) => r.id);
    expect(verified).toEqual(exp.criteria?.verifiedIds);
  });

  it('mutation: phase 1 completed -> pending breaks BOTH derivations vs expected.json', () => {
    const mutated: FixturePlan = {
      ...plan,
      phases: plan.phases.map((p) => (p.number === 1 ? { ...p, status: 'pending' } : p)),
    };

    // Phase progress drops from 1/4 to 0/4 — no longer what expected.json pins.
    expect(derivePhaseProgressFromPlan(mutated.phases)).not.toEqual(exp.phaseProgress);

    // SC1 loses its completed covering phase — the verified set drifts too.
    const verified = deriveCriteriaChecklist(mutated as ChecklistPlanLike)
      .filter((r) => r.verified)
      .map((r) => r.id);
    expect(verified).not.toEqual(exp.criteria?.verifiedIds);
  });
});
