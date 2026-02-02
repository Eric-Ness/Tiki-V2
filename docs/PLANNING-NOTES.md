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

- [ ] Monorepo structure (framework + desktop + shared)
- [ ] Shared schemas: `state.json`, `plan.json`
- [ ] Framework commands: `get`, `plan`, `execute`, `ship`
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
1. Initialize `Tiki-V2` repo with monorepo structure
2. Scaffold Tauri app
3. Set up shared schemas package
4. Create first framework command in hybrid format
5. Implement state file watcher in Rust

---

## References

- Original v2 design doc: `.tiki/docs/TIKI-V2-DESIGN.md`
- Current Tiki Desktop: `C:\Users\ericn\Documents\Github\Tiki.Desktop`
- Current Tiki Framework: `C:\Users\ericn\Documents\Github\Tiki`

---

## Next Steps

When starting fresh context:
1. Read this file and `TIKI-V2-DESIGN.md`
2. Create GitHub repo `Tiki-V2`
3. Initialize monorepo structure
4. Begin with shared schemas (foundation for everything else)
5. Build framework commands
6. Build Tauri desktop app incrementally
