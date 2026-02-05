# Tiki v2 Framework - Deep Dive

A comprehensive reference for the Tiki workflow framework architecture, pipeline, state system, type system, and desktop integration.

## Core Concept

Tiki is a **GitHub-issue-centric workflow framework for Claude Code**. It orchestrates software development through a structured 6-step pipeline, breaking large work into phases that execute in fresh agent contexts to avoid context exhaustion.

## The Pipeline

```
GET → REVIEW → PLAN → AUDIT → EXECUTE → SHIP
```

| Step | Purpose | Key Output |
|------|---------|------------|
| **GET** | Fetch GitHub issue, initialize state | `state.json` entry with cached metadata |
| **REVIEW** | Analyze requirements, derive success criteria (SC1, SC2...) | Complexity rating, technical scope |
| **PLAN** | Break into sequential phases, build coverage matrix | `.tiki/plans/issue-N.json` |
| **AUDIT** | Validate plan (17-point checklist: completeness, feasibility, quality, risk) | PASS / WARN / FAIL gate |
| **EXECUTE** | Run phases via sub-agents, each with fresh context + prior summaries | Phase completions, state updates |
| **SHIP** | Commit, push, close issue on GitHub, archive plan | Conventional commit, closed issue |

Two automation commands layer on top:

- **YOLO** - Runs the full pipeline for a single issue automatically (pauses on failures)
- **RELEASE** - Orchestrates multiple issues with dependency resolution (topological sort), running YOLO per issue, then tags and ships

---

## Pipeline Step Details

### 1. GET

- **Entry point** for all issue-based work
- Fetches issue via `gh issue view` with full metadata (title, body, state, labels, timestamps)
- Creates/updates `.tiki/state.json` with work entry keyed as `issue:{number}`
- Sets status to `pending`, pipeline step to `GET`
- Caches GitHub data for offline access
- Presents next-action options: Review, Plan, Research, or Get another issue

### 2. REVIEW

- Analyzes issue requirements, complexity, and technical scope
- Extracts **success criteria** (SC1, SC2, SC3...) framed as "what needs to be true for this to be done?"
- Criteria categories: Functional, Testing, Performance, Security, Documentation
- **Complexity rubric**:
  - Low: Single file, clear requirements, 1-2 phases
  - Medium: Multiple files in one system, 3-5 phases
  - High: Cross-cutting changes, significant unknowns, 5+ phases
- Explores codebase with Glob/Grep to identify related files and patterns
- Updates status to `planning`, pipeline step to `REVIEW`

### 3. PLAN

- Breaks issue into sequential, executable phases
- Each phase must be completable with fresh context (1-3 files max)
- **Phase structure**: number, title, content (instructions), verification criteria, files list, dependencies, `addressesCriteria` mapping
- **Coverage matrix** maps every success criterion to phases that address it
- Ordering: Foundation → Core logic → Integration → Polish
- Each phase leaves the codebase in a working state
- Writes plan to `.tiki/plans/issue-{number}.json`
- Updates phase tracking: `phase.current`, `phase.total`, `phase.status`

### 4. AUDIT

- **Quality gate** before execution with 17-point checklist:
  - **Completeness**: All criteria covered, verification defined, files specified, dependencies valid
  - **Feasibility**: Files exist, no conflicts, valid DAG (no cycles)
  - **Quality**: Reasonable phase count, descriptive titles, testable verification
  - **Risks**: High-risk files verified, changes isolated, rollback path clear
- Outcomes:
  - **PASS** → Ready for execution
  - **WARN** → Allow with acknowledgment
  - **FAIL** → Block execution until fixed

### 5. EXECUTE

- Runs phases sequentially using **sub-agents** (Task tool with fresh context)
- Each phase receives: phase definition + summaries from all prior phases
- **Must update state.json BEFORE each phase** (desktop app depends on this)
- Per-phase flow: Read instructions → Check dependencies → Execute → Run verification → Run tests/typecheck/lint → Generate summary
- Phase summary captures: created files, modified files, key changes, verification results, notes for next phase
- Updates plan file with phase status, completedAt, and summary

### 6. SHIP

- **Pre-ship verification** (10-point checklist): all phases complete, criteria met, tests pass, build succeeds, lint passes, no TypeScript errors
- Creates conventional commit: `{type}: {description} (#{issue})`
- Types: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Pushes to remote
- Closes GitHub issue with summary comment
- Moves work to `history` in state.json, archives plan file

### 7. YOLO (Full Automation)

- Executes complete pipeline in one command: GET → REVIEW → PLAN → AUDIT → EXECUTE → SHIP
- **Pause conditions**: Audit fails, phase fails, tests fail, push fails, ambiguous requirements
- Sub-agent strategy: GET/AUDIT in main context, REVIEW/PLAN/EXECUTE phases/SHIP as sub-agents
- Adds `yolo: true` flag to state
- Displays pipeline progress table with step statuses

### 8. RELEASE (Multi-Issue Orchestration)

- Loads release definition from `.tiki/releases/{version}.json`
- **Dependency detection**: Scans issue bodies for `depends on #N`, `blocked by #N`, `requires #N`, `after #N`
- **Topological sort** (Kahn's algorithm) for execution order
- Runs `/tiki:yolo` for each issue sequentially
- Ships: creates git tag, pushes, closes GitHub milestone, archives release file
- Supports: `--dry-run` (preview), `--continue` (resume), `--no-tag` (skip tagging)

---

## State Architecture

All state lives in `.tiki/` at the project root:

```
.tiki/
├── state.json                    # Central state hub
├── plans/
│   ├── issue-N.json              # Phase definitions per issue
│   └── archive/                  # Completed plans
├── releases/
│   ├── vX.Y.Z.json              # Release issue groupings
│   └── archive/                  # Shipped releases
├── research/*.md                 # Domain knowledge
├── commands/*.md                 # Custom commands (hybrid Markdown+XML format)
└── hooks/*.sh                    # Lifecycle scripts (pre-execute, post-ship, etc.)
```

### state.json Structure

Keyed by work ID (`issue:42`, `release:v1.2`), not terminal ID. This enables multiple concurrent work streams without interference.

```json
{
  "schemaVersion": 1,
  "activeWork": {
    "issue:49": {
      "type": "issue",
      "issue": {
        "number": 49,
        "title": "Phase Current/Total",
        "body": "...",
        "state": "OPEN",
        "url": "https://github.com/...",
        "labels": ["bug", "enhancement"],
        "labelDetails": [{ "id": "...", "name": "bug", "color": "d73a4a", "description": "..." }],
        "createdAt": "2026-02-04T03:30:00.000Z",
        "updatedAt": "2026-02-04T04:00:00.000Z"
      },
      "status": "executing",
      "pipelineStep": "EXECUTE",
      "phase": { "current": 3, "total": 4, "status": "executing" },
      "createdAt": "2026-02-04T03:30:00.000Z",
      "lastActivity": "2026-02-04T04:00:00.000Z"
    },
    "release:v0.2.0": {
      "type": "release",
      "release": {
        "version": "v0.2.0",
        "issues": [32, 33, 34, 35],
        "currentIssue": 33,
        "completedIssues": [32],
        "milestone": "v0.2.0"
      },
      "status": "executing",
      "pipelineStep": "EXECUTE",
      "createdAt": "2026-02-03T23:55:00.000Z",
      "lastActivity": "2026-02-04T00:10:00.000Z"
    }
  },
  "history": {
    "lastCompletedIssue": { "number": 41, "title": "...", "completedAt": "..." },
    "recentIssues": [{ "number": 41, "title": "...", "completedAt": "..." }],
    "recentReleases": [{ "version": "v0.1.2", "issues": [30, 31], "completedAt": "..." }]
  }
}
```

### Plan File Structure

Location: `.tiki/plans/issue-{number}.json`

```json
{
  "schemaVersion": 1,
  "issue": { "number": 42, "title": "Add auth", "url": "..." },
  "createdAt": "2026-02-04T10:00:00.000Z",
  "successCriteria": [
    { "id": "SC1", "category": "functional", "description": "Users can log in" },
    { "id": "SC2", "category": "testing", "description": "Auth tests pass" }
  ],
  "phases": [
    {
      "number": 1,
      "title": "Set up auth middleware",
      "status": "pending",
      "content": "Detailed instructions...",
      "verification": ["Middleware intercepts requests", "Unauthenticated requests return 401"],
      "addressesCriteria": ["SC1"],
      "files": ["src/middleware/auth.ts"],
      "dependencies": []
    }
  ],
  "coverageMatrix": { "SC1": [1, 2], "SC2": [3] }
}
```

### Release File Structure

Location: `.tiki/releases/{version}.json`

```json
{
  "version": "v0.2.0",
  "title": "Kanban Board for Visual Workflow Management",
  "description": "...",
  "status": "active",
  "createdAt": "2026-02-03T23:55:00.000Z",
  "issues": [
    { "number": 32, "title": "Add tab system", "status": "pending", "order": 1 },
    { "number": 33, "title": "Create Kanban view", "status": "pending", "order": 2 }
  ]
}
```

---

## Type System (`@tiki/shared`)

Located in `packages/shared/`, provides TypeScript types and JSON schemas used across the monorepo.

### Core Types

```typescript
type WorkStatus = 'pending' | 'reviewing' | 'planning' | 'executing' | 'paused' | 'shipping' | 'completed' | 'failed';
type PhaseStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
type PipelineStep = 'GET' | 'REVIEW' | 'PLAN' | 'AUDIT' | 'EXECUTE' | 'SHIP';
type WorkId = `issue:${number}` | `release:${string}`;
type CriterionId = `SC${number}`;
type CriteriaCategory = 'functional' | 'testing' | 'performance' | 'security' | 'documentation' | 'other';
```

### Work Types (Discriminated Union)

```typescript
type Work = IssueWork | ReleaseWork;

interface IssueWork {
  type: 'issue';
  issue: IssueInfo;
  status: WorkStatus;
  pipelineStep?: PipelineStep;
  phase?: PhaseProgress;
  createdAt: Timestamp;
  lastActivity: Timestamp;
  error?: WorkError;
  yolo?: boolean;
  commit?: string;
}

interface ReleaseWork {
  type: 'release';
  release: ReleaseInfo;
  status: WorkStatus;
  pipelineStep?: PipelineStep;
  phase?: PhaseProgress;
  createdAt: Timestamp;
  lastActivity: Timestamp;
  error?: WorkError;
}
```

### Helper Functions

- `issueWorkId(42)` → `'issue:42'`
- `releaseWorkId('v1.2')` → `'release:v1.2'`
- `parseWorkId(id)` → `{ type, id }`
- `isIssueWork(work)` / `isReleaseWork(work)` - Type guards
- `createEmptyState()`, `createIssueWork()`, `createReleaseWork()` - Factories
- `getNextPhase(plan)`, `isPlanComplete(plan)`, `buildCoverageMatrix(phases)` - Plan helpers

### Validation

- JSON schemas at `schemas/state.schema.json` and `schemas/plan.schema.json`
- Ajv-based validators: `validateState()`, `validatePlan()`, `assertValidState()`, `assertValidPlan()`
- Pattern validation for work IDs, version strings, criterion IDs, timestamps

### Constants

```typescript
const TIKI_PATHS = {
  root: '.tiki',
  state: '.tiki/state.json',
  config: '.tiki/config.json',
  plans: '.tiki/plans',
  releases: '.tiki/releases',
  research: '.tiki/research',
  knowledge: '.tiki/knowledge',
  commands: '.tiki/commands',
  hooks: '.tiki/hooks',
};
```

---

## Desktop App Integration

The Tauri desktop app (`apps/desktop/`) acts as a visual orchestrator for the framework.

### Rust Backend (`src-tauri/src/`)

| File | Purpose |
|------|---------|
| `watcher.rs` | Watches `.tiki/` recursively, emits `tiki-file-changed` events on state/plan/release changes |
| `commands.rs` | IPC commands: `get_state()`, `get_plan()`, `load_tiki_releases()`, `save_tiki_release()` |
| `state.rs` | Rust type definitions mirroring `@tiki/shared` types |
| `github.rs` | Wraps `gh` CLI: fetch/create/edit/close issues, fetch labels, branches |
| `terminal/` | PTY session management: create, write, resize, destroy terminals |

### Zustand Stores (`src/stores/`)

| Store | Purpose |
|-------|---------|
| `tikiStateStore` | Syncs `.tiki/state.json` → `activeWork` map |
| `issuesStore` | GitHub issues cache with filter (open/closed/all) |
| `terminalStore` | Terminal tab/split tree, active tab tracking |
| `layoutStore` | Panel sizes, active view (terminal/kanban) |
| `detailStore` | Selected issue/release for detail panel |
| `tikiReleasesStore` | In-memory cache of `.tiki/releases/*.json` |
| `kanbanStore` | Kanban view filters |
| `projectsStore` | Multi-project management |

### Data Flow

```
Terminal executes Tiki command (e.g., /tiki:yolo 42)
    ↓
Framework updates .tiki/state.json
    ↓
Rust watcher detects file change
    ↓
Emits "tiki-file-changed" Tauri event
    ↓
React App.tsx listener re-reads state via get_state() IPC
    ↓
Zustand tikiStateStore updated
    ↓
React components re-render (sidebar, kanban, detail panel)
```

### Kanban Integration

- Maps work status to columns: Backlog (pending/paused/failed) → Planning → Executing → Shipping → Completed
- Drag-and-drop triggers framework commands via terminal
- Dragging to Executing → runs `/tiki:yolo <issue>`
- Dragging to Shipping → confirmation dialog → `/tiki:ship <issue>`

---

## Key Design Decisions

1. **Fresh Context Per Phase** - Each phase runs in a sub-agent with only phase instructions + prior summaries. Avoids context exhaustion on large issues.

2. **Backward Planning from Success Criteria** - "What needs to be true when done?" drives phase creation. Coverage matrix ensures every criterion is addressed.

3. **Work-Scoped State Keys** - State keyed by `issue:N` / `release:vX.Y`, not terminal ID. Multiple terminals can work on different issues simultaneously.

4. **Verification Gates** - Audit validates plans (17 checks). Each phase has verification. Pre-ship checks run before committing. High-risk files get extra scrutiny.

5. **Hybrid Markdown + XML Command Format** - XML provides 23% higher accuracy on structured tasks, Markdown is 15% more token-efficient. Commands use YAML frontmatter + XML structure + Markdown content.

6. **File-Based State + Event Watching** - `.tiki/state.json` is the single source of truth. Rust watcher triggers UI updates (no polling). Zustand syncs Rust state into React reactivity.

7. **GitHub as Source of Truth** - Issues, milestones, and labels live in GitHub. Tiki caches metadata locally for offline access but GitHub remains authoritative.

8. **Monorepo with Shared Types** - `@tiki/shared` types used by both framework commands and desktop app. TypeScript + JSON schemas enforce consistency.

---

## Command Format Convention

All commands use hybrid Markdown + XML:

```markdown
---
name: get
description: Fetch and display a GitHub issue
argument: <issue-number>
tools: Bash, Read
---

<instructions>
  <step>Parse the issue number</step>
  <step>Fetch with `gh issue view`</step>
  <step>Display in readable format</step>
</instructions>

<state-management>...</state-management>
<output>...</output>
<errors>
  <error type="not-found">Issue #{number} not found.</error>
</errors>
<next-actions>...</next-actions>
```

---

## Status Progression

### Issue Work
```
pending → reviewing → planning → executing → shipping → completed
  (GET)    (REVIEW)    (PLAN      (EXECUTE)   (SHIP)
                        AUDIT)
```

### Release Work
```
pending → executing → shipping → completed
           (YOLO per    (tag,
            issue)       milestone)
```

### Phase Status
```
pending → executing → completed
                    → failed
                    → skipped
```
