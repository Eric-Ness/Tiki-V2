---
topic: state-machine-transition-validation
tags: [state-machine, shared, typescript, rust, framework]
issues: [103]
created: 2026-05-11T18:50:00.000Z
---

# Issue #103 Review: State Machine Transition Validation

## 1. Success Criteria

**SC1 — Canonical table in `@tiki/shared`.** A single exported constant (e.g. `VALID_TRANSITIONS: Record<WorkStatus, ReadonlySet<WorkStatus>>`) is the sole authoritative source. Rust and JS shim tables are updated to match it.

**SC2 — `canTransition(from, to): boolean` exported.** Returns `true` for same-status (idempotent) and all table-listed forward pairs.

**SC3 — `assertTransition(from, to): void` exported.** Throws a descriptive `Error` on illegal pairs; error message includes both statuses.

**SC4 — Rust `is_legal_transition` matches canonical table.** All passing tests continue to pass; `test_failed_recovery` updated to reflect removed `failed → shipping`; new test for `executing → completed`.

**SC5 — JS shim `LEGAL` constant matches canonical table.** `packages/framework/scripts/state.mjs` lines 58-67 updated; comment updated to reference `@tiki/shared`.

**SC6 — `review.md` routes through the shim.** Both copies of `review.md` replace the direct-JSON `<state-management>` block with a `state.mjs` shim call, closing the only known enforcement gap.

**SC7 — JSON Schema enum not out of sync.** `packages/shared/schemas/state.schema.json` `$defs.workStatus.enum` still matches `WorkStatus` exactly; no duplicate lists exist.

**SC8 — Tests in `@tiki/shared`.** New test file exercises `canTransition` and `assertTransition` across all 8 `from` statuses, all legal targets, and representative illegal targets.

---

## 2. Current State Survey

### 2a. JS Shim — `packages/framework/scripts/state.mjs`

The transition table is `LEGAL` at lines 58–67 and the validation function is `isLegalTransition` at lines 82–86.

```
LEGAL = {
  pending:   { reviewing, planning, executing, paused, failed }
  reviewing: { planning, executing, paused, failed }
  planning:  { executing, paused, failed }
  executing: { shipping, paused, failed }
  shipping:  { completed, failed }
  paused:    { pending, reviewing, planning, executing, shipping }
  failed:    { pending, reviewing, planning, executing, shipping }
  completed: {}  // terminal
}
```

Same-status transitions are always legal (line 83: `if (from === to) return true`). The file has no import from or reference to `@tiki/shared`.

### 2b. Rust — `apps/desktop/src-tauri/src/state_transition.rs`

`is_legal_transition` at lines 87–131. The match arms at lines 97–130 encode the identical table to the JS shim.

Same-status handled at lines 93–95.

**Existing inline tests** (lines 362–584):
- `test_legal_transitions` (line 363): 6 pairs, mostly forward-path happy path.
- `test_illegal_transitions` (line 383): `Completed → *` (3 cases), `Shipping → Pending`, `Shipping → Reviewing`.
- `test_paused_recovery` (line 406): `Paused → Executing/Planning/Shipping`.
- `test_failed_recovery` (line 414): explicitly asserts `Failed → Shipping` is **legal** (line 419).
- 4 `apply_transition` behavioral tests (lines 422–584).

### 2c. `@tiki/shared` — `packages/shared/src/types/state.ts`

`WorkStatus` is a TypeScript union type at lines 7–15. No transition table, no `canTransition`, no `assertTransition` exists anywhere in the `packages/shared/` tree. Zero test files under the package.

### 2d. JSON Schema — `packages/shared/schemas/state.schema.json`

`$defs.workStatus` at line 57 defines the enum `["pending","reviewing","planning","executing","paused","shipping","completed","failed"]`. No transition-sequence validation is present or expressible in JSON Schema. The enum is a manual duplicate of the `WorkStatus` TS type; no build-time check enforces their agreement.

### 2e. Validation Infrastructure — `packages/shared/src/validation/index.ts`

Ajv validators for `TikiState` and `TikiPlan` are implemented but dormant — `compileStateValidator` must be called by the consumer before `validateState` works. No production caller in the monorepo does this. The JS shim performs its own status-enum check (lines 69–78, 283–288) independently of Ajv.

### 2f. Framework Commands — State Mutation Survey

| Command (both `packages/framework/commands/` and `.claude/commands/tiki/`) | Status mutation mechanism | Gap? |
|---|---|---|
| `get.md` | `state.mjs` shim | No |
| `review.md` | **Direct JSON write** only — no shim call shown in `<state-management>` (lines 139–157 in both copies) | **YES** |
| `plan.md` | `state.mjs` shim (early-state-update + post-plan blocks) | No |
| `audit.md` | `state.mjs` shim | No |
| `execute.md` | `state.mjs` shim for status transitions; direct JSON for `parallelExecution` (noted as shim limitation, not a status-transition bypass) | No for status |
| `ship.md` | `state.mjs` shim for `shipping` and `completed`; direct JSON for history append and entry deletion (deletion not a status transition) | No for status |
| `yolo.md` | Delegates to above commands | No |

`review.md` is the only command where a status transition (`pending → reviewing`) can be written without going through the shim and without any validation.

---

## 3. Reconciliation Decision Needed

The JS shim and Rust implementation are identical in every row. All discrepancies are between the current pair of implementations {JS, Rust} and the issue body spec (C).

| `from → to` | JS shim | Rust | Issue spec | Notes |
|---|---|---|---|---|
| `pending → paused` | ALLOWED | ALLOWED | NOT listed | Minor: pausing before any work starts is unusual but not harmful |
| `reviewing → executing` | ALLOWED | ALLOWED | NOT listed | Skip-planning fast-path; used in practice |
| `executing → completed` | NOT allowed | NOT allowed | **ALLOWED** | Issue spec adds this; current impls lack it |
| `paused → pending` | ALLOWED | ALLOWED | NOT listed | Valid "restart from scratch" path |
| `paused → shipping` | ALLOWED | ALLOWED | NOT listed | Needed by `ship.md` abort-then-resume flow |
| `failed → executing` | ALLOWED | ALLOWED | NOT listed | Retry path; used by auto-heal in `execute.md` |
| **`failed → shipping`** | **ALLOWED** | **ALLOWED** | **EXPLICITLY DISALLOWED** | Issue body calls this out by name as an example of a bad transition |

### Recommendation: adopt the current implementations as base with two changes

1. **Remove `failed → shipping`.** The issue body explicitly names this as the motivating bad example. The `test_failed_recovery` assertion at line 419 of `state_transition.rs` must be updated. No existing framework command workflow uses this path.

2. **Add `executing → completed`.** The issue spec includes it; it does not break any existing tests. It is an additive convenience. Document it as a short-circuit that bypasses the SHIP pipeline step (no GitHub close, no history append) — framework commands should not use it without also running the SHIP cleanup.

All other discrepancies (6 rows) should retain the current permissive behavior — these paths are actively used by framework commands and recovery flows.

---

## 4. Touch List

### `@tiki/shared` — new functionality
- `packages/shared/src/types/transitions.ts` (new) — `VALID_TRANSITIONS`, `canTransition`, `assertTransition`
- `packages/shared/src/types/index.ts` — re-export the new module
- `packages/shared/src/__tests__/transitions.test.ts` — new test file
- `packages/shared/package.json` — add vitest devDependency if not present; add `"test"` script

### Rust shim
- `apps/desktop/src-tauri/src/state_transition.rs` — remove `(Failed, Shipping)` arm; add `(Executing, Completed)` arm; update line 86 comment to reference `@tiki/shared`; update `test_failed_recovery` test; add test for `Executing → Completed`

### JS shim
- `packages/framework/scripts/state.mjs` — remove `"shipping"` from `LEGAL.failed`; add `"completed"` to `LEGAL.executing`; update comment to reference `@tiki/shared`

### Framework commands (enforcement gap)
- `packages/framework/commands/review.md` — replace direct-JSON `<state-management>` block with `state.mjs` shim call
- `.claude/commands/tiki/review.md` — same change

### JSON Schema
- `packages/shared/schemas/state.schema.json` — no functional changes; optionally add `$comment` at `$defs.workStatus` pointing to `@tiki/shared` as canonical transition authority

---

## 5. Risk Register

**R1 — Existing `state.json` files with `failed → shipping` histories.** The transition table gates new transitions only, not reads. Existing files won't fail on deserialization. Risk is if a command re-drives that transition post-fix.

**R2 — `test_failed_recovery` at line 419 of `state_transition.rs` will fail immediately.** Must be updated in the same commit as the table change or `cargo test` fails.

**R3 — `@tiki/shared` has no test infrastructure.** No test runner is configured. Setting one up (vitest, matching apps/desktop) is a prerequisite phase.

**R4 — `executing → completed` shortcut is undocumented and unpoliced.** Adding this transition is safe for the state machine but bypasses the SHIP pipeline step.

**R5 — JSON Schema `workStatus` enum is a manual duplicate** of the TypeScript union type with no build-time sync check. Out of scope for #103 but should be tracked.

**R6 — `parallelExecution` direct-write bypass in `execute.md`.** The shim does not expose `parallelExecution` setting. Out of scope for #103 but a known bypass for non-transition writes.

---

## 6. Open Questions for PLAN

**OQ1 — Confirm canonical table choice:** keep current permissive set, remove `failed → shipping`, add `executing → completed`. (Issue spec stricter — would also remove several recovery paths.)

**OQ2 — File placement:** new `packages/shared/src/types/transitions.ts` recommended (separation of concerns).

**OQ3 — Test runner:** vitest, matching the rest of the monorepo (root has vitest configured for apps/desktop already).

**OQ4 — `assertTransition` semantics:** throw (per spec). Add Result-style overload later only if React frontend imports it.

**OQ5 — Phase coupling:** TS helpers + Rust + JS shim updates should be coupled in adjacent phases so the canonical table is never out of sync.

**OQ6 — Both copies of `review.md`** must be updated in the same phase (`.claude/` copies are active runtime; `packages/framework/commands/` are distribution source).
