/**
 * Shared test helpers for the schema-parity tests (Issue #274, Epic #273).
 *
 * The JSON schemas under `packages/shared/schemas/*.schema.json` are the
 * AUTHORITATIVE source for the enum value sets. Both `schema-ts-parity.test.ts`
 * and `schema-rust-parity.test.ts` load those enums and deep-compare a parsed
 * representation (TS union / Rust enum) against them. This module extracts the
 * schema-loading + comparison primitives so both tests share one definition.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Repo root: up four levels from packages/shared/src/__tests__/. */
export const repoRoot = resolve(__dirname, '..', '..', '..', '..');

/** Read + JSON.parse a schema file under packages/shared/schemas/. */
export function loadSchema(name: 'state' | 'plan' | 'config'): unknown {
  const file = resolve(repoRoot, 'packages/shared/schemas', `${name}.schema.json`);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

/**
 * Walk a dotted path into a parsed JSON object and return the value, throwing
 * a clear error if any segment is missing. Used to pin the EXACT location of
 * each enum so a schema refactor that moves an enum is caught loudly rather
 * than silently producing `undefined`.
 */
export function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  const segments = path.split('.');
  for (const seg of segments) {
    if (cur == null || typeof cur !== 'object') {
      throw new Error(`schema path '${path}' broke at segment '${seg}' (parent not an object)`);
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Pull a `string[]` enum out of a schema at the given dotted path. */
export function schemaEnumAt(schema: unknown, path: string): string[] {
  const value = at(schema, path);
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`schema enum at '${path}' is not a string[] (got: ${JSON.stringify(value)})`);
  }
  return value as string[];
}

/**
 * Pure set comparison. Returns whether the two member lists are equal as sets
 * (order-independent, duplicate-insensitive) plus the symmetric difference so
 * a failure message can name exactly what diverged.
 */
export function compareSets(
  a: readonly string[],
  b: readonly string[]
): { equal: boolean; onlyInA: string[]; onlyInB: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  const onlyInA = [...setA].filter((x) => !setB.has(x)).sort();
  const onlyInB = [...setB].filter((x) => !setA.has(x)).sort();
  return { equal: onlyInA.length === 0 && onlyInB.length === 0, onlyInA, onlyInB };
}
