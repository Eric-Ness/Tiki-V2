import { describe, it, expect } from 'vitest';
import type { WorkStatus } from '../types/state.js';
import {
  VALID_TRANSITIONS,
  canTransition,
  assertTransition,
} from '../types/transitions.js';

const ALL_STATUSES: WorkStatus[] = [
  'pending',
  'reviewing',
  'planning',
  'executing',
  'paused',
  'shipping',
  'completed',
  'failed',
];

describe('canTransition — every legal pair from VALID_TRANSITIONS returns true', () => {
  const legalPairs: Array<[WorkStatus, WorkStatus]> = [];
  for (const from of Object.keys(VALID_TRANSITIONS) as WorkStatus[]) {
    for (const to of VALID_TRANSITIONS[from]) {
      legalPairs.push([from, to]);
    }
  }

  it.each(legalPairs)('canTransition(%s, %s) === true', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });
});

describe('canTransition — every same-status pair returns true (idempotent)', () => {
  it.each(ALL_STATUSES.map((s) => [s] as const))(
    'canTransition(%s, %s) === true',
    (status) => {
      expect(canTransition(status, status)).toBe(true);
    },
  );
});

describe('canTransition — representative illegal pairs return false', () => {
  const illegalPairs: Array<[WorkStatus, WorkStatus]> = [
    ['failed', 'shipping'], // the headline removed pair
    ['completed', 'executing'], // terminal escape
    ['completed', 'pending'], // terminal escape
    ['shipping', 'pending'], // illegal reset
    ['shipping', 'reviewing'], // illegal reset
  ];

  it.each(illegalPairs)('canTransition(%s, %s) === false', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe('assertTransition — throws on illegal pair with both statuses in message', () => {
  it('throws on failed → shipping (the removed pair)', () => {
    expect(() => assertTransition('failed', 'shipping')).toThrow();
    expect(() => assertTransition('failed', 'shipping')).toThrow(/failed/);
    expect(() => assertTransition('failed', 'shipping')).toThrow(/shipping/);
  });

  it('throws on completed → executing (terminal escape)', () => {
    expect(() => assertTransition('completed', 'executing')).toThrow(/completed/);
    expect(() => assertTransition('completed', 'executing')).toThrow(/executing/);
  });

  it('throws on shipping → pending (illegal reset)', () => {
    expect(() => assertTransition('shipping', 'pending')).toThrow(/shipping/);
    expect(() => assertTransition('shipping', 'pending')).toThrow(/pending/);
  });
});

describe('assertTransition — does NOT throw on legal pair or same-status', () => {
  it('does not throw on pending → reviewing (legal forward)', () => {
    expect(() => assertTransition('pending', 'reviewing')).not.toThrow();
  });

  it('does not throw on executing → executing (same-status)', () => {
    expect(() => assertTransition('executing', 'executing')).not.toThrow();
  });

  it('does not throw on executing → completed (the newly added pair)', () => {
    expect(() => assertTransition('executing', 'completed')).not.toThrow();
  });

  it('does not throw on failed → executing (retry path)', () => {
    expect(() => assertTransition('failed', 'executing')).not.toThrow();
  });
});
