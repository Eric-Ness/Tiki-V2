/**
 * Schema-vs-shim enum parity test (Issue #275, Epic #273).
 *
 * The JSON schemas under `packages/shared/schemas/*.schema.json` are the
 * AUTHORITATIVE source for the enum value sets (see schema-ts-parity.test.ts
 * and schema-rust-parity.test.ts). The Tiki state CLI shim
 * `packages/framework/scripts/state.mjs` hand-rolls its own validation enum
 * constants (no ajv — the Windows pnpm reparse-point block makes adding deps
 * painful), so this test mechanically asserts that each of those EXPORTED
 * `VALID_*` array literals still matches its schema enum. If it fails, the
 * shim's validation has drifted from the schema — fix the shim (or the
 * schema), do NOT relax this test. This is the exact drift class Epic #273
 * exists to kill: the shim is now the single framework-side source for these
 * sets (plan.mjs imports them), so pinning them to the schemas keeps every
 * validation path honest.
 *
 * Mirrors schema-rust-parity.test.ts but parses JS `const VALID_X = [...]`
 * array literals out of state.mjs instead of Rust enum declarations. Reuses the
 * shared schema-enum loader (`./_schema-enums.ts`).
 *
 * shim const → schema enum:
 *   VALID_WORK_STATUS    → state.schema  $defs.workStatus.enum
 *   VALID_PHASE_STATUS   → plan.schema   $defs.phaseStatus.enum
 *   VALID_STEPS          → state.schema  $defs.pipelineStep.enum
 *   VALID_HEAL_CATEGORY  → config.schema $defs.autoHealConfig.properties.categories.items.enum
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSchema, schemaEnumAt, compareSets, repoRoot } from './_schema-enums.js';

// ---------------------------------------------------------------------------
// Schema enums (canonical)
// ---------------------------------------------------------------------------

const stateSchema = loadSchema('state');
const planSchema = loadSchema('plan');
const configSchema = loadSchema('config');

const SCHEMA_ENUMS = {
  workStatus: schemaEnumAt(stateSchema, '$defs.workStatus.enum'),
  pipelineStep: schemaEnumAt(stateSchema, '$defs.pipelineStep.enum'),
  phaseStatus: schemaEnumAt(planSchema, '$defs.phaseStatus.enum'),
  autoHealCategory: schemaEnumAt(
    configSchema,
    '$defs.autoHealConfig.properties.categories.items.enum'
  ),
} as const;

// ---------------------------------------------------------------------------
// shim-source enum parser
// ---------------------------------------------------------------------------

/**
 * Parse the string-literal members of a `const <NAME> = [ ... ];` array literal
 * out of a JS source string.
 *
 * Rules:
 *  - Locate `const <NAME>` and the following `[` ... matching `]`.
 *  - Extract every single- or double-quoted string literal inside.
 *  - Trailing `// ...` comments on the declaration line are harmless (we only
 *    pull quoted tokens, never bareword identifiers).
 *
 * Returns the members in source order. Throws if the const can't be located or
 * the bracket is unbalanced, so a rename/refactor of the shim is caught loudly
 * rather than silently yielding an empty set.
 */
function parseShimEnum(src: string, constName: string): string[] {
  const declRe = new RegExp(`const\\s+${constName}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(src);
  if (!declMatch) {
    throw new Error(`could not locate "const ${constName} = [" in state.mjs`);
  }

  const openIdx = src.indexOf('[', declMatch.index);
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    throw new Error(`unbalanced brackets parsing "const ${constName}" in state.mjs`);
  }

  const body = src.slice(openIdx + 1, closeIdx);
  const members: string[] = [];
  // Match single- or double-quoted string literals.
  const strRe = /"([^"]*)"|'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(body)) !== null) {
    members.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return members;
}

const stateMjsPath = resolve(repoRoot, 'packages/framework/scripts/state.mjs');
const stateMjs = readFileSync(stateMjsPath, 'utf-8');

const SHIM_ENUMS = {
  VALID_WORK_STATUS: parseShimEnum(stateMjs, 'VALID_WORK_STATUS'),
  VALID_PHASE_STATUS: parseShimEnum(stateMjs, 'VALID_PHASE_STATUS'),
  VALID_STEPS: parseShimEnum(stateMjs, 'VALID_STEPS'),
  VALID_HEAL_CATEGORY: parseShimEnum(stateMjs, 'VALID_HEAL_CATEGORY'),
} as const;

function sorted(a: readonly string[]): string[] {
  return [...a].sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('schema-vs-shim enum parity (state.mjs VALID_* ↔ schemas)', () => {
  it('VALID_WORK_STATUS deep-equals state.schema workStatus enum', () => {
    const cmp = compareSets(SHIM_ENUMS.VALID_WORK_STATUS, SCHEMA_ENUMS.workStatus);
    expect(
      sorted(SHIM_ENUMS.VALID_WORK_STATUS),
      `VALID_WORK_STATUS (state.mjs) drifted from state.schema workStatus.\n` +
        `  only in shim:   ${JSON.stringify(cmp.onlyInA)}\n` +
        `  only in schema: ${JSON.stringify(cmp.onlyInB)}`
    ).toEqual(sorted(SCHEMA_ENUMS.workStatus));
  });

  it('VALID_PHASE_STATUS deep-equals plan.schema phaseStatus enum', () => {
    const cmp = compareSets(SHIM_ENUMS.VALID_PHASE_STATUS, SCHEMA_ENUMS.phaseStatus);
    expect(
      sorted(SHIM_ENUMS.VALID_PHASE_STATUS),
      `VALID_PHASE_STATUS (state.mjs) drifted from plan.schema phaseStatus.\n` +
        `  only in shim:   ${JSON.stringify(cmp.onlyInA)}\n` +
        `  only in schema: ${JSON.stringify(cmp.onlyInB)}`
    ).toEqual(sorted(SCHEMA_ENUMS.phaseStatus));
  });

  it('VALID_STEPS deep-equals state.schema pipelineStep enum', () => {
    const cmp = compareSets(SHIM_ENUMS.VALID_STEPS, SCHEMA_ENUMS.pipelineStep);
    expect(
      sorted(SHIM_ENUMS.VALID_STEPS),
      `VALID_STEPS (state.mjs) drifted from state.schema pipelineStep.\n` +
        `  only in shim:   ${JSON.stringify(cmp.onlyInA)}\n` +
        `  only in schema: ${JSON.stringify(cmp.onlyInB)}`
    ).toEqual(sorted(SCHEMA_ENUMS.pipelineStep));
  });

  it('VALID_HEAL_CATEGORY deep-equals config.schema autoHealConfig categories enum', () => {
    const cmp = compareSets(SHIM_ENUMS.VALID_HEAL_CATEGORY, SCHEMA_ENUMS.autoHealCategory);
    expect(
      sorted(SHIM_ENUMS.VALID_HEAL_CATEGORY),
      `VALID_HEAL_CATEGORY (state.mjs) drifted from config.schema autoHealConfig.categories.\n` +
        `  only in shim:   ${JSON.stringify(cmp.onlyInA)}\n` +
        `  only in schema: ${JSON.stringify(cmp.onlyInB)}`
    ).toEqual(sorted(SCHEMA_ENUMS.autoHealCategory));
  });

  // Drift-proof: prove the comparison actually catches drift. Mutate a COPY of
  // the parsed set — never the real source — and assert the comparator reports
  // inequality both ways.
  describe('drift-proof — comparator catches a divergent shim const', () => {
    it('compareSets reports inequality when a bogus member is added to a copy', () => {
      const original = SHIM_ENUMS.VALID_WORK_STATUS;
      const mutatedCopy = [...original, 'bogus-shim-status']; // copy, not mutation
      const cmp = compareSets(mutatedCopy, original);

      expect(cmp.equal).toBe(false);
      expect(cmp.onlyInA).toContain('bogus-shim-status');
      expect(cmp.onlyInB).toEqual([]);
      // Sanity: the real parsed set was not mutated.
      expect(SHIM_ENUMS.VALID_WORK_STATUS).not.toContain('bogus-shim-status');
    });

    it('compareSets reports inequality when a member is removed from a copy', () => {
      const original = SHIM_ENUMS.VALID_PHASE_STATUS;
      const mutatedCopy = original.filter((m) => m !== 'skipped'); // copy, not mutation
      const cmp = compareSets(mutatedCopy, original);

      expect(cmp.equal).toBe(false);
      expect(cmp.onlyInB).toContain('skipped');
      expect(SHIM_ENUMS.VALID_PHASE_STATUS).toContain('skipped');
    });
  });

  // Parser-sanity: guard against a parser that silently matches nothing or that
  // mis-counts the literals (e.g. a regex that drops a member).
  describe('parser sanity', () => {
    it('VALID_PHASE_STATUS parses to EXACTLY its 5 canonical members', () => {
      expect(sorted(SHIM_ENUMS.VALID_PHASE_STATUS)).toEqual(
        sorted(['pending', 'executing', 'completed', 'failed', 'skipped'])
      );
    });

    it('VALID_HEAL_CATEGORY parses to EXACTLY its 5 canonical members', () => {
      expect(sorted(SHIM_ENUMS.VALID_HEAL_CATEGORY)).toEqual(
        sorted(['build-error', 'type-error', 'test-failure', 'lint-error', 'other'])
      );
    });

    it.each(
      (Object.keys(SHIM_ENUMS) as (keyof typeof SHIM_ENUMS)[]).map((n) => [n] as const)
    )('%s parsed at least one member', (name) => {
      expect(SHIM_ENUMS[name].length, `shim enum ${name} parsed empty`).toBeGreaterThan(0);
    });

    it('parseShimEnum throws on a non-existent const (loud failure on rename)', () => {
      expect(() => parseShimEnum(stateMjs, 'VALID_DOES_NOT_EXIST')).toThrow(/could not locate/);
    });
  });
});
