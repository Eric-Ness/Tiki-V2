import { describe, it, expect } from 'vitest';
import { applyColumnOrder } from '../kanbanStore';

describe('applyColumnOrder', () => {
  it('returns input unchanged when order is empty/undefined', () => {
    const issues = [{ number: 1 }, { number: 2 }, { number: 3 }];
    expect(applyColumnOrder(issues, undefined)).toEqual(issues);
    expect(applyColumnOrder(issues, [])).toEqual(issues);
  });

  it('orders present items per the order array, appends missing items in API order', () => {
    const issues = [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }];
    const out = applyColumnOrder(issues, [3, 1]);
    expect(out.map((i) => i.number)).toEqual([3, 1, 2, 4]);
  });

  it('drops phantom numbers (in order but not in issues) and survives empty issues array', () => {
    expect(applyColumnOrder([], [5, 6])).toEqual([]);
    const issues = [{ number: 2 }];
    expect(applyColumnOrder(issues, [9, 2, 7])).toEqual([{ number: 2 }]);
  });
});
