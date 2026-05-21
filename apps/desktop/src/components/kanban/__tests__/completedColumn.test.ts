import { describe, it, expect } from 'vitest';
import {
  collectCompletedIssueNumbers,
  buildCompletedCards,
} from '../completedColumn';
import type { CompletedIssue, CompletedRelease } from '../../../stores';

describe('completedColumn helpers (issue #219)', () => {
  describe('v0.6.6 shape: release children missing from recentIssues', () => {
    // Mirrors the live bug: recentIssues has 212/211 but NOT 214/215/216;
    // those three live only in recentReleases[0].issues = [216, 214, 215].
    const recentIssues: CompletedIssue[] = [
      { number: 212, title: 'Fix blank screen v2', completedAt: '2026-05-19T00:00:00Z' },
      { number: 211, title: 'Kanban pipeline fix', completedAt: '2026-05-19T01:00:00Z' },
    ];
    const recentReleases: CompletedRelease[] = [
      {
        version: 'v0.6.6',
        issues: [216, 214, 215],
        completedAt: '2026-05-20T00:00:00Z',
        tag: 'v0.6.6',
      },
    ];

    it('collectCompletedIssueNumbers unions recentIssues + release children', () => {
      const set = collectCompletedIssueNumbers(recentIssues, recentReleases);
      expect(set.has(212)).toBe(true);
      expect(set.has(211)).toBe(true);
      expect(set.has(214)).toBe(true);
      expect(set.has(215)).toBe(true);
      expect(set.has(216)).toBe(true);
      expect(set.size).toBe(5);
    });

    it('buildCompletedcards renders 214/215/216 exactly once each (no dupes)', () => {
      const cards = buildCompletedCards(recentIssues, recentReleases);
      const count = (n: number) => cards.filter((c) => c.number === n).length;
      expect(count(214)).toBe(1);
      expect(count(215)).toBe(1);
      expect(count(216)).toBe(1);
      // and the synthesized release children use the placeholder title
      const c214 = cards.find((c) => c.number === 214);
      expect(c214?.title).toBe('Issue #214');
      expect(c214?.state).toBe('CLOSED');
      // all five completed items present, none duplicated
      expect(cards).toHaveLength(5);
      const numbers = cards.map((c) => c.number).sort((a, b) => a - b);
      expect(numbers).toEqual([211, 212, 214, 215, 216]);
    });
  });

  describe('overlap: number in BOTH recentIssues and a release', () => {
    const recentIssues: CompletedIssue[] = [
      { number: 300, title: 'Real title from recentIssues', completedAt: '2026-05-20T00:00:00Z' },
    ];
    const recentReleases: CompletedRelease[] = [
      { version: 'v9.9', issues: [300, 301], completedAt: '2026-05-20T00:00:00Z' },
    ];

    it('appears once, with the recentIssues title (not the placeholder)', () => {
      const cards = buildCompletedCards(recentIssues, recentReleases);
      const matches = cards.filter((c) => c.number === 300);
      expect(matches).toHaveLength(1);
      expect(matches[0].title).toBe('Real title from recentIssues');
      // the release-only child (301) is still synthesized
      expect(cards.find((c) => c.number === 301)?.title).toBe('Issue #301');
      expect(cards).toHaveLength(2);
    });

    it('exclusion set counts the overlapping number once', () => {
      const set = collectCompletedIssueNumbers(recentIssues, recentReleases);
      expect(set.has(300)).toBe(true);
      expect(set.has(301)).toBe(true);
      expect(set.size).toBe(2);
    });
  });

  describe('uncapped exclusion set (>8 completed numbers)', () => {
    const recentIssues: CompletedIssue[] = Array.from({ length: 6 }, (_, i) => ({
      number: 100 + i,
      title: `Issue ${100 + i}`,
      completedAt: '2026-05-20T00:00:00Z',
    }));
    const recentReleases: CompletedRelease[] = [
      { version: 'vBig', issues: [200, 201, 202, 203, 204], completedAt: '2026-05-20T00:00:00Z' },
    ];

    it('includes ALL completed numbers, not just the first 8', () => {
      const set = collectCompletedIssueNumbers(recentIssues, recentReleases);
      expect(set.size).toBe(11);
      for (let i = 0; i < 6; i++) expect(set.has(100 + i)).toBe(true);
      for (const n of [200, 201, 202, 203, 204]) expect(set.has(n)).toBe(true);
    });
  });

  describe('cap and sort', () => {
    it('caps buildCompletedCards at the given cap, newest first', () => {
      const recentIssues: CompletedIssue[] = Array.from({ length: 60 }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
        // higher index = more recent
        completedAt: new Date(2026, 0, 1, 0, i).toISOString(),
      }));
      const cards = buildCompletedCards(recentIssues, [], 50);
      expect(cards).toHaveLength(50);
      // newest (highest minute = number 60) comes first
      expect(cards[0].number).toBe(60);
      // sorted strictly descending by completedAt
      for (let i = 1; i < cards.length; i++) {
        expect(new Date(cards[i - 1].updatedAt).getTime()).toBeGreaterThanOrEqual(
          new Date(cards[i].updatedAt).getTime(),
        );
      }
    });
  });

  describe('empty inputs', () => {
    it('returns an empty set and empty cards', () => {
      expect(collectCompletedIssueNumbers([], []).size).toBe(0);
      expect(buildCompletedCards([], [])).toEqual([]);
    });
  });
});
