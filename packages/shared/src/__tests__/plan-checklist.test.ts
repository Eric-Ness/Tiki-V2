import { describe, it, expect } from 'vitest';
import type { PhaseStatus } from '../types/state.js';
import type {
  TikiPlan,
  Phase,
  SuccessCriterion,
  CriterionId,
} from '../types/plan.js';
import {
  deriveCriteriaVerification,
  criteriaProgress,
} from '../types/plan.js';

function mkPhase(number: number, status: PhaseStatus): Phase {
  return {
    number,
    title: `Phase ${number}`,
    status,
    content: '',
  };
}

function mkCriterion(num: number, description = `criterion ${num}`): SuccessCriterion {
  return {
    id: `SC${num}` as CriterionId,
    description,
  };
}

function mkPlan(overrides: Partial<TikiPlan> = {}): TikiPlan {
  return {
    schemaVersion: 1,
    issue: { number: 1, title: 'X' },
    createdAt: '2026-05-20T00:00:00Z',
    successCriteria: [],
    phases: [],
    coverageMatrix: {},
    ...overrides,
  };
}

describe('deriveCriteriaVerification', () => {
  it('marks a criterion verified when ALL covering phases are completed', () => {
    const plan = mkPlan({
      successCriteria: [mkCriterion(1)],
      phases: [mkPhase(1, 'completed'), mkPhase(2, 'completed')],
      coverageMatrix: { SC1: [1, 2] },
    });
    const derived = deriveCriteriaVerification(plan);
    expect(derived).toHaveLength(1);
    expect(derived[0].verified).toBe(true);
    expect(typeof derived[0].verifiedAt).toBe('string');
  });

  it('leaves a criterion unverified when only some covering phases are completed', () => {
    const plan = mkPlan({
      successCriteria: [mkCriterion(1)],
      phases: [mkPhase(1, 'completed'), mkPhase(2, 'executing')],
      coverageMatrix: { SC1: [1, 2] },
    });
    const derived = deriveCriteriaVerification(plan);
    expect(derived[0].verified).toBe(false);
    expect(derived[0].verifiedAt).toBeUndefined();
  });

  it('leaves a criterion unverified when it is absent from the coverage matrix', () => {
    const plan = mkPlan({
      successCriteria: [mkCriterion(1), mkCriterion(2)],
      phases: [mkPhase(1, 'completed')],
      coverageMatrix: { SC1: [1] }, // SC2 not covered
    });
    const derived = deriveCriteriaVerification(plan);
    const sc2 = derived.find((c) => c.id === 'SC2');
    expect(sc2?.verified).toBe(false);
    expect(sc2?.verifiedAt).toBeUndefined();
  });

  it('leaves a criterion unverified when its coverage entry is empty', () => {
    const plan = mkPlan({
      successCriteria: [mkCriterion(1)],
      phases: [mkPhase(1, 'completed')],
      coverageMatrix: { SC1: [] },
    });
    const derived = deriveCriteriaVerification(plan);
    expect(derived[0].verified).toBe(false);
    expect(derived[0].verifiedAt).toBeUndefined();
  });

  it('returns an empty array for an empty plan (no criteria)', () => {
    const plan = mkPlan();
    expect(deriveCriteriaVerification(plan)).toEqual([]);
  });

  it('treats missing successCriteria / coverageMatrix as empty', () => {
    const plan: TikiPlan = {
      schemaVersion: 1,
      issue: { number: 1, title: 'X' },
      createdAt: '2026-05-20T00:00:00Z',
      phases: [mkPhase(1, 'completed')],
    };
    expect(deriveCriteriaVerification(plan)).toEqual([]);
  });

  it('does not verify when a covering phase is skipped (only "completed" counts)', () => {
    const plan = mkPlan({
      successCriteria: [mkCriterion(1)],
      phases: [mkPhase(1, 'skipped')],
      coverageMatrix: { SC1: [1] },
    });
    const derived = deriveCriteriaVerification(plan);
    expect(derived[0].verified).toBe(false);
  });

  it('does not verify when a covering phase number is missing from phases', () => {
    const plan = mkPlan({
      successCriteria: [mkCriterion(1)],
      phases: [mkPhase(1, 'completed')], // phase 2 referenced but absent
      coverageMatrix: { SC1: [1, 2] },
    });
    const derived = deriveCriteriaVerification(plan);
    expect(derived[0].verified).toBe(false);
  });

  it('sets verifiedAt only on verified criteria, not unverified ones', () => {
    const plan = mkPlan({
      successCriteria: [mkCriterion(1), mkCriterion(2)],
      phases: [mkPhase(1, 'completed'), mkPhase(2, 'pending')],
      coverageMatrix: { SC1: [1], SC2: [2] },
    });
    const derived = deriveCriteriaVerification(plan);
    const sc1 = derived.find((c) => c.id === 'SC1');
    const sc2 = derived.find((c) => c.id === 'SC2');
    expect(sc1?.verified).toBe(true);
    expect(sc1?.verifiedAt).toBeDefined();
    expect(sc2?.verified).toBe(false);
    expect(sc2?.verifiedAt).toBeUndefined();
  });

  it('preserves a pre-existing verifiedAt timestamp when still verified', () => {
    const existing = '2020-01-01T00:00:00.000Z';
    const plan = mkPlan({
      successCriteria: [{ ...mkCriterion(1), verified: true, verifiedAt: existing }],
      phases: [mkPhase(1, 'completed')],
      coverageMatrix: { SC1: [1] },
    });
    const derived = deriveCriteriaVerification(plan);
    expect(derived[0].verified).toBe(true);
    expect(derived[0].verifiedAt).toBe(existing);
  });

  it('does not mutate the input plan', () => {
    const criterion = mkCriterion(1);
    const plan = mkPlan({
      successCriteria: [criterion],
      phases: [mkPhase(1, 'completed')],
      coverageMatrix: { SC1: [1] },
    });
    deriveCriteriaVerification(plan);
    expect(criterion.verified).toBeUndefined();
    expect(plan.successCriteria?.[0].verified).toBeUndefined();
  });
});

describe('criteriaProgress', () => {
  it('counts verified and total criteria', () => {
    const plan = mkPlan({
      successCriteria: [mkCriterion(1), mkCriterion(2), mkCriterion(3)],
      phases: [
        mkPhase(1, 'completed'),
        mkPhase(2, 'completed'),
        mkPhase(3, 'executing'),
      ],
      coverageMatrix: { SC1: [1], SC2: [2], SC3: [3] },
    });
    expect(criteriaProgress(plan)).toEqual({ verified: 2, total: 3 });
  });

  it('reports 0 of 0 for an empty plan', () => {
    expect(criteriaProgress(mkPlan())).toEqual({ verified: 0, total: 0 });
  });
});
