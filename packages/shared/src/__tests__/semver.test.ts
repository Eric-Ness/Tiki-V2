import { describe, it, expect } from 'vitest';
import { compareSemver, sortBySemverDesc } from '../utils/semver.js';

describe('compareSemver', () => {
  it('sorts newer versions first (descending: negative when a is newer)', () => {
    expect(compareSemver('v1.2.0', 'v1.1.0')).toBeLessThan(0);
    expect(compareSemver('v1.1.0', 'v1.2.0')).toBeGreaterThan(0);
    expect(compareSemver('v2.0.0', 'v1.9.9')).toBeLessThan(0);
  });

  it('handles the multi-digit regression case numerically (#120/#148)', () => {
    // v0.2.10 is NEWER than v0.2.9 → sorts first in descending → negative.
    expect(compareSemver('v0.2.10', 'v0.2.9')).toBeLessThan(0);
    expect(compareSemver('v0.2.9', 'v0.2.10')).toBeGreaterThan(0);
    // A lexicographic compare would wrongly make '10' < '9'; assert it does not.
    expect(compareSemver('v0.2.10', 'v0.2.9')).not.toBeGreaterThanOrEqual(0);
  });

  it('treats missing patch as 0 (v1.2 equals v1.2.0)', () => {
    expect(compareSemver('v1.2', 'v1.2.0')).toBe(0);
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
  });

  it('tolerates a leading "v" prefix on either side', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2.3', 'v1.2.3')).toBe(0);
    expect(compareSemver('v1.2.3', 'v1.2.3')).toBe(0);
  });

  it('produces descending order via [...].sort(compareSemver) incl. a multi-digit member', () => {
    const input = ['v0.2.9', 'v1.0.0', 'v0.2.10', 'v0.10.0', 'v0.2.0'];
    const sorted = [...input].sort(compareSemver);
    expect(sorted).toEqual(['v1.0.0', 'v0.10.0', 'v0.2.10', 'v0.2.9', 'v0.2.0']);
  });
});

describe('sortBySemverDesc', () => {
  it('sorts objects descending by a derived version and does not mutate the input', () => {
    const input = [
      { version: 'v0.2.9' },
      { version: 'v0.2.10' },
      { version: 'v1.0.0' },
    ];
    const sorted = sortBySemverDesc(input, (r) => r.version);
    expect(sorted.map((r) => r.version)).toEqual(['v1.0.0', 'v0.2.10', 'v0.2.9']);
    // input untouched
    expect(input.map((r) => r.version)).toEqual(['v0.2.9', 'v0.2.10', 'v1.0.0']);
  });
});
