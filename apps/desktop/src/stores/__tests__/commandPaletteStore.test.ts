import { describe, expect, it } from 'vitest';
import {
  filterAndSortActions,
  fuzzyMatch,
  type CommandAction,
} from '../commandPaletteStore';

const noop = () => {};

const action = (overrides: Partial<CommandAction>): CommandAction => ({
  id: 'a',
  title: 'Action',
  category: 'command',
  keywords: [],
  execute: noop,
  ...overrides,
});

describe('fuzzyMatch', () => {
  it('matches an empty query against anything with zero score', () => {
    expect(fuzzyMatch('', 'whatever')).toEqual({ match: true, score: 0 });
  });

  it('matches when every query char appears in order', () => {
    const result = fuzzyMatch('abc', 'aXbYcZ');
    expect(result.match).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('does not match when a query char is out of order', () => {
    const result = fuzzyMatch('cab', 'abc');
    expect(result.match).toBe(false);
    expect(result.score).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('FOO', 'foo bar').match).toBe(true);
    expect(fuzzyMatch('foo', 'FOOBAR').match).toBe(true);
  });

  it('rewards consecutive character matches over scattered ones', () => {
    const consecutive = fuzzyMatch('abc', 'abc XYZ').score;
    const scattered = fuzzyMatch('abc', 'aXXXbXXXcXXX').score;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('rewards a word-boundary match (after space/hyphen) over a mid-word match', () => {
    const boundary = fuzzyMatch('p', 'a p').score;
    const midword = fuzzyMatch('p', 'apple').score;
    // 'a p' — 'p' is at index 2, after a space, so it gets the word-boundary
    // bonus (+10). 'apple' — 'p' is at index 1, mid-word, no bonus.
    expect(boundary).toBeGreaterThan(midword);
  });
});

describe('filterAndSortActions', () => {
  const a1 = action({ id: '1', title: 'Open file', keywords: ['open', 'file'] });
  const a2 = action({ id: '2', title: 'Close file', keywords: ['close'] });
  const a3 = action({ id: '3', title: 'New project', subtitle: 'Create a new project', keywords: ['new'] });

  it('returns every action with recents first when query is empty', () => {
    const result = filterAndSortActions([a1, a2, a3], '', ['3', '1']);
    expect(result.map((r) => r.id)).toEqual(['3', '1', '2']);
  });

  it('returns matching actions sorted by score for non-empty queries', () => {
    const result = filterAndSortActions([a1, a2, a3], 'file', []);
    const ids = result.map((r) => r.id);
    expect(ids).toContain('1');
    expect(ids).toContain('2');
    expect(ids).not.toContain('3');
  });

  it('matches via keywords when the title does not', () => {
    const onlyKeyword = action({ id: 'kw', title: 'Toggle X', keywords: ['theme'] });
    const result = filterAndSortActions([onlyKeyword], 'theme', []);
    expect(result.map((r) => r.id)).toEqual(['kw']);
  });

  it('matches via subtitle', () => {
    const result = filterAndSortActions([a3], 'create', []);
    expect(result.map((r) => r.id)).toEqual(['3']);
  });

  it('drops actions that do not match anywhere', () => {
    const result = filterAndSortActions([a1, a2], 'zzzzz', []);
    expect(result).toEqual([]);
  });

  it('gives a recency bonus that can flip the order of two equally-matching actions', () => {
    const aa = action({ id: 'aa', title: 'foo bar' });
    const bb = action({ id: 'bb', title: 'foo bar' });
    const without = filterAndSortActions([aa, bb], 'foo', []);
    const withRecent = filterAndSortActions([aa, bb], 'foo', ['bb']);
    expect(without.map((r) => r.id)).toEqual(['aa', 'bb']);
    expect(withRecent.map((r) => r.id)).toEqual(['bb', 'aa']);
  });
});
