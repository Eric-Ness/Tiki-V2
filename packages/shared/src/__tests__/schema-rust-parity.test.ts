/**
 * Schema-vs-Rust enum parity test (Issue #274, Epic #273).
 *
 * The JSON schemas under `packages/shared/schemas/*.schema.json` are the
 * AUTHORITATIVE source for the enum value sets (see schema-ts-parity.test.ts).
 * The hand-written Rust enums in `apps/desktop/src-tauri/src/state.rs` are
 * intentionally lenient deserializers (#57/#69) — NOT code-generated — so this
 * test mechanically asserts that each Rust enum's CANONICAL variant set still
 * matches its schema enum. If it fails, the Rust side has drifted; fix the Rust
 * source (or schema), do NOT relax this test.
 *
 * Mirrors schema-ts-parity.test.ts but parses Rust enum declarations instead of
 * TS unions. Reuses the shared schema-enum loader (`./_schema-enums.ts`).
 *
 * Rust → schema casing (each enum's `#[serde(rename_all=...)]`):
 *   WorkStatus           rename_all="lowercase"             → lowercase variants
 *   PhaseProgressStatus  rename_all="lowercase"             → lowercase variants
 *   PhaseStatus (plan)   rename_all="lowercase"             → lowercase variants
 *   PipelineStep         rename_all="SCREAMING_SNAKE_CASE"  → UPPERCASE variants
 *
 * `#[serde(alias = "...")]` values are EXTRA accepted *inputs*, never canonical
 * schema values, so the parser strips alias lines before building the variant
 * set. `#[serde(...)]` attribute lines and `///` doc comments between variants
 * are skipped.
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

const SCHEMA_ENUMS = {
  workStatus: schemaEnumAt(stateSchema, '$defs.workStatus.enum'),
  pipelineStep: schemaEnumAt(stateSchema, '$defs.pipelineStep.enum'),
  phaseStatus: schemaEnumAt(planSchema, '$defs.phaseStatus.enum'),
} as const;

// ---------------------------------------------------------------------------
// Rust-source enum parser
// ---------------------------------------------------------------------------

type RustCasing = 'lowercase' | 'screaming_snake';

/** PascalCase variant ident → SCREAMING_SNAKE_CASE (e.g. Get → GET). */
function toScreamingSnake(ident: string): string {
  return ident
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
}

/**
 * Parse the canonical variant identifiers of `pub enum <Name> { ... }` from a
 * Rust source string and map each to its serialized (schema) casing.
 *
 * Rules:
 *  - Skip `#[serde(...)]` (and any `#[...]`) attribute lines.
 *  - Skip `///` and `//` doc/comment lines.
 *  - `#[serde(alias = "...")]` values are extra accepted INPUTS, not canonical;
 *    because attribute lines are skipped entirely, aliases never enter the set.
 *  - A variant is a bare `Ident` or `Ident(...)` / `Ident {...}` line, ending in
 *    `,` (or just whitespace before the closing brace).
 *
 * Returns the canonical variants in source order (cased per `casing`).
 */
function parseRustEnum(src: string, enumName: string, casing: RustCasing): string[] {
  const declRe = new RegExp(`pub\\s+enum\\s+${enumName}\\s*\\{`);
  const declMatch = declRe.exec(src);
  if (!declMatch) {
    throw new Error(`could not locate "pub enum ${enumName} {" in state.rs`);
  }

  // Walk braces from the opening `{` to find the matching close.
  const openIdx = src.indexOf('{', declMatch.index);
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    throw new Error(`unbalanced braces parsing "pub enum ${enumName}" in state.rs`);
  }

  const body = src.slice(openIdx + 1, closeIdx);
  const variants: string[] = [];

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('//')) continue; // /// and // comments
    if (line.startsWith('#[')) continue; // serde / other attribute lines (incl. alias)

    // A variant line begins with a PascalCase identifier.
    const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (!m) continue;
    const ident = m[1];
    variants.push(casing === 'screaming_snake' ? toScreamingSnake(ident) : ident.toLowerCase());
  }

  return variants;
}

const stateRsPath = resolve(repoRoot, 'apps/desktop/src-tauri/src/state.rs');
const stateRs = readFileSync(stateRsPath, 'utf-8');

const RUST_ENUMS = {
  WorkStatus: parseRustEnum(stateRs, 'WorkStatus', 'lowercase'),
  PipelineStep: parseRustEnum(stateRs, 'PipelineStep', 'screaming_snake'),
  PhaseProgressStatus: parseRustEnum(stateRs, 'PhaseProgressStatus', 'lowercase'),
  PhaseStatus: parseRustEnum(stateRs, 'PhaseStatus', 'lowercase'),
} as const;

function sorted(a: readonly string[]): string[] {
  return [...a].sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('schema-vs-Rust enum parity', () => {
  it('WorkStatus variant set deep-equals state.schema workStatus enum', () => {
    const cmp = compareSets(RUST_ENUMS.WorkStatus, SCHEMA_ENUMS.workStatus);
    expect(
      sorted(RUST_ENUMS.WorkStatus),
      `WorkStatus (state.rs) drifted from state.schema workStatus.\n` +
        `  only in Rust:   ${JSON.stringify(cmp.onlyInA)}\n` +
        `  only in schema: ${JSON.stringify(cmp.onlyInB)}`
    ).toEqual(sorted(SCHEMA_ENUMS.workStatus));
  });

  it('PipelineStep variant set deep-equals state.schema pipelineStep enum (SCREAMING_SNAKE)', () => {
    const cmp = compareSets(RUST_ENUMS.PipelineStep, SCHEMA_ENUMS.pipelineStep);
    expect(
      sorted(RUST_ENUMS.PipelineStep),
      `PipelineStep (state.rs) drifted from state.schema pipelineStep.\n` +
        `  only in Rust:   ${JSON.stringify(cmp.onlyInA)}\n` +
        `  only in schema: ${JSON.stringify(cmp.onlyInB)}`
    ).toEqual(sorted(SCHEMA_ENUMS.pipelineStep));
  });

  it('plan PhaseStatus variant set deep-equals plan.schema phaseStatus enum', () => {
    const cmp = compareSets(RUST_ENUMS.PhaseStatus, SCHEMA_ENUMS.phaseStatus);
    expect(
      sorted(RUST_ENUMS.PhaseStatus),
      `PhaseStatus (state.rs) drifted from plan.schema phaseStatus.\n` +
        `  only in Rust:   ${JSON.stringify(cmp.onlyInA)}\n` +
        `  only in schema: ${JSON.stringify(cmp.onlyInB)}`
    ).toEqual(sorted(SCHEMA_ENUMS.phaseStatus));
  });

  // EXPECTED RED until Issue #274 phase 3: PhaseProgressStatus is missing the
  // `skipped` variant (state.rs coerces PhaseStatus::Skipped => Completed), so a
  // skipped current-phase renders as completed. This is a REAL failing assertion
  // (not it.skip / not it.fails) documenting the drift; it goes GREEN once phase 3
  // adds `Skipped` to PhaseProgressStatus. The ship gate runs after phase 3.
  it('PhaseProgressStatus variant set deep-equals phaseStatus enum (RED until #274 phase 3 adds Skipped)', () => {
    const cmp = compareSets(RUST_ENUMS.PhaseProgressStatus, SCHEMA_ENUMS.phaseStatus);
    expect(
      sorted(RUST_ENUMS.PhaseProgressStatus),
      `PhaseProgressStatus (state.rs) drifted from phaseStatus.\n` +
        `  only in Rust:   ${JSON.stringify(cmp.onlyInA)}\n` +
        `  only in schema: ${JSON.stringify(cmp.onlyInB)}`
    ).toEqual(sorted(SCHEMA_ENUMS.phaseStatus));
  });

  // SC4: prove the Rust-side comparison actually catches drift. Mutate a COPY of
  // the parsed set — never the real source — and assert the comparator reports
  // inequality.
  describe('SC4 drift-proof — comparator catches a divergent Rust variant', () => {
    it('compareSets reports inequality when a bogus variant is added to a copy', () => {
      const original = RUST_ENUMS.WorkStatus;
      const mutatedCopy = [...original, 'bogus-rust-variant']; // copy, not mutation
      const cmp = compareSets(mutatedCopy, original);

      expect(cmp.equal).toBe(false);
      expect(cmp.onlyInA).toContain('bogus-rust-variant');
      expect(cmp.onlyInB).toEqual([]);
      // Sanity: the real parsed set was not mutated.
      expect(RUST_ENUMS.WorkStatus).not.toContain('bogus-rust-variant');
    });

    it('compareSets reports inequality when a variant is removed from a copy', () => {
      const original = RUST_ENUMS.WorkStatus;
      const mutatedCopy = original.filter((m) => m !== 'executing'); // copy, not mutation
      const cmp = compareSets(mutatedCopy, original);

      expect(cmp.equal).toBe(false);
      expect(cmp.onlyInB).toContain('executing');
      expect(RUST_ENUMS.WorkStatus).toContain('executing');
    });
  });

  // Parser-sanity: guard against a parser that silently matches nothing or that
  // fails to skip serde attributes / doc comments / alias lines.
  describe('parser sanity', () => {
    it('WorkStatus parses to EXACTLY its 8 canonical variants (proves attr/alias/comment skipping)', () => {
      // 8 variants; the `#[serde(alias = "running", ...)]` on Executing must be
      // stripped, leaving the canonical lowercase set only.
      expect(sorted(RUST_ENUMS.WorkStatus)).toEqual(
        sorted([
          'pending',
          'reviewing',
          'planning',
          'executing',
          'paused',
          'completed',
          'failed',
          'shipping',
        ])
      );
      expect(RUST_ENUMS.WorkStatus).not.toContain('running');
      expect(RUST_ENUMS.WorkStatus).not.toContain('in_progress');
    });

    it.each(
      (Object.keys(RUST_ENUMS) as (keyof typeof RUST_ENUMS)[]).map((n) => [n] as const)
    )('%s parsed at least one variant', (name) => {
      expect(RUST_ENUMS[name].length, `Rust enum ${name} parsed empty`).toBeGreaterThan(0);
    });
  });
});
