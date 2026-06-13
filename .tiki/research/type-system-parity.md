---
topic: type-system-parity
tags: [types, schema, parity, rust, testing]
issues: [274]
created: 2026-06-13T02:00:00Z
---

# Type-system single-source via parity tests (not codegen)

REVIEW finding for #274 (Epic #273). Verified against code 2026-06-13.

## Decision: parity tests for BOTH TS and Rust; no codegen

The epic was pre-scoped as "schema-first TS codegen + Rust parity test." Deeper read shows TS codegen is as lossy/risky as Rust codegen, for the same reason — hand-written richness that consumers depend on:
- `CriterionId = ` + "`SC${number}`" + ` template-literal brand (plan.ts:18) — schema pattern ^SC\\d+$ → json-schema-to-typescript emits plain string. Lost.
- `Timestamp` alias (state.ts:35); rich JSDoc; careful optionality.
- Desktop derives view models via Pick/Omit from these exact shapes (#237, WorkCard.tsx) — generated names/shape would break it.

So: KEEP the hand-written TS types (they're good), KEEP the Rust lenient deserializers (#57/#69), and make the JSON schema authoritative by TESTING both representations against it. This delivers the epic's SC1 intent ("schema authoritative; drift fails CI") with no generated output. The user pre-approved this logic for Rust; it applies symmetrically to TS.

## The proven pattern to extend

`packages/shared/src/__tests__/transitions-parity.test.ts` is the exact model: reads a source file, regex-parses a structure, asserts it equals the canonical. The new tests mirror it but treat the **JSON schema** as canonical.

- Schema loader: `import` the schema JSON (state/plan/config) — `packages/shared` can read its own `schemas/*.json` via fs.readFileSync(resolve(repoRoot,'packages/shared/schemas/...')). Enum value sets live at known $defs (state.schema: workStatus, phaseStatus, pipelineStep; plan.schema: phaseStatus, criteriaCategory; config.schema: autoHealCategory).
- TS side: import the union types? Unions aren't introspectable at runtime. Instead assert via a hand-maintained value array per enum that the test ALSO checks is exhaustive against the schema — or parse the .ts source with regex (like transitions-parity parses state.mjs). Prefer source-parse for symmetry + to catch a hand-edit. Parse `export type WorkStatus =\n  | 'x'\n  | 'y'` blocks.
- Rust side: parse `pub enum <Name> {` … `}` variant lists from state.rs (snake/Pascal → lowercase to compare to schema string values; account for `#[serde(rename_all=...)]` and `#[serde(alias=...)]` — aliases are EXTRA accepted inputs, not canonical values, so strip alias lines before comparing the variant set to the schema).

## The ONE real drift (confirmed vs schema)

state.schema.json phaseStatus = [pending, executing, completed, failed, **skipped**] (used for state-phase tracking too). Rust `PhaseProgressStatus` (state.rs:365-371) = {Pending, Executing(+aliases), Completed, Failed} — **missing Skipped**. The custom IssueContext deserializer coerces `PhaseStatus::Skipped => PhaseProgressStatus::Completed` (~state.rs:253-260) — a skipped current-phase renders as completed.

Fix: add `Skipped` to `PhaseProgressStatus`; change the coercion to `Skipped => Skipped`. TS is already correct (single shared `PhaseStatus` with skipped, state.ts:18-23; PhaseProgress.status uses it). plan-side Rust `PhaseStatus` (state.rs:~578) already has Skipped — leave it.

## Guardrails
- `@tiki/shared` public API (index.ts exports) must not change — desktop tsc -b + Pick/Omit consumers must compile untouched.
- Prove the parity test catches drift: a sub-test that mutates a COPY of the parsed set and asserts the comparator would fail (don't mutate real source).
- Rust enum parser must tolerate `#[serde(...)]` attribute lines and doc comments between variants.
- After fix: `transitions-parity.test.ts` unaffected (different enums); cargo `--lib` green; pnpm build clean.
