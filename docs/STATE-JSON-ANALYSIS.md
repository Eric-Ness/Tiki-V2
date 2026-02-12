# State.json Analysis: Root Cause Investigation

**Date:** 2026-02-11
**Issue:** Active Work panel inconsistencies, missing phase indicators, Kanban column misplacements

---

## Executive Summary

The Tiki desktop app experiences inconsistent behavior when displaying work items:
- Items often don't appear in the "Active Work" sidebar section
- Phase progress indicators (e.g., "Phase 2 of 4") sometimes don't display
- Kanban board frequently skips the "Review" column, jumping items directly to other columns
- Overall behavior is unpredictable and inconsistent

After a comprehensive deep-dive into the codebase, **three root causes** have been identified:

1. **No schema enforcement at write time** - Framework commands instruct Claude what to write, but nothing validates the output
2. **Too many format variations** - Rust backend accepts 4+ different JSON structures, silently dropping invalid data
3. **Type definitions duplicated in 4+ places** - Drift between definitions causes mismatches

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Flow Analysis](#data-flow-analysis)
3. [Root Cause 1: No Schema Enforcement](#root-cause-1-no-schema-enforcement)
4. [Root Cause 2: Format Variations](#root-cause-2-format-variations)
5. [Root Cause 3: Type Duplication](#root-cause-3-type-duplication)
6. [Symptom Analysis](#symptom-analysis)
7. [Recommended Solutions](#recommended-solutions)
8. [Implementation Plan](#implementation-plan)
9. [Appendix: File References](#appendix-file-references)

---

## Architecture Overview

### The Tiki Pipeline

```
GET → REVIEW → PLAN → AUDIT → EXECUTE → SHIP
```

Each step should update `.tiki/state.json` with:
- `status`: The work status (`pending`, `reviewing`, `planning`, `executing`, `paused`, `shipping`, `completed`, `failed`)
- `pipelineStep`: The current pipeline step (`GET`, `REVIEW`, `PLAN`, `AUDIT`, `EXECUTE`, `SHIP`)
- `phase`: During execution, tracks current phase progress

### State File Location

All state lives in `.tiki/state.json` at the project root.

### Key Components Involved

| Component | File | Role |
|-----------|------|------|
| JSON Schema | `packages/shared/schemas/state.schema.json` | Canonical schema definition |
| TypeScript Types | `packages/shared/src/types/state.ts` | Shared type definitions |
| Rust Backend | `apps/desktop/src-tauri/src/state.rs` | Deserializes state.json for IPC |
| Zustand Store | `apps/desktop/src/stores/tikiStateStore.ts` | React state management |
| WorkCard Component | `apps/desktop/src/components/work/WorkCard.tsx` | Displays work items |
| StateSection | `apps/desktop/src/components/sidebar/StateSection.tsx` | Active Work sidebar rendering |
| KanbanBoard | `apps/desktop/src/components/kanban/KanbanBoard.tsx` | Kanban view logic |
| Framework Commands | `packages/framework/commands/*.md` | Instructions for Claude |

---

## Data Flow Analysis

### Write Path (Framework → State File)

```
1. User runs /tiki:get 42
2. Claude reads get.md command instructions
3. Claude fetches issue from GitHub
4. Claude writes to .tiki/state.json (hopefully following instructions)
5. No validation occurs
```

**Problem:** Step 4 has no enforcement. Claude might write:
- Wrong field names
- Wrong status values
- Missing required fields
- Different structure than expected

### Read Path (State File → UI)

```
1. Rust watcher detects .tiki/state.json change
2. Emits "tiki-file-changed" Tauri event
3. React App.tsx calls get_state() IPC command
4. Rust state.rs deserializes JSON with lenient parsing
5. Invalid/unexpected data silently becomes None/default
6. Zustand store updated with potentially incomplete data
7. React components render (possibly with missing data)
```

**Problem:** Steps 4-5 silently drop data that doesn't match expected formats.

---

## Root Cause 1: No Schema Enforcement

### The Problem

Framework commands are markdown files with instructions for Claude. They specify what JSON to write, but there's no validation that Claude actually follows the instructions.

### Example: GET Command

From `packages/framework/commands/get.md` (lines 33-59):

```json
{
  "schemaVersion": 1,
  "activeWork": {
    "issue:{number}": {
      "type": "issue",
      "issue": {
        "number": {number},
        "title": "{title}",
        "body": "{body}",
        "state": "{state}",
        "url": "{url}",
        "labels": ["{label1}", "{label2}"],
        "labelDetails": [
          {"id": "{id}", "name": "{name}", "color": "{hex}", "description": "{desc}"}
        ],
        "createdAt": "{GitHub created timestamp}",
        "updatedAt": "{GitHub updated timestamp}"
      },
      "status": "pending",
      "pipelineStep": "GET",
      "createdAt": "{ISO timestamp}",
      "lastActivity": "{ISO timestamp}"
    }
  }
}
```

### What Could Go Wrong

Claude might write:

```json
// Wrong: flat issueNumber instead of nested issue object
{
  "activeWork": {
    "issue:42": {
      "type": "issue",
      "issueNumber": 42,
      "title": "Some title",
      "status": "pending"
    }
  }
}
```

Or:

```json
// Wrong: missing required fields
{
  "activeWork": {
    "issue:42": {
      "type": "issue",
      "status": "pending"
    }
  }
}
```

Or:

```json
// Wrong: invalid status value
{
  "activeWork": {
    "issue:42": {
      "type": "issue",
      "issue": { "number": 42 },
      "status": "in-progress"  // Should be "executing"
    }
  }
}
```

### Impact

- Active Work panel can't display items with missing/malformed data
- Phase indicators don't show when phase object is missing
- Kanban columns receive unexpected status values

---

## Root Cause 2: Format Variations

### The Problem

The Rust backend (`state.rs`) has extensive backward-compatibility code to handle multiple JSON formats. This was added to handle "old" vs "new" formats, but it masks errors instead of surfacing them.

### Format Variations Supported

#### Issue Reference Formats

| Format | Structure | Source |
|--------|-----------|--------|
| New (canonical) | `{ "issue": { "number": 42, "title": "..." } }` | state.schema.json |
| Old flat | `{ "issueNumber": 42, "title": "..." }` | Legacy |

#### Timestamp Formats

| Format | Field Name | Source |
|--------|------------|--------|
| New | `createdAt` | state.schema.json |
| Old | `startedAt` | Legacy |

#### Phase Progress Formats

| Format | Structure | Source |
|--------|-----------|--------|
| New (canonical) | `{ "phase": { "current": 2, "total": 4, "status": "executing" } }` | state.schema.json |
| Old object | `{ "phases": { "total": 4, "completed": 1, "current": { "number": 2, "status": "..." } } }` | Legacy |
| Array format | `{ "phases": [{ "id": 1, "title": "...", "status": "completed" }, ...] }` | Issue #66 |
| Flat fields | `{ "currentPhase": 2, "totalPhases": 4 }` | Issue #66 |

### Rust Deserialization Code

From `apps/desktop/src-tauri/src/state.rs` (lines 60-110):

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIssueContext {
    // New format: nested issue object
    #[serde(default)]
    issue: Option<IssueRef>,
    // Old format: flat issue number
    #[serde(default, alias = "issueNumber")]
    issue_number: Option<u32>,
    // Old format: title at root level
    #[serde(default)]
    title: Option<String>,

    status: WorkStatus,

    #[serde(default)]
    pipeline_step: Option<PipelineStep>,

    // New format: flat phase progress (lenient: skip if unparseable)
    #[serde(default, deserialize_with = "deserialize_lenient_phase")]
    phase: Option<PhaseProgress>,
    // Old/array format: phases as object or array (lenient: skip if unparseable)
    #[serde(default, deserialize_with = "deserialize_lenient_phases")]
    phases: Option<RawPhasesVariant>,

    // Flat phase fields (issue #66 style: currentPhase/totalPhases at top level)
    #[serde(default)]
    current_phase: Option<u32>,
    #[serde(default)]
    total_phases: Option<u32>,

    // New format timestamp
    #[serde(default)]
    created_at: Option<String>,
    // Old format timestamp
    #[serde(default)]
    started_at: Option<String>,

    #[serde(default)]
    last_activity: Option<String>,
    #[serde(default)]
    audit_passed: Option<bool>,
    #[serde(default)]
    yolo: Option<bool>,
    #[serde(default)]
    commit: Option<String>,
    #[serde(default)]
    parent_release: Option<String>,
    #[serde(default)]
    pipeline_history: Option<Vec<PipelineStepRecord>>,
}
```

### Lenient Deserialization Functions

From `state.rs` (lines 112-141):

```rust
/// Leniently deserialize phase progress — returns None if unparseable instead of erroring
fn deserialize_lenient_phase<'de, D>(deserializer: D) -> Result<Option<PhaseProgress>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|v| serde_json::from_value(v).ok()))  // Silently drops errors!
}

/// Leniently deserialize phases — handles both old object format and array format
fn deserialize_lenient_phases<'de, D>(deserializer: D) -> Result<Option<RawPhasesVariant>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(v) => {
            if let Ok(old) = serde_json::from_value::<RawOldPhases>(v.clone()) {
                return Ok(Some(RawPhasesVariant::OldObject(old)));
            }
            if let Ok(arr) = serde_json::from_value::<Vec<RawPhaseArrayItem>>(v) {
                return Ok(Some(RawPhasesVariant::Array(arr)));
            }
            Ok(None)  // Silently drops errors!
        }
    }
}
```

**Critical Issue:** The `.ok()` call converts parsing errors to `None`, silently dropping invalid data.

### Impact

- Malformed JSON is accepted without errors
- Missing or invalid phase data silently becomes `None`
- UI shows incomplete information with no indication of why

---

## Root Cause 3: Type Duplication

### The Problem

The same types are defined in 4+ different places, with no mechanism to keep them in sync.

### Type Definition Locations

#### 1. JSON Schema (Canonical)

**File:** `packages/shared/schemas/state.schema.json`

```json
{
  "$defs": {
    "workStatus": {
      "type": "string",
      "enum": ["pending", "reviewing", "planning", "executing", "paused", "shipping", "completed", "failed"]
    },
    "phaseStatus": {
      "type": "string",
      "enum": ["pending", "executing", "completed", "failed", "skipped"]
    },
    "issueWork": {
      "type": "object",
      "required": ["type", "issue", "status", "createdAt", "lastActivity"],
      "properties": {
        "type": { "const": "issue" },
        "issue": { /* nested object */ },
        "status": { "$ref": "#/$defs/workStatus" },
        "pipelineStep": { "$ref": "#/$defs/pipelineStep" },
        "phase": { /* object with current, total, status */ }
      }
    }
  }
}
```

#### 2. TypeScript Shared Types

**File:** `packages/shared/src/types/state.ts`

```typescript
export type WorkStatus =
  | 'pending' | 'reviewing' | 'planning' | 'executing'
  | 'paused' | 'shipping' | 'completed' | 'failed';

export type PhaseStatus =
  | 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';

export interface IssueWork {
  type: 'issue';
  issue: IssueInfo;
  status: WorkStatus;
  pipelineStep?: PipelineStep;
  pipelineHistory?: PipelineStepRecord[];
  phase?: PhaseProgress;
  createdAt: Timestamp;
  lastActivity: Timestamp;
  error?: WorkError;
  parentRelease?: string;
}
```

#### 3. Rust Backend Types

**File:** `apps/desktop/src-tauri/src/state.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WorkStatus {
    Pending,
    Reviewing,
    Planning,
    #[serde(alias = "running", alias = "in_progress", alias = "in-progress")]
    Executing,
    Paused,
    Completed,
    Failed,
    Shipping,
}
```

**Note:** Rust has extra aliases (`running`, `in_progress`, `in-progress`) that aren't in the schema.

#### 4. React Component Types

**File:** `apps/desktop/src/components/work/WorkCard.tsx`

```typescript
export type WorkStatus = "pending" | "reviewing" | "planning" | "executing" | "paused" | "completed" | "failed" | "shipping";
export type PhaseStatus = "pending" | "running" | "executing" | "completed" | "failed";

export interface IssueContext {
  type: "issue";
  issue: {
    number: number;
    title?: string;
    url?: string;
  };
  status: WorkStatus;
  pipelineStep?: PipelineStep;
  pipelineHistory?: PipelineStepRecord[];
  phase?: PhaseInfo;
  createdAt: string;
  lastActivity?: string;
  auditPassed?: boolean;
  parentRelease?: string;
}
```

**Note:** PhaseStatus includes `"running"` which isn't in the canonical schema. Also missing `"skipped"` which IS in the schema.

#### 5. Zustand Store Types

**File:** `apps/desktop/src/stores/tikiStateStore.ts`

```typescript
import type { WorkContext } from '../components/work';

export interface CompletedIssue {
  number: number;
  title?: string;
  completedAt: string;
}
```

### Drift Examples

| Field | Schema | Rust | React |
|-------|--------|------|-------|
| Phase progress status | `pending, executing, completed, failed, skipped` | `PhaseProgressStatus`: `pending, executing, completed, failed` — **missing `skipped`**, has aliases (`running`, `in_progress`) | `PhaseStatus`: `pending, running, executing, completed, failed` — **missing `skipped`**, has extra `running` |
| Plan phase status | `pending, executing, completed, failed, skipped` | `PhaseStatus`: all 5 values + aliases (`running`, `in_progress`, `in-progress`) | N/A (not used in UI) |
| WorkStatus aliases | None | `running`, `in_progress`, `in-progress` on Executing | None |

**Note:** Rust has TWO separate phase status enums: `PhaseProgressStatus` (for state.json phase tracking, 4 variants) and `PhaseStatus` (for plan file phase definitions, 5 variants). This split itself is a source of confusion.

### Impact

- Code that writes one format may not be readable by code expecting another
- TypeScript compiles successfully but runtime behavior is wrong
- Difficult to track down which definition is "correct"

---

## Symptom Analysis

### Symptom 1: Items Don't Show in Active Work

**UI Code:** `apps/desktop/src/components/sidebar/StateSection.tsx`

```typescript
interface StateSectionProps {
  activeWork: Record<string, WorkContext>;
}

export function StateSection({ activeWork }: StateSectionProps) {
  const workEntries = Object.entries(activeWork);
  // Renders WorkProgressCard for each entry
```

**Root Causes:**
1. Framework didn't write to state.json at all
2. Framework wrote wrong key format (not `issue:N`)
3. Rust deserialization silently dropped the entry
4. Type discriminator (`type: "issue"`) missing

**Debug Path:**
1. Check raw `.tiki/state.json` content
2. Check Rust `get_state()` return value
3. Check Zustand store `activeWork` value

### Symptom 2: Phase Indicator Doesn't Show

**UI Code:** `apps/desktop/src/components/work/WorkCard.tsx` (lines 73-85):

```tsx
{isIssue && work.phase && work.phase.total > 0 && (
  <div className="progress">
    <div className="progress-bar">
      <div
        className="progress-fill"
        style={{ width: `${(work.phase.current / work.phase.total) * 100}%` }}
      />
    </div>
    <span className="progress-text">
      Phase {work.phase.current} of {work.phase.total}
    </span>
  </div>
)}
```

**Conditions for Display:**
1. `work.type === "issue"` (isIssue is true)
2. `work.phase` exists (not null/undefined)
3. `work.phase.total > 0`

**Root Causes:**
1. Framework didn't write `phase` object
2. Framework wrote wrong phase format (e.g., `phases` array instead of `phase` object)
3. Rust lenient deserialization returned `None` for malformed phase
4. `phase.total` is 0 or missing

**Debug Path:**
1. Check `.tiki/state.json` for `phase` field
2. Check if `phase` has `current`, `total`, `status` fields
3. Check Rust deserialization logs

### Symptom 3: Kanban Skips Review Column

**UI Code:** `apps/desktop/src/components/kanban/KanbanBoard.tsx` (lines 163-181):

```typescript
const statusToColumn = (status: string): string => {
  switch (status) {
    case 'pending':
    case 'reviewing':
    case 'paused':
    case 'failed':
      return 'review';
    case 'planning':
      return 'plan';
    case 'executing':
      return 'execute';
    case 'shipping':
      return 'shipping';
    case 'completed':
      return 'completed';
    default:
      return 'review';
  }
};
```

**Column Configuration:**

```typescript
const COLUMN_CONFIG = [
  { id: 'open', title: 'Open', statuses: [] },
  { id: 'review', title: 'Review', statuses: ['pending', 'reviewing'] },
  { id: 'plan', title: 'Plan', statuses: ['planning'] },
  { id: 'execute', title: 'Execute', statuses: ['executing'] },
  { id: 'shipping', title: 'Shipping', statuses: ['shipping'] },
  { id: 'completed', title: 'Completed', statuses: ['completed'] },
];
```

**Root Causes:**
1. Framework set status directly to `"executing"` without going through `"pending"` → `"reviewing"` → `"planning"`
2. `/tiki:yolo` command jumps through pipeline steps quickly
3. Status value is something unexpected (e.g., `"running"` instead of `"executing"`)

**Debug Path:**
1. Check state.json `status` value
2. Check if status matches expected enum values exactly
3. Add console logging to `statusToColumn()` to see what values are passed

---

## Recommended Solutions

### Solution 1: Schema Validation in Framework Commands

Add validation step after every state.json write.

**Approach:**
1. Use `ajv` (already in shared package) to validate state.json
2. Add validation instructions to each framework command
3. If validation fails, show error and rollback

**Example Addition to get.md:**

```markdown
<validation>
After writing state.json, validate it:

1. Read the file back
2. Parse as JSON
3. Validate against state.schema.json
4. If invalid, show the validation errors and fix them

Use this validation approach:
- Load schema from `.tiki/` or use embedded schema
- Validate full state structure
- Ensure required fields are present
- Ensure enum values are valid
</validation>
```

**Pros:**
- Catches errors immediately at write time
- Provides clear error messages
- Works within existing framework

**Cons:**
- Relies on Claude following validation instructions
- Adds overhead to each command

### Solution 2: Strict Rust Deserialization

Remove lenient parsing; fail fast on invalid data.

**Current (Lenient):**

```rust
fn deserialize_lenient_phase<'de, D>(deserializer: D) -> Result<Option<PhaseProgress>, D::Error>
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|v| serde_json::from_value(v).ok()))  // Drops errors
}
```

**Proposed (Strict):**

```rust
fn deserialize_phase<'de, D>(deserializer: D) -> Result<Option<PhaseProgress>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<PhaseProgress>::deserialize(deserializer)  // Propagates errors
}
```

**Additional Changes:**
1. Remove all `#[serde(alias = "...")]` attributes
2. Remove `RawIssueContext` and format normalization
3. Use single canonical structure
4. Add detailed error logging when deserialization fails

**Pros:**
- Invalid data surfaces immediately
- Easier to debug
- Forces framework to write correct format

**Cons:**
- Breaks backward compatibility with old state files
- Requires migration path for existing users

### Solution 3: Unified Type Definitions

Generate TypeScript types from JSON Schema; remove duplicates.

**Approach:**
1. Use `json-schema-to-typescript` to generate types from `state.schema.json`
2. Export generated types from `@tiki/shared`
3. Have all consumers (WorkCard, KanbanBoard, stores) import from `@tiki/shared`
4. Remove local type definitions

**Example Script:**

```bash
npx json-schema-to-typescript \
  packages/shared/schemas/state.schema.json \
  -o packages/shared/src/types/state.generated.ts
```

**File Changes:**

```typescript
// packages/shared/src/types/index.ts
export * from './state.generated';

// apps/desktop/src/components/work/WorkCard.tsx
import type { IssueWork, WorkStatus, PhaseProgress } from '@tiki/shared';
// Remove local type definitions

// apps/desktop/src/stores/tikiStateStore.ts
import type { TikiState, WorkContext } from '@tiki/shared';
```

**Pros:**
- Single source of truth
- Automatic sync between schema and TypeScript
- Type errors caught at compile time

**Cons:**
- Generated types may need manual adjustment
- Build step dependency

### Solution 4: Rust Types from JSON Schema

Generate Rust types from the same JSON Schema.

**Tools:**
- `typify` (https://github.com/oxidecomputer/typify)
- `schemafy` (https://github.com/phodina/schemafy)

**Pros:**
- All three layers (Schema, TypeScript, Rust) stay in sync
- No manual type maintenance

**Cons:**
- More complex build setup
- Generated Rust code may need adjustment

---

## Implementation Plan

### Phase 1: Immediate Fixes (Low Risk)

1. **Add debug logging to Rust deserialization**
   - Log when lenient parsing drops data
   - Log raw JSON before parsing
   - Help diagnose current issues

2. **Add validation command**
   - New `/tiki:validate` command
   - Validates current state.json against schema
   - Reports errors with fix suggestions

3. **Fix obvious type mismatches**
   - Remove `"running"` from React PhaseStatus
   - Ensure all enums match schema exactly

### Phase 2: Schema Enforcement (Medium Risk)

1. **Add validation to framework commands**
   - Modify get.md, review.md, plan.md, execute.md, ship.md
   - Add validation step after each state write
   - Include rollback instructions on failure

2. **Create state migration utility**
   - Script to upgrade old format state.json to new format
   - Run once to clean up existing installations

### Phase 3: Type Unification (Medium Risk)

1. **Generate TypeScript from schema**
   - Add `json-schema-to-typescript` to build
   - Replace manual types in `@tiki/shared`
   - Update all imports

2. **Remove duplicate types from React components**
   - WorkCard.tsx uses `@tiki/shared` types
   - KanbanBoard.tsx uses `@tiki/shared` types
   - tikiStateStore.ts uses `@tiki/shared` types

### Phase 4: Strict Deserialization (Higher Risk)

1. **Remove backward compatibility from Rust**
   - Single canonical format only
   - Clear error messages for invalid data
   - Requires user migration

2. **Optional: Generate Rust from schema**
   - Evaluate `typify` or similar
   - If viable, add to build process

---

## Appendix: File References

### Schema & Types

| File | Purpose | Lines of Interest |
|------|---------|-------------------|
| `packages/shared/schemas/state.schema.json` | Canonical JSON Schema | Full file |
| `packages/shared/src/types/state.ts` | TypeScript types | Full file |
| `apps/desktop/src-tauri/src/state.rs` | Rust types & deserialization | 1-585 |

### UI Components

| File | Purpose | Lines of Interest |
|------|---------|-------------------|
| `apps/desktop/src/components/work/WorkCard.tsx` | Work item display & types | 1-46 (types), 73-85 (phase) |
| `apps/desktop/src/components/sidebar/StateSection.tsx` | Active Work sidebar rendering | Full file |
| `apps/desktop/src/components/kanban/KanbanBoard.tsx` | Kanban logic | 32-39 (columns), 163-181 (statusToColumn) |
| `apps/desktop/src/stores/tikiStateStore.ts` | Zustand store | Full file |

### Framework Commands

| File | Purpose | State Update Section |
|------|---------|---------------------|
| `packages/framework/commands/get.md` | GET command | Lines 33-59 |
| `packages/framework/commands/review.md` | REVIEW command | Lines 113-131 |
| `packages/framework/commands/plan.md` | PLAN command | Check state-management section |
| `packages/framework/commands/execute.md` | EXECUTE command | Lines 27-76 (critical phase updates) |
| `packages/framework/commands/ship.md` | SHIP command | Check state-management section |

### Documentation

| File | Purpose |
|------|---------|
| `docs/FRAMEWORK-DEEP-DIVE.md` | Complete framework reference |
| `docs/DESIGN.md` | Architecture design document |

---

## Conclusion

The state.json inconsistencies stem from a fundamental architecture issue: **the system has no enforcement mechanism between the schema definition and actual runtime behavior**.

The recommended approach is:

1. **Short term:** Add validation and logging to surface issues
2. **Medium term:** Enforce schema at write time in framework commands
3. **Long term:** Generate all types from a single schema source

This will require coordinated changes across the framework commands, TypeScript types, and Rust backend, but will result in a much more reliable system.
