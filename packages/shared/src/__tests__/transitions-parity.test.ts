/**
 * Three-way parity test for the state-machine transition table.
 *
 * The canonical table lives at `packages/shared/src/types/transitions.ts`
 * (`VALID_TRANSITIONS`). It has two mirrors:
 *
 *   - `apps/desktop/src-tauri/src/state_transition.rs` — the Rust IPC the
 *     desktop app uses for typed state mutations.
 *   - `packages/framework/scripts/state.mjs` — the bash-callable Node CLI
 *     shim that framework commands invoke.
 *
 * Both mirrors carry an inline comment that says "this table must be kept
 * in sync with the canonical TS table." This test enforces that sync
 * mechanically by parsing each mirror's source and comparing it pair-for-pair
 * to the canonical table.
 *
 * If this test fails, the mirrors have drifted from `transitions.ts` (or vice
 * versa) — fix whichever side is wrong, do NOT relax this test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkStatus } from '../types/state.js';
import { VALID_TRANSITIONS } from '../types/transitions.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..', '..');

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

/**
 * Parse the LEGAL = { ... } object out of `state.mjs` and return it as a
 * status → Set<status> map.
 */
function parseJsShim(): Record<WorkStatus, Set<WorkStatus>> {
  const file = resolve(repoRoot, 'packages/framework/scripts/state.mjs');
  const src = readFileSync(file, 'utf-8');
  const blockMatch = src.match(/const LEGAL = \{([\s\S]*?)\n\};/);
  if (!blockMatch) {
    throw new Error('could not locate "const LEGAL = { ... };" block in state.mjs');
  }
  const body = blockMatch[1];

  const table: Record<WorkStatus, Set<WorkStatus>> = emptyTable();
  // Each line has the form: `  <status>: new Set([..items..]),`  or  `  completed: new Set(), // terminal`
  const lineRe = /(\w+):\s*new Set\((?:\[([^\]]*)\])?\)/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body)) !== null) {
    const from = m[1] as WorkStatus;
    if (!ALL_STATUSES.includes(from)) {
      throw new Error(`state.mjs LEGAL has unknown from-status: '${from}'`);
    }
    const itemsRaw = m[2] ?? '';
    const items = itemsRaw
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean) as WorkStatus[];
    for (const to of items) {
      if (!ALL_STATUSES.includes(to)) {
        throw new Error(`state.mjs LEGAL[${from}] has unknown to-status: '${to}'`);
      }
      table[from].add(to);
    }
  }
  return table;
}

/**
 * Parse the `is_legal_transition` match arms out of `state_transition.rs`
 * and return them as a status → Set<status> map.
 *
 * Only arms whose right-hand side is literally `true` are collected; the
 * `(Completed, _) => false` and final `_ => false` arms are intentionally
 * skipped.
 */
function parseRustImpl(): Record<WorkStatus, Set<WorkStatus>> {
  const file = resolve(repoRoot, 'apps/desktop/src-tauri/src/state_transition.rs');
  const src = readFileSync(file, 'utf-8');

  // Slice from `match (from, to) {` to the closing `}` of the function.
  const idx = src.indexOf('match (from, to) {');
  if (idx < 0) {
    throw new Error('could not locate "match (from, to) {" in state_transition.rs');
  }
  const body = src.slice(idx);

  const table: Record<WorkStatus, Set<WorkStatus>> = emptyTable();
  // Each true-arm: `( From , To ) | ( From , To ) | ... => true,`
  // Patterns can span multiple lines; we accept whitespace and pipe between pairs.
  const armRe = /((?:\(\s*\w+\s*,\s*\w+\s*\)\s*\|?\s*)+)=>\s*true/g;
  let m: RegExpExecArray | null;
  while ((m = armRe.exec(body)) !== null) {
    const pattern = m[1];
    const pairRe = /\(\s*(\w+)\s*,\s*(\w+)\s*\)/g;
    let p: RegExpExecArray | null;
    while ((p = pairRe.exec(pattern)) !== null) {
      const from = p[1].toLowerCase() as WorkStatus;
      const to = p[2].toLowerCase() as WorkStatus;
      // Skip wildcard patterns or unknown variants.
      if (!ALL_STATUSES.includes(from) || !ALL_STATUSES.includes(to)) {
        throw new Error(
          `state_transition.rs match arm has unknown variant pair: (${p[1]}, ${p[2]})`
        );
      }
      table[from].add(to);
    }
  }
  return table;
}

function emptyTable(): Record<WorkStatus, Set<WorkStatus>> {
  return {
    pending: new Set(),
    reviewing: new Set(),
    planning: new Set(),
    executing: new Set(),
    shipping: new Set(),
    paused: new Set(),
    failed: new Set(),
    completed: new Set(),
  };
}

function sortedArray(s: Set<WorkStatus>): WorkStatus[] {
  return [...s].sort() as WorkStatus[];
}

describe('three-way transition table parity', () => {
  const js = parseJsShim();
  const rust = parseRustImpl();

  describe.each(ALL_STATUSES.map((s) => [s] as const))('from %s', (from) => {
    const expected = sortedArray(VALID_TRANSITIONS[from] as Set<WorkStatus>);

    it('JS shim (state.mjs) matches canonical table', () => {
      expect(sortedArray(js[from])).toEqual(expected);
    });

    it('Rust impl (state_transition.rs) matches canonical table', () => {
      expect(sortedArray(rust[from])).toEqual(expected);
    });
  });

  it('parser sanity — JS shim has at least one entry for every non-terminal status', () => {
    for (const from of ALL_STATUSES) {
      if (from === 'completed') continue; // terminal, empty by design
      expect(js[from].size, `js[${from}].size`).toBeGreaterThan(0);
    }
  });

  it('parser sanity — Rust impl has at least one entry for every non-terminal status', () => {
    for (const from of ALL_STATUSES) {
      if (from === 'completed') continue;
      expect(rust[from].size, `rust[${from}].size`).toBeGreaterThan(0);
    }
  });
});
