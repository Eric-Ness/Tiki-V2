# Tiki v2 Planning Notes

**Date:** 2026-02-02
**Context:** Discussion about Tiki v2 architecture and fresh start

---

## Key Decisions Made

### 1. Fresh Start with New Repo
- Create `Tiki-V2` repo (can rename to `Tiki` later via GitHub settings)
- Current Tiki has accumulated complexity and isn't working as intended
- Keep the concepts, rebuild the implementation

### 2. Tauri Instead of Electron
- Current Electron app is too heavy (~300-500MB RAM, laggy)
- Tauri provides:
  - React/TypeScript frontend (leverage existing knowledge)
  - Rust backend (fast, memory-efficient)
  - ~10MB bundle vs ~150MB
  - ~50-100MB RAM vs ~300-500MB
  - Native OS webview (no bundled Chromium)

### 3. Monorepo Structure
- Framework and Desktop in same repo
- Shared types/schemas between them
- One PR can update both atomically

---

## Architecture Decisions

### Simplified State Model

**Work-scoped, not terminal-scoped.** Each piece of work tracks its own state. No complex context IDs needed.

```json
{
  "activeWork": {
    "release:v1.2": {
      "type": "release",
      "issues": [34, 35, 36],
      "status": "executing",
      "currentIssue": 35
    },
    "issue:42": {
      "type": "issue",
      "status": "executing",
      "currentPhase": 2
    }
  }
}
```

**Key insight from user:** Each context just needs to know what IT is working on and update its own plans/phases. No complex cross-context awareness needed.

### Parallel Execution Model

Parallelism can happen at ANY level:
- Release running multiple issues in parallel
- Single issue running multiple phases in parallel (if no file conflicts)

**Orchestrator responsibilities:**
1. Check for file conflicts between parallel work
2. Pass minimal context to each sub-agent
3. Collect summaries when each finishes
4. Manage dependency graphs (not just sequential execution)

### Requirements Verification Gap

**Problem identified:** Current Tiki doesn't verify that requirements/success criteria were actually met before shipping.

**Solution:** Bake verification into `ship` command or dedicated `verify` step. Before closing an issue, check:
- Were all success criteria addressed?
- Did verification items pass?

### Backward Planning for Requirements

Framing: **"What needs to be true for this to work?"**

Instead of: "Here's what I want → break into tasks"
Becomes: "Here's what I want → what must be true when done? → those are success criteria → work backward to derive phases"

---

## Command File Format

### Hybrid Markdown + XML (Research-Backed)

- XML tags for structure (23% higher accuracy on structured tasks)
- Markdown for content (15% more token-efficient)
- Best of both worlds

```markdown
---
name: get
description: Fetch and display a GitHub issue
argument: <issue-number>
tools: Bash, Read, AskUserQuestion
---

# Get Issue

<instructions>
  <step>Parse the issue number from the argument</step>
  <step>Fetch issue using `gh issue view {number} --json ...`</step>
  <step>Display issue in readable format</step>
</instructions>

<output>
## Issue #{number}: {title}
**State:** {state}
</output>

<errors>
  <error type="not-found">Issue #{number} not found.</error>
</errors>
```

### Command Naming

Keep `tiki:` prefix (Git-style approach user prefers):
- `tiki:get` - Fetch issue
- `tiki:plan` - Create phases
- `tiki:execute` - Run phases
- `tiki:ship` - Close issue
- `tiki:release:new` - Create release
- `tiki:release:yolo` - Execute all issues in release

---

## Proposed Project Structure

```
tiki-v2/
├── apps/
│   └── desktop/                    # Tauri app
│       ├── src/                    # React frontend
│       │   ├── components/
│       │   ├── stores/
│       │   └── App.tsx
│       ├── src-tauri/              # Rust backend
│       │   ├── src/
│       │   │   ├── main.rs
│       │   │   ├── commands/       # Tauri commands (IPC)
│       │   │   ├── watcher.rs      # File system watcher
│       │   │   └── state.rs        # State management
│       │   ├── Cargo.toml
│       │   └── tauri.conf.json
│       ├── package.json
│       └── vite.config.ts
│
├── packages/
│   ├── framework/                  # Claude Code commands
│   │   ├── commands/               # .claude/commands/tiki/*.md
│   │   ├── prompts/                # Conditional prompts
│   │   └── install.js              # Script to install into a project
│   │
│   └── shared/                     # Shared types & schemas
│       ├── schemas/                # JSON schemas
│       │   ├── state.schema.json
│       │   ├── plan.schema.json
│       │   └── release.schema.json
│       ├── types/                  # TypeScript types
│       └── package.json
│
├── docs/
│   ├── DESIGN.md                   # v2 design document
│   └── ARCHITECTURE.md
│
├── package.json                    # Workspace root
└── README.md
```

---

## User's Usage Pattern (Context for Design)

Real-world scenario described:
- **Tab 1:** Working on Release v1.2 (issues #34, #35, #36) - user system features
- **Tab 2:** Working on single issue #42 - admin section
- **Tab 3:** Working on single issue #50 - one-off feature

Each tab/context is independent. They don't need to know about each other. They just need to track their own work and update their own state.

---

## Version Roadmap

**Critical:** Define the roadmap upfront so v0.1 architecture supports v0.2 and beyond.

### v0.1 - Foundation
**Goal:** Single issue, end-to-end workflow

- [x] Monorepo structure (framework + desktop + shared)
- [x] Shared schemas: `state.schema.json`, `plan.schema.json`
- [x] TypeScript types matching schemas with helper functions
- [x] Schema validation utilities (Ajv-based)
- [x] Framework commands: `get`, `review`, `plan`, `audit`, `execute`, `ship`, `yolo`
- [ ] Desktop: State display panel (what's executing, current phase)
- [ ] Desktop: GitHub issues list
- [ ] Desktop: Basic terminal integration
- [ ] File watcher (Rust) syncs state to UI

**Architecture must support:** Multi-issue later, parallel later

---

### v0.2 - Releases & Multi-Issue
**Goal:** Group issues into releases, execute sequentially

- [ ] Framework commands: `release:new`, `release:add`, `release:status`, `release:ship`
- [ ] Shared schemas: `release.json`
- [ ] Desktop: Release management UI (create, add issues, view progress)
- [ ] Desktop: Release status visualization
- [ ] Sequential release execution (issue 1 → issue 2 → issue 3)
- [ ] Requirements tracking (what needs to be true for release)

**Architecture must support:** Parallel execution later

---

### v0.3 - Parallel Execution
**Goal:** Run independent work concurrently

- [ ] Orchestrator: Dependency graph analysis
- [ ] Orchestrator: File conflict detection
- [ ] Parallel phase execution (within single issue)
- [ ] Parallel issue execution (within release)
- [ ] Desktop: Multi-execution status display
- [ ] Sub-agent coordination protocol

---

### v0.4 - Verification & Quality
**Goal:** Ensure requirements are actually met

- [ ] Framework command: `verify`
- [ ] Success criteria tracking through execution
- [ ] Pre-ship verification gate
- [ ] Desktop: Requirements coverage matrix
- [ ] Audit trail (what was done, what was verified)

---

### v0.5 - Knowledge & Research
**Goal:** Learn from past work, research before planning

- [ ] Framework commands: `research`, `knowledge`
- [ ] Knowledge capture during execution
- [ ] Knowledge retrieval during planning
- [ ] Research document storage and indexing
- [ ] Desktop: Knowledge browser

---

### v0.6+ - Polish & Advanced Features
- Workflow visualization (React Flow diagrams)
- Cost prediction
- Failure pattern analysis
- Custom hooks system
- Project templates
- Auto-healing failed phases

---

## Open Items for Next Session

### To Design/Decide
1. **Detailed state.json schema** - flesh out the simplified model (must support v0.1-v0.3)
2. **Sub-agent handoff protocol** - what passes between phases
3. **Orchestrator location** - Framework (prompts), Desktop (UI), or both?
4. **Plan file schema** - phases, dependencies, verification items

### To Build
1. ~~Initialize `Tiki-V2` repo with monorepo structure~~ **DONE**
2. ~~Set up shared schemas package~~ **DONE**
3. Scaffold Tauri app
4. Create first framework command in hybrid format (`get.md`)
5. Implement state file watcher in Rust

---

## References

- Original v2 design doc: `.tiki/docs/TIKI-V2-DESIGN.md`
- Current Tiki Desktop: `C:\Users\ericn\Documents\Github\Tiki.Desktop`
- Current Tiki Framework: `C:\Users\ericn\Documents\Github\Tiki`

---

## Next Steps

When starting fresh context:
1. Read this file and `DESIGN.md`
2. ~~Create GitHub repo `Tiki-V2`~~ **DONE**
3. ~~Initialize monorepo structure~~ **DONE**
4. ~~Begin with shared schemas (foundation for everything else)~~ **DONE**
5. Build framework commands (start with `get.md`)
6. Build Tauri desktop app incrementally

### Completed (2026-02-02)
- Created `@tiki/shared` package with:
  - `schemas/state.schema.json` - Work-scoped execution state
  - `schemas/plan.schema.json` - Issue phase definitions with success criteria
  - TypeScript types with helper functions
  - Ajv-based validation utilities
- Set up pnpm workspace configuration
- Created `@tiki/framework` package with core commands:
  - `get.md` - Fetch and display GitHub issue
  - `review.md` - Analyze issue before planning
  - `plan.md` - Break issue into executable phases
  - `audit.md` - Validate plan before execution
  - `execute.md` - Run phases with sub-agents
  - `ship.md` - Commit, push, and close issue
  - `yolo.md` - Full automated pipeline
- Created install script for deploying commands to projects
- **Scaffolded Tauri desktop app** (`apps/desktop/`):
  - React + TypeScript + Vite frontend
  - Rust backend with Tauri 2.x
  - File watcher for `.tiki/` directory changes
  - Basic state display panel UI
  - IPC commands: `get_state`, `get_plan`, `get_tiki_path`
  - Event system: `tiki-file-changed` events emitted on state/plan changes

---

## Handoff Notes (2026-02-02, Latest)

### TL;DR - Start Here

**Project:** Tiki v2 - GitHub-issue-centric workflow framework for Claude Code
**Status:** v0.5 - Desktop app scaffolded and running, framework commands complete
**Next milestone:** GitHub issues list component, real-world testing

### Quick Start

**Run the desktop app:**
```cmd
# MUST use x64 Native Tools Command Prompt for VS 2022
cd C:\Users\ericn\Documents\Github\Tiki-V2\apps\desktop
pnpm tauri:dev
```

**Build/verify packages:**
```bash
cd C:\Users\ericn\Documents\Github\Tiki-V2
pnpm install
pnpm build
```

**Install framework to a project:**
```bash
cd <target-project>
node C:\Users\ericn\Documents\Github\Tiki-V2\packages\framework\install.js
```

---

### What Exists

| Component | Status | Notes |
|-----------|--------|-------|
| `@tiki/shared` | ✅ Complete | Schemas, types, validation |
| `@tiki/framework` | ✅ Complete | 7 commands (get→yolo pipeline) |
| `@tiki/desktop` | ✅ Scaffolded | Tauri app compiles and runs |
| File watcher | ✅ Built | Rust, monitors `.tiki/` |
| React UI | ✅ Built | State display panel |
| IPC commands | ✅ Built | get_state, get_plan, get_tiki_path |

### What Doesn't Exist Yet

- GitHub issues list component in desktop
- Terminal integration
- Release commands (`release:new`, `release:add`, etc.)
- Real-world testing of framework commands
- Frontend handling of file watcher events

---

### Project Structure

```
Tiki-V2/
├── packages/
│   ├── shared/              # TypeScript types + JSON schemas
│   │   ├── schemas/         # state.schema.json, plan.schema.json
│   │   └── src/             # Types, validation (Ajv)
│   └── framework/           # Claude Code commands
│       ├── commands/*.md    # get, review, plan, audit, execute, ship, yolo
│       └── install.js       # Deploys to .claude/commands/tiki/
├── apps/
│   └── desktop/             # Tauri app (React + Rust)
│       ├── src/             # React frontend
│       └── src-tauri/       # Rust backend (watcher, IPC)
└── docs/
    ├── DESIGN.md            # Full architecture
    └── PLANNING-NOTES.md    # This file
```

---

### Key Design Decisions

1. **Work-scoped state** - Keys like `issue:42` or `release:v1.2`, not terminal IDs
2. **Hybrid Markdown+XML commands** - YAML frontmatter + XML tags + Markdown content
3. **Success criteria first** - "What needs to be true?" → derive phases backward
4. **Sub-agent execution** - Fresh context per phase, summaries passed forward
5. **Tauri over Electron** - ~10MB vs ~150MB, ~50MB RAM vs ~300MB

### Framework Commands

| Command | Purpose |
|---------|---------|
| `tiki:get` | Fetch GitHub issue, initialize state |
| `tiki:review` | Analyze issue, derive success criteria |
| `tiki:plan` | Create phases with coverage matrix |
| `tiki:audit` | Validate plan completeness |
| `tiki:execute` | Run phases with sub-agents |
| `tiki:ship` | Commit, push, close issue |
| `tiki:yolo` | Full automated pipeline |

---

### Important Technical Notes

- **Windows:** Must run Tauri from "x64 Native Tools Command Prompt for VS 2022"
- **Tauri version:** Pinned to 2.9.1 (matches @tauri-apps/api)
- **pnpm workspace:** Always run `pnpm install` from repo root
- **GitHub CLI:** Framework commands require authenticated `gh`

### Files to Read First

1. [docs/DESIGN.md](docs/DESIGN.md) - Full architecture
2. [docs/PLANNING-NOTES.md](docs/PLANNING-NOTES.md) - This file
3. [packages/shared/schemas/state.schema.json](packages/shared/schemas/state.schema.json) - State model
4. [packages/shared/schemas/plan.schema.json](packages/shared/schemas/plan.schema.json) - Plan model
5. [packages/framework/commands/get.md](packages/framework/commands/get.md) - Command format reference
6. [apps/desktop/src/App.tsx](apps/desktop/src/App.tsx) - Desktop UI

### Key Desktop Files

| File | Purpose |
|------|---------|
| `apps/desktop/src/App.tsx` | React UI component |
| `apps/desktop/src-tauri/src/lib.rs` | Tauri setup |
| `apps/desktop/src-tauri/src/commands.rs` | IPC commands |
| `apps/desktop/src-tauri/src/watcher.rs` | File system watcher |
| `apps/desktop/src-tauri/src/state.rs` | Rust types |

---

### Roadmap

- **v0.1** (current): Single issue workflow, desktop state display
- **v0.2**: Release commands, multi-issue grouping
- **v0.3**: Parallel execution, dependency graphs
- **v0.4**: Verification gates, requirements tracking
- **v0.5**: Knowledge & research system

---

### What to Do Next

1. **Test framework commands** - Use `tiki:get <issue>` on a real GitHub issue
2. **Add GitHub issues list** - Component in desktop app using `gh` CLI
3. **Wire up file watcher events** - Frontend should refresh on state changes
4. **Create `.tiki/` structure** - Test desktop app with real state.json
