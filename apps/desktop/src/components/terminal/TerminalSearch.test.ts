import { describe, expect, it } from 'vitest';
import { formatMatchCount, isNoMatch, isValidRegex } from './TerminalSearch';

describe('formatMatchCount', () => {
  it('returns an empty string for a blank query', () => {
    expect(formatMatchCount(true, '')).toBe('');
    expect(formatMatchCount(false, '   ')).toBe('');
  });

  it('returns "Match found" when a non-empty query matched', () => {
    expect(formatMatchCount(true, 'error')).toBe('Match found');
  });

  it('returns "No results" when a non-empty query did not match', () => {
    expect(formatMatchCount(false, 'error')).toBe('No results');
  });
});

describe('isNoMatch', () => {
  it('is false for a blank query regardless of found', () => {
    expect(isNoMatch(false, '')).toBe(false);
    expect(isNoMatch(false, '   ')).toBe(false);
  });

  it('is true only when a non-empty query did not match', () => {
    expect(isNoMatch(false, 'error')).toBe(true);
    expect(isNoMatch(true, 'error')).toBe(false);
  });
});

describe('isValidRegex', () => {
  it('treats an empty string as valid (a no-op search, not an error)', () => {
    expect(isValidRegex('')).toBe(true);
  });

  it('accepts a compilable pattern', () => {
    expect(isValidRegex('Phase \\d+/\\d+')).toBe(true);
    expect(isValidRegex('Error:|SHIP')).toBe(true);
  });

  it('rejects an uncompilable pattern', () => {
    expect(isValidRegex('[')).toBe(false);
    expect(isValidRegex('(unclosed')).toBe(false);
    expect(isValidRegex('*')).toBe(false);
  });
});
