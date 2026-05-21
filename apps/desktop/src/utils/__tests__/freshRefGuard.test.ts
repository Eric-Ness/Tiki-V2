/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Fresh-ref guard (issue #222, epic #218) — a regression test against the
 * #210/#212 crash class.
 *
 * Background: React 19's `useSyncExternalStore` re-renders forever ("Maximum
 * update depth exceeded") when a Zustand selector RETURNS a freshly-allocated
 * reference each call, or when a fresh literal sits in a hook DEPENDENCY ARRAY
 * (a new `[]`/`{}` every render defeats memo equality). Inline `?? []` / `?? {}`
 * / `|| []` / `|| {}` fallbacks in those two contexts are exactly that. The fix
 * (v0.6.5) was module-scope `EMPTY_*` constants (e.g. `EMPTY_TABS`,
 * `EMPTY_COLUMN_ORDER`).
 *
 * Note: a `?? []` inside a plain `const x = ...` local, a store-action body, or
 * the BODY of a `useMemo` callback is harmless — only selector returns and
 * dependency-array entries trigger the crash. This guard therefore flags a
 * fresh-ref fallback ONLY in those two hook-sensitive contexts, never every
 * `?? []` in any function body.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// __tests__ -> utils -> src
const srcDir = path.resolve(here, '..', '..');

/** Files where a fresh-ref fallback would cause the #210/#212 crash class. */
const GUARDED_FILES = [
  'utils/deriveDisplayStatus.ts',
  'utils/githubRefreshTriggers.ts',
  'stores/tikiStateStore.ts',
  'stores/terminalStore.ts',
  'stores/kanbanStore.ts',
  'components/kanban/KanbanBoard.tsx',
  'components/detail/IssueDetail.tsx',
];

/** Matches `?? []`, `?? {}`, `|| []`, `|| {}` (the fresh-allocation fallbacks). */
const FRESH_REF_RE = /(\?\?|\|\|)\s*(\[\]|\{\})/;

/** A Zustand store-selector call — its return value feeds useSyncExternalStore. */
const STORE_SELECTOR_RE = /\buse[A-Za-z]*Store\s*\(/;

/**
 * A hook dependency-array tail: `}, [ ... ]);` / `, [ ... ]);` — the closing
 * argument of useMemo/useCallback/useEffect. A fresh literal here is re-created
 * every render and silently breaks memoization.
 */
const DEP_ARRAY_RE = /\]\s*\)\s*;?\s*$/;

/**
 * Allowed: a module-scope `EMPTY_*` (SCREAMING_SNAKE) constant definition whose
 * initializer uses the fallback, e.g. `export const EMPTY_FOO = config ?? []`.
 * Real `EMPTY_*` defs in the codebase use `= []` / `= {}` (no operator, never
 * matching FRESH_REF_RE), so this allowance is purely defensive.
 */
const EMPTY_CONST_DECL_RE = /^(export\s+)?const\s+EMPTY_[A-Z0-9_]*\s*(:|=)/;

/**
 * Returns the 1-based line numbers in `source` that contain a fresh-ref
 * fallback in a hook-sensitive context (Zustand selector return OR dependency
 * array), excluding allowed `EMPTY_*` constant definitions.
 */
export function findFreshRefViolations(source: string): number[] {
  const violations: number[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = FRESH_REF_RE.exec(line);
    if (!match) continue;

    const trimmed = line.trim();

    // Allowed: the EMPTY_* constant definitions themselves.
    const eqIndex = line.indexOf('=');
    if (EMPTY_CONST_DECL_RE.test(trimmed) && eqIndex !== -1 && eqIndex < match.index) {
      continue;
    }

    // Dangerous context #1: a Zustand selector call on this line (its return
    // value is the fresh ref useSyncExternalStore re-reads).
    const inSelector = STORE_SELECTOR_RE.test(line);
    // Dangerous context #2: a hook dependency-array tail line.
    const inDepArray = DEP_ARRAY_RE.test(trimmed);

    if (inSelector || inDepArray) {
      violations.push(i + 1);
    }
  }
  return violations;
}

describe('fresh-ref guard (#210/#212 regression)', () => {
  it('no fresh-ref ?? [] / ?? {} / || [] / || {} in selector returns or dep arrays', () => {
    const violations: string[] = [];
    for (const rel of GUARDED_FILES) {
      const abs = path.resolve(srcDir, rel);
      const source = readFileSync(abs, 'utf8');
      for (const lineNo of findFreshRefViolations(source)) {
        violations.push(`${rel}:${lineNo}`);
      }
    }
    expect(
      violations,
      `Found fresh-ref fallback(s) in a Zustand selector return or a hook ` +
        `dependency array — the #210/#212 useSyncExternalStore crash class. Use ` +
        `a module-scope EMPTY_* constant instead of an inline ?? [] / ?? {} / ` +
        `|| [] / || {}:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('resolves all guarded files (paths are correct)', () => {
    for (const rel of GUARDED_FILES) {
      const abs = path.resolve(srcDir, rel);
      // readFileSync throws if the path is wrong — proves the resolution works.
      expect(readFileSync(abs, 'utf8').length).toBeGreaterThan(0);
    }
  });

  it('detection function flags a fresh ref returned from a store selector', () => {
    const bad = 'const tabs = useTerminalStore((s) => s.tabsByProject[id] ?? []);';
    expect(findFreshRefViolations(bad)).toEqual([1]);

    const badObj = 'const m = useKanbanStore((s) => s.orderByColumn[id] ?? {});';
    expect(findFreshRefViolations(badObj)).toEqual([1]);
  });

  it('detection function flags a fresh ref in a hook dependency array', () => {
    const badDep = '  }, [issues, activeWork ?? []]);';
    expect(findFreshRefViolations(badDep)).toEqual([1]);
  });

  it('detection function allows an EMPTY_* module-scope constant definition', () => {
    const okConst = 'export const EMPTY_TABS = config ?? [];';
    expect(findFreshRefViolations(okConst)).toEqual([]);

    const okConstNoExport = 'const EMPTY_MAP = source ?? {};';
    expect(findFreshRefViolations(okConstNoExport)).toEqual([]);
  });

  it('detection function allows a safe ?? [] in a store-action body (not a selector)', () => {
    const okLocal = '          const tabs = state.tabsByProject[projectId] ?? [];';
    expect(findFreshRefViolations(okLocal)).toEqual([]);
  });
});
