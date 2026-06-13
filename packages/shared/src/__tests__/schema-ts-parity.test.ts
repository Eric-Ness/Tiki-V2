/**
 * Schema-vs-TypeScript enum parity test (Issue #274, Epic #273).
 *
 * The JSON schemas under `packages/shared/schemas/*.schema.json` are the
 * AUTHORITATIVE source for the enum value sets. The hand-written TypeScript
 * union types in `packages/shared/src/types/*.ts` are rich, consumer-facing,
 * and intentionally NOT code-generated (see `.tiki/research/type-system-parity.md`).
 *
 * This test enforces — mechanically — that every hand-written TS union still
 * matches its schema enum. If it fails, the TS unions have drifted from the
 * schema (or vice versa): fix whichever side is wrong, do NOT relax this test.
 *
 * Mirrors the proven pattern in `transitions-parity.test.ts` (read a source
 * file, parse a structure, deep-compare to the canonical), but treats the JSON
 * schema as canonical rather than `transitions.ts`.
 *
 * Verified schema JSON paths (2026-06-13):
 *   WorkStatus       state.schema.json  $defs.workStatus.enum
 *   PhaseStatus      state.schema.json  $defs.phaseStatus.enum
 *   PipelineStep     state.schema.json  $defs.pipelineStep.enum
 *   (plan)PhaseStatus plan.schema.json  $defs.phaseStatus.enum  (must equal state's)
 *   CriteriaCategory plan.schema.json   $defs.criteriaCategory.enum
 *   AutoHealCategory config.schema.json $defs.autoHealConfig.properties.categories.items.enum  (INLINE)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSchema, schemaEnumAt, compareSets, repoRoot } from './_schema-enums.js';

// ---------------------------------------------------------------------------
// Schema-enum loader (loadSchema / at / schemaEnumAt / compareSets) is shared
// with schema-rust-parity.test.ts via ./_schema-enums.ts.
// ---------------------------------------------------------------------------

const stateSchema = loadSchema('state');
const planSchema = loadSchema('plan');
const configSchema = loadSchema('config');

const SCHEMA_ENUMS = {
  WorkStatus: schemaEnumAt(stateSchema, '$defs.workStatus.enum'),
  PhaseStatus: schemaEnumAt(stateSchema, '$defs.phaseStatus.enum'),
  PipelineStep: schemaEnumAt(stateSchema, '$defs.pipelineStep.enum'),
  CriteriaCategory: schemaEnumAt(planSchema, '$defs.criteriaCategory.enum'),
  AutoHealCategory: schemaEnumAt(
    configSchema,
    '$defs.autoHealConfig.properties.categories.items.enum'
  ),
} as const;

// plan.schema.json carries its own phaseStatus enum; it must equal state's.
const PLAN_PHASE_STATUS = schemaEnumAt(planSchema, '$defs.phaseStatus.enum');

// ---------------------------------------------------------------------------
// TS-source union parser
// ---------------------------------------------------------------------------

/**
 * Parse the string-literal members of an `export type <Name> = | 'a' | 'b';`
 * union out of a TypeScript source file. Handles the multi-line `| 'x'` form
 * used throughout `@tiki/shared` (and a single-line variant defensively).
 *
 * Returns the members in source order. Throws if the type is not found.
 */
function parseTsUnion(
  fileRelPath: string,
  typeName: string
): string[] {
  const file = resolve(repoRoot, fileRelPath);
  const src = readFileSync(file, 'utf-8');

  // Capture everything from `export type <Name> =` up to the terminating `;`.
  const declRe = new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`);
  const declMatch = src.match(declRe);
  if (!declMatch) {
    throw new Error(`could not locate "export type ${typeName} =" in ${fileRelPath}`);
  }
  const body = declMatch[1];

  // Each member is a single- or double-quoted string literal in the union.
  const memberRe = /['"]([^'"]+)['"]/g;
  const members: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = memberRe.exec(body)) !== null) {
    members.push(m[1]);
  }
  return members;
}

const TS_UNIONS = {
  WorkStatus: parseTsUnion('packages/shared/src/types/state.ts', 'WorkStatus'),
  PhaseStatus: parseTsUnion('packages/shared/src/types/state.ts', 'PhaseStatus'),
  PipelineStep: parseTsUnion('packages/shared/src/types/state.ts', 'PipelineStep'),
  CriteriaCategory: parseTsUnion('packages/shared/src/types/plan.ts', 'CriteriaCategory'),
  AutoHealCategory: parseTsUnion('packages/shared/src/types/config.ts', 'AutoHealCategory'),
} as const;

// ---------------------------------------------------------------------------
// Comparator (compareSets) is imported from ./_schema-enums.ts and shared with
// the drift-proof sub-test below.
// ---------------------------------------------------------------------------

function sorted(a: readonly string[]): string[] {
  return [...a].sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

type EnumName = keyof typeof SCHEMA_ENUMS;
const ENUM_NAMES = Object.keys(SCHEMA_ENUMS) as EnumName[];

const SCHEMA_SOURCE: Record<EnumName, string> = {
  WorkStatus: 'state.schema.json $defs.workStatus.enum',
  PhaseStatus: 'state.schema.json $defs.phaseStatus.enum',
  PipelineStep: 'state.schema.json $defs.pipelineStep.enum',
  CriteriaCategory: 'plan.schema.json $defs.criteriaCategory.enum',
  AutoHealCategory:
    'config.schema.json $defs.autoHealConfig.properties.categories.items.enum',
};

describe('schema-vs-TS enum parity', () => {
  describe.each(ENUM_NAMES.map((n) => [n] as const))('%s', (name) => {
    it('TS union member set deep-equals the schema enum set', () => {
      const tsMembers = TS_UNIONS[name];
      const schemaMembers = SCHEMA_ENUMS[name];
      const cmp = compareSets(tsMembers, schemaMembers);

      const detail =
        `${name}: TS union (src/types) drifted from schema (${SCHEMA_SOURCE[name]}).\n` +
        `  only in TS:     ${JSON.stringify(cmp.onlyInA)}\n` +
        `  only in schema: ${JSON.stringify(cmp.onlyInB)}`;

      // Deep-equal the sorted arrays so the assertion diff is human-readable,
      // with the actionable symmetric-difference message attached.
      expect(sorted(tsMembers), detail).toEqual(sorted(schemaMembers));
    });
  });

  it('plan.schema phaseStatus equals state.schema phaseStatus (single canonical PhaseStatus)', () => {
    const cmp = compareSets(PLAN_PHASE_STATUS, SCHEMA_ENUMS.PhaseStatus);
    expect(
      sorted(PLAN_PHASE_STATUS),
      `plan.schema phaseStatus diverged from state.schema phaseStatus — ` +
        `only in plan: ${JSON.stringify(cmp.onlyInA)}, only in state: ${JSON.stringify(cmp.onlyInB)}`
    ).toEqual(sorted(SCHEMA_ENUMS.PhaseStatus));
  });

  // SC4: prove the comparator (and therefore this whole test) actually catches
  // drift. Mutate a COPY of a parsed set — never the real source — and assert
  // the comparator reports inequality.
  describe('SC4 drift-proof — comparator catches a divergent member', () => {
    it('compareSets reports inequality when a bogus member is added to a copy', () => {
      const original = SCHEMA_ENUMS.WorkStatus;
      const mutatedCopy = [...original, 'bogus-drift-member']; // copy, not mutation
      const cmp = compareSets(mutatedCopy, original);

      expect(cmp.equal).toBe(false);
      expect(cmp.onlyInA).toContain('bogus-drift-member');
      expect(cmp.onlyInB).toEqual([]);
      // Sanity: the real source set was not mutated.
      expect(SCHEMA_ENUMS.WorkStatus).not.toContain('bogus-drift-member');
    });

    it('compareSets reports inequality when a member is removed from a copy', () => {
      const original = SCHEMA_ENUMS.PhaseStatus;
      const mutatedCopy = original.filter((m) => m !== 'skipped'); // copy, not mutation
      const cmp = compareSets(mutatedCopy, original);

      expect(cmp.equal).toBe(false);
      expect(cmp.onlyInB).toContain('skipped');
      expect(SCHEMA_ENUMS.PhaseStatus).toContain('skipped');
    });

    it('compareSets reports equality for identical sets (order-independent)', () => {
      const cmp = compareSets(
        ['a', 'b', 'c'],
        ['c', 'a', 'b']
      );
      expect(cmp.equal).toBe(true);
      expect(cmp.onlyInA).toEqual([]);
      expect(cmp.onlyInB).toEqual([]);
    });
  });

  // Parser-sanity: guard against a regex that silently matches nothing (which
  // would make every parity assertion vacuously "pass" against an empty set).
  describe('parser sanity — every parsed TS union is non-empty', () => {
    it.each(ENUM_NAMES.map((n) => [n] as const))(
      '%s parsed at least one member',
      (name) => {
        expect(TS_UNIONS[name].length, `TS union ${name} parsed empty`).toBeGreaterThan(0);
      }
    );

    it.each(ENUM_NAMES.map((n) => [n] as const))(
      '%s schema enum parsed at least one member',
      (name) => {
        expect(SCHEMA_ENUMS[name].length, `schema enum ${name} parsed empty`).toBeGreaterThan(0);
      }
    );
  });
});
