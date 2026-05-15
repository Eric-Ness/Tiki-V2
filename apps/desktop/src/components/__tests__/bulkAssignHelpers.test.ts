import { describe, it, expect } from 'vitest';
import { buildPrePopulatedRelease } from '../bulkAssignHelpers';

describe('buildPrePopulatedRelease', () => {
  it('matches selected issue numbers to titles when found', () => {
    const r = buildPrePopulatedRelease(
      [2, 1],
      [
        { number: 1, title: 'A' },
        { number: 2, title: 'B' },
      ]
    );
    expect(r.initialIssues).toEqual([
      { number: 2, title: 'B' },
      { number: 1, title: 'A' },
    ]);
  });

  it('falls back to # placeholder when issue not found in the list', () => {
    const r = buildPrePopulatedRelease([99], []);
    expect(r.initialIssues).toEqual([{ number: 99, title: '#99' }]);
  });
});
