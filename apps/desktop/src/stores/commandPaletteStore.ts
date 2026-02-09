import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// --- Types ---

export type CommandCategory = 'navigation' | 'project' | 'issue' | 'release' | 'command';

export interface CommandAction {
  id: string;
  title: string;
  subtitle?: string;
  category: CommandCategory;
  keywords: string[];
  icon?: string;
  shortcut?: string;
  execute: () => void;
}

// --- Fuzzy Search ---

export interface FuzzyMatchResult {
  match: boolean;
  score: number;
}

/**
 * Fuzzy-match each character of `query` in order within `text` (case-insensitive).
 * Score rewards:
 *  - Consecutive character matches
 *  - Matches at word boundaries (after space, hyphen, or start of text)
 *  - Earlier match positions
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatchResult {
  if (query.length === 0) {
    return { match: true, score: 0 };
  }

  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();

  let queryIndex = 0;
  let score = 0;
  let lastMatchIndex = -1;
  let consecutiveCount = 0;

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      // Consecutive match bonus
      if (lastMatchIndex === i - 1) {
        consecutiveCount++;
        score += consecutiveCount * 5;
      } else {
        consecutiveCount = 0;
      }

      // Word boundary bonus (start of text, after space/hyphen/underscore)
      if (i === 0 || /[\s\-_]/.test(lowerText[i - 1])) {
        score += 10;
      }

      // Earlier position bonus (max 10 points, decaying)
      score += Math.max(0, 10 - i);

      lastMatchIndex = i;
      queryIndex++;
    }
  }

  // All query characters must be found in order
  if (queryIndex < lowerQuery.length) {
    return { match: false, score: 0 };
  }

  return { match: true, score };
}

/**
 * Filter and sort actions by fuzzy-matching the query against title, subtitle, and keywords.
 * When query is empty, returns all actions with recently-used ones first.
 * When query is non-empty, returns matched actions sorted by score (descending),
 * with recently-used actions receiving a bonus.
 */
export function filterAndSortActions(
  actions: CommandAction[],
  query: string,
  recentIds: string[]
): CommandAction[] {
  if (query.length === 0) {
    // No query: show all, with recents first
    const recentSet = new Set(recentIds);
    const recents: CommandAction[] = [];
    const rest: CommandAction[] = [];

    for (const action of actions) {
      if (recentSet.has(action.id)) {
        recents.push(action);
      } else {
        rest.push(action);
      }
    }

    // Sort recents by their order in recentIds (most recent first)
    recents.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));

    return [...recents, ...rest];
  }

  // Score each action against the query
  const scored: Array<{ action: CommandAction; score: number }> = [];

  for (const action of actions) {
    const titleResult = fuzzyMatch(query, action.title);
    const subtitleResult = action.subtitle ? fuzzyMatch(query, action.subtitle) : { match: false, score: 0 };

    let bestKeywordScore = 0;
    for (const keyword of action.keywords) {
      const keywordResult = fuzzyMatch(query, keyword);
      if (keywordResult.match && keywordResult.score > bestKeywordScore) {
        bestKeywordScore = keywordResult.score;
      }
    }

    // Take the best score across title, subtitle, and keywords
    const bestScore = Math.max(
      titleResult.match ? titleResult.score : 0,
      subtitleResult.match ? subtitleResult.score : 0,
      bestKeywordScore
    );

    const hasMatch = titleResult.match || subtitleResult.match || bestKeywordScore > 0;

    if (hasMatch) {
      // Boost recently-used actions
      const recentIndex = recentIds.indexOf(action.id);
      const recentBonus = recentIndex >= 0 ? (recentIds.length - recentIndex) * 2 : 0;

      scored.push({ action, score: bestScore + recentBonus });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.map((s) => s.action);
}

// --- Store ---

const MAX_RECENT_COMMANDS = 10;

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  recentCommandIds: string[];
}

interface CommandPaletteActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  addRecentCommand: (id: string) => void;
}

type CommandPaletteStore = CommandPaletteState & CommandPaletteActions;

export const useCommandPaletteStore = create<CommandPaletteStore>()(
  persist(
    (set) => ({
      isOpen: false,
      query: '',
      selectedIndex: 0,
      recentCommandIds: [],

      open: () =>
        set({
          isOpen: true,
          query: '',
          selectedIndex: 0,
        }),

      close: () =>
        set({
          isOpen: false,
        }),

      toggle: () =>
        set((state) => ({
          isOpen: !state.isOpen,
          ...(state.isOpen
            ? {}
            : { query: '', selectedIndex: 0 }),
        })),

      setQuery: (query: string) =>
        set({
          query,
          selectedIndex: 0,
        }),

      setSelectedIndex: (index: number) =>
        set({
          selectedIndex: index,
        }),

      addRecentCommand: (id: string) =>
        set((state) => {
          const filtered = state.recentCommandIds.filter((existingId) => existingId !== id);
          return {
            recentCommandIds: [id, ...filtered].slice(0, MAX_RECENT_COMMANDS),
          };
        }),
    }),
    {
      name: 'tiki-command-palette',
      partialize: (state) => ({ recentCommandIds: state.recentCommandIds }),
    }
  )
);
