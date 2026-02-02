# Tiki v2 Design Document

## Overview

Tiki v2 is a complete rewrite of the GitHub-issue-centric workflow framework for Claude Code. This document defines the architecture, state management, command structure, and style guidelines for the rewrite.

## Core Philosophy

1. **GitHub as Source of Truth** - Issues and milestones live in GitHub, Tiki orchestrates work against them
2. **Fresh Context Execution** - Break large work into phases, execute each with sub-agents to sidestep context limits
3. **Single State File** - One `state.json` tracks all execution contexts (no fragmentation)
4. **Lean Commands** - Minimal flags, most commands take just an issue number or version
5. **Multi-Context Support** - Multiple terminal sessions can work on different issues/releases simultaneously

---

## Architecture Flowchart

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              GITHUB                                           │
│                        (Source of Truth)                                      │
│                                                                               │
│    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐          │
│    │   Issues    │         │  Milestones │         │   Labels    │          │
│    │  (#1, #2..) │         │   (v1.0..)  │         │ (bug, feat) │          │
│    └──────┬──────┘         └──────┬──────┘         └─────────────┘          │
└───────────┼────────────────────────┼─────────────────────────────────────────┘
            │                        │
            │    ┌───────────────────┘
            │    │
            ▼    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           TIKI LAYER                                          │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                         state.json                                      │  │
│  │                   (Single Source of Truth)                              │  │
│  │                                                                         │  │
│  │  {                                                                      │  │
│  │    "contexts": {                                                        │  │
│  │      "ctx-abc123": {        // Terminal 1                               │  │
│  │        "type": "issue",                                                 │  │
│  │        "issue": 34,                                                     │  │
│  │        "phase": { "current": 2, "total": 5 },                          │  │
│  │        "status": "executing"                                            │  │
│  │      },                                                                 │  │
│  │      "ctx-def456": {        // Terminal 2                               │  │
│  │        "type": "release",                                               │  │
│  │        "version": "v1.1",                                               │  │
│  │        "currentIssue": 35,                                              │  │
│  │        "status": "executing"                                            │  │
│  │      }                                                                  │  │
│  │    },                                                                   │  │
│  │    "history": { "lastIssue": 33, "lastRelease": "v1.0" }               │  │
│  │  }                                                                      │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │ plans/issue-N.json  │  │ releases/v1.1.json  │  │   research/*.md     │  │
│  │  (phase definitions)│  │  (issue grouping)   │  │ (domain knowledge)  │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        CORE WORKFLOW                                          │
│                                                                               │
│     ┌─────────┐                                                               │
│     │  INIT   │  (greenfield: new-project / brownfield: install)             │
│     └────┬────┘                                                               │
│          │                                                                    │
│          ▼                                                                    │
│     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐             │
│     │   GET   │────▶│ REVIEW  │────▶│  PLAN   │────▶│  AUDIT  │             │
│     │   #34   │     │  #34    │     │   #34   │     │   #34   │             │
│     └─────────┘     └─────────┘     └─────────┘     └────┬────┘             │
│                                                          │                   │
│                                                          ▼                   │
│     ┌─────────┐                                    ┌───────────┐             │
│     │  SHIP   │◀───────────────────────────────────│  EXECUTE  │             │
│     │   #34   │                                    │    #34    │             │
│     └─────────┘                                    └───────────┘             │
│          │                                               │                   │
│          │                                               │                   │
│          │         ┌─────────────────────────────────────┘                   │
│          │         │                                                         │
│          │         ▼                                                         │
│          │    ┌─────────────────────────────────────────────────────────┐   │
│          │    │              PHASE EXECUTION (Sub-Agents)                │   │
│          │    │                                                          │   │
│          │    │   Phase 1        Phase 2        Phase 3        Phase N   │   │
│          │    │  ┌───────┐      ┌───────┐      ┌───────┐      ┌───────┐ │   │
│          │    │  │ Task  │─────▶│ Task  │─────▶│ Task  │─────▶│ Task  │ │   │
│          │    │  │ Agent │      │ Agent │      │ Agent │      │ Agent │ │   │
│          │    │  └───────┘      └───────┘      └───────┘      └───────┘ │   │
│          │    │      │              │              │              │      │   │
│          │    │      ▼              ▼              ▼              ▼      │   │
│          │    │  [summary]      [summary]      [summary]      [summary]  │   │
│          │    │      │              │              │              │      │   │
│          │    │      └──────────────┴──────────────┴──────────────┘      │   │
│          │    │                         │                                │   │
│          │    │              Passed to next phase                        │   │
│          │    └─────────────────────────────────────────────────────────┘   │
│          │                                                                   │
│          ▼                                                                   │
│     ┌─────────┐                                                              │
│     │ COMPLETE│  Issue closed on GitHub, state updated                      │
│     └─────────┘                                                              │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                        RELEASE WORKFLOW                                       │
│                                                                               │
│     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐              │
│     │ release:new  │────▶│ release:add  │────▶│ release:yolo │              │
│     │    v1.1      │     │  #34 #35 #36 │     │     v1.1     │              │
│     └──────────────┘     └──────────────┘     └──────┬───────┘              │
│                                                       │                      │
│                                         ┌─────────────┼─────────────┐        │
│                                         │             │             │        │
│                                         ▼             ▼             ▼        │
│                                    ┌────────┐   ┌────────┐   ┌────────┐     │
│                                    │ yolo   │   │ yolo   │   │ yolo   │     │
│                                    │  #34   │   │  #35   │   │  #36   │     │
│                                    └────────┘   └────────┘   └────────┘     │
│                                         │             │             │        │
│                                         └─────────────┼─────────────┘        │
│                                                       │                      │
│                                                       ▼                      │
│                                              ┌──────────────┐                │
│                                              │ release:ship │                │
│                                              │     v1.1     │                │
│                                              └──────────────┘                │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                        YOLO MODE (Automated Pipeline)                         │
│                                                                               │
│     yolo #34                                                                  │
│         │                                                                     │
│         ▼                                                                     │
│     ┌───────┐   ┌────────┐   ┌──────┐   ┌───────┐   ┌─────────┐   ┌──────┐ │
│     │  get  │──▶│ review │──▶│ plan │──▶│ audit │──▶│ execute │──▶│ ship │ │
│     └───────┘   └────────┘   └──────┘   └───────┘   └─────────┘   └──────┘ │
│                                                                               │
│     All steps automated, fresh context per phase                             │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## State Management

### Single State File: `.tiki/state.json`

The state file supports multiple concurrent execution contexts (for multiple terminals/tabs).

```json
{
  "schemaVersion": 1,
  "contexts": {
    "ctx-a1b2c3": {
      "type": "issue",
      "createdAt": "2026-02-02T10:00:00Z",
      "lastActivity": "2026-02-02T10:30:00Z",
      "issue": {
        "number": 34,
        "title": "Add user authentication"
      },
      "phase": {
        "current": 2,
        "total": 5,
        "status": "executing"
      }
    },
    "ctx-d4e5f6": {
      "type": "release",
      "createdAt": "2026-02-02T09:00:00Z",
      "lastActivity": "2026-02-02T11:00:00Z",
      "release": {
        "version": "v1.1",
        "issues": [35, 36, 37],
        "currentIssue": 36,
        "completedIssues": [35]
      },
      "phase": {
        "current": 3,
        "total": 4,
        "status": "executing"
      }
    }
  },
  "history": {
    "lastCompletedIssue": {
      "number": 33,
      "completedAt": "2026-02-01T15:00:00Z"
    },
    "lastCompletedRelease": {
      "version": "v1.0",
      "completedAt": "2026-01-28T12:00:00Z"
    }
  }
}
```

### Context ID Generation

Each terminal session gets a unique context ID:
- Generated on first command (e.g., `get 34`)
- Stored in environment or session file
- Allows multiple parallel executions without conflict

### Plan Files: `.tiki/plans/issue-N.json`

Phase definitions and progress live here (not duplicated in state.json):

```json
{
  "issue": {
    "number": 34,
    "title": "Add user authentication",
    "url": "https://github.com/org/repo/issues/34"
  },
  "createdAt": "2026-02-02T10:00:00Z",
  "successCriteria": [
    { "id": "SC1", "category": "functional", "description": "Users can log in" },
    { "id": "SC2", "category": "testing", "description": "Auth tests pass" }
  ],
  "phases": [
    {
      "number": 1,
      "title": "Create auth module structure",
      "status": "completed",
      "completedAt": "2026-02-02T10:15:00Z",
      "content": "...",
      "verification": ["Files created", "Module exports work"],
      "addressesCriteria": ["SC1"],
      "files": ["src/auth/index.ts", "src/auth/types.ts"]
    },
    {
      "number": 2,
      "title": "Implement login endpoint",
      "status": "in_progress",
      "content": "...",
      "verification": ["Endpoint responds", "Returns JWT"],
      "addressesCriteria": ["SC1"],
      "files": ["src/auth/login.ts", "src/routes/auth.ts"]
    }
  ],
  "coverageMatrix": {
    "SC1": [1, 2, 3],
    "SC2": [4]
  }
}
```

---

## Command Structure

### Design Principles

1. **Minimal arguments** - Most commands take just an issue number or version
2. **No unnecessary flags** - Remove rarely-used options
3. **Consistent naming** - `verb` for issue commands, `release:verb` for release commands
4. **Natural language** - Commands read like actions

### Core Commands (Issue Workflow)

| Command | Arguments | Description |
|---------|-----------|-------------|
| `get` | `<issue>` | Fetch and display a GitHub issue |
| `review` | `<issue>` | Analyze issue before planning |
| `plan` | `<issue>` | Break issue into executable phases |
| `audit` | `<issue>` | Validate plan before execution |
| `execute` | `<issue>` | Run phases with sub-agents |
| `ship` | `<issue>` | Commit, push, close issue |
| `yolo` | `<issue>` | Full pipeline (get→review→plan→audit→execute→ship) |

### Release Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
| `release:new` | `<version>` | Create a new release, select issues |
| `release:add` | `<issues...>` | Add issues to current/specified release |
| `release:status` | `[version]` | Show release progress |
| `release:yolo` | `<version>` | Execute all issues in release |
| `release:ship` | `<version>` | Tag, close milestone, archive |

### Execution Control

| Command | Arguments | Description |
|---------|-----------|-------------|
| `pause` | | Save current context for later |
| `resume` | | Continue paused work |
| `heal` | | Auto-diagnose and fix failed phase |
| `skip` | `<phase>` | Skip a phase |
| `redo` | `<phase>` | Re-execute a phase |

### Project Setup & Maintenance

| Command | Arguments | Description |
|---------|-----------|-------------|
| `init` | | Initialize Tiki (detects greenfield/brownfield) |
| `update` | | Update Tiki to latest version (pulls from source repo) |

### Support Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
| `state` | | Show current execution state |
| `research` | `<topic>` | Research a domain before planning |
| `knowledge` | `<action>` | Manage institutional knowledge |
| `debug` | | Start debugging session |

---

## Project Initialization

### Greenfield (New Project)

```
tiki init
├── Detect: No existing codebase
├── Ask: Project name, type, tech stack preferences
├── Generate: PROJECT.md, basic structure
├── Create: Initial GitHub issues from requirements
└── Ready: First issue available for yolo
```

### Brownfield (Existing Project)

```
tiki init
├── Detect: Existing codebase found
├── Analyze: Tech stack, patterns, structure
├── Generate: PROJECT.md from analysis
├── Ask: Confirm detected patterns, any corrections
├── Optionally: Map existing issues to Tiki format
└── Ready: Pick an issue to start
```

### Detection Logic

```
Is there a package.json / Cargo.toml / go.mod / etc?
  YES → Brownfield: analyze existing stack
  NO  → Is src/ or similar structure present?
    YES → Brownfield: analyze structure
    NO  → Greenfield: start from scratch
```

---

## Style Guide

### Command Files: Hybrid Markdown + XML

Based on research ([Anthropic docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags), [performance studies](https://medium.com/@isaiahdupree33/optimal-prompt-formats-for-llms-xml-vs-markdown-performance-insights-cef650b856db)):

- **Claude parses XML tags as natural reasoning delimiters** - 23% higher accuracy on structured tasks
- **Markdown is 15% more token-efficient** than pure XML
- **Best practice: Hybrid** - XML tags for structure, Markdown for content

#### Command File Format

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
  <step>Fetch issue using `gh issue view {number} --json number,title,body,state,labels`</step>
  <step>Display issue in readable format</step>
  <step>Offer next actions menu via AskUserQuestion</step>
</instructions>

<output>
## Issue #{number}: {title}

**State:** {state}
**Labels:** {labels}
**Milestone:** {milestone}

### Description
{body}
</output>

<errors>
  <error type="not-found">Issue #{number} not found. Check the number and try again.</error>
  <error type="no-gh">GitHub CLI not installed. Run `gh auth login` first.</error>
</errors>

<next-actions>
  - Review issue → `/tiki:review {number}`
  - Plan issue → `/tiki:plan {number}`
  - Research → `/tiki:research {topic}`
</next-actions>
```

#### Why This Format

| Element | Format | Reason |
|---------|--------|--------|
| Frontmatter | YAML (`---`) | Tooling compatibility, easy parsing |
| Instructions | `<instructions>` | Claude treats as clear boundaries |
| Steps | `<step>` tags | Prevents mixing instructions with examples |
| Output | `<output>` | Claude knows this is template, not instruction |
| Errors | `<errors>` | Grouped for easy reference |
| Content | Markdown | Token-efficient, human-readable |

#### Principles

1. **One XML tag per concern** - instructions, output, errors, next-actions
2. **Markdown inside tags** - Use headings, lists, code blocks within XML
3. **No nested conditionals** - Keep logic linear; use separate commands for variants
4. **Self-contained** - Each command file has everything needed to execute

### State Files

1. **Always validate on write** - Use JSON Schema
2. **Timestamps in ISO 8601** - `2026-02-02T10:00:00Z`
3. **IDs are prefixed** - `ctx-`, `SC`, etc.
4. **Minimal nesting** - Prefer flat structures

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Commands | lowercase verb | `get`, `plan`, `ship` |
| Release commands | `release:verb` | `release:new`, `release:ship` |
| Context IDs | `ctx-<random>` | `ctx-a1b2c3` |
| Criteria IDs | `SC<number>` | `SC1`, `SC2` |
| Phase status | lowercase | `pending`, `executing`, `completed`, `failed` |

---

## Extensibility System

Tiki v2 maintains the hook system and custom commands as the primary extensibility mechanism. This keeps the core lean while allowing project-specific customization.

### Lifecycle Hooks

Hooks are shell scripts that run at specific workflow points.

```text
.tiki/hooks/
├── hooks.json          # Registry of active hooks
├── pre-execute.sh      # Before execution starts
├── post-execute.sh     # After all phases complete
├── phase-start.sh      # Before each phase
├── phase-complete.sh   # After each phase
├── pre-ship.sh         # Before shipping
└── post-ship.sh        # After shipping
```

**hooks.json Registry:**

```json
{
  "hooks": {
    "pre-execute": {
      "script": "pre-execute.sh",
      "enabled": true
    },
    "post-ship": {
      "script": "post-ship.sh",
      "enabled": true
    }
  }
}
```

**Environment Variables Passed to Hooks:**

| Hook | Variables |
|------|-----------|
| pre-execute | `TIKI_ISSUE`, `TIKI_TITLE`, `TIKI_TOTAL_PHASES` |
| post-execute | `TIKI_ISSUE`, `TIKI_PHASES_COMPLETED` |
| phase-start | `TIKI_ISSUE`, `TIKI_PHASE`, `TIKI_PHASE_TITLE` |
| phase-complete | `TIKI_ISSUE`, `TIKI_PHASE`, `TIKI_PHASE_STATUS` |
| pre-ship | `TIKI_ISSUE`, `TIKI_TITLE` |
| post-ship | `TIKI_ISSUE`, `TIKI_COMMIT_SHA` |

**Windows Support:** Hooks can be `.sh` (Git Bash) or `.ps1` (PowerShell).

### Custom Commands

Users can add project-specific commands in `.tiki/commands/`. These extend Tiki without modifying the core.

```text
.tiki/commands/
├── deploy.md           # Custom deploy command
├── notify.md           # Custom notification command
└── my-workflow.md      # Project-specific workflow
```

Custom commands follow the same format as core commands (Markdown + XML tags) and can:
- Be invoked via `/tiki:custom-name` or however Claude Code surfaces them
- Call hooks
- Use all standard tools (Bash, Read, Write, etc.)
- Chain to core Tiki commands via Skill tool

**Example Custom Command:**

```markdown
---
name: deploy
description: Deploy to staging after ship
argument: <issue-number>
tools: Bash, Read
---

<instructions>
  <step>Verify issue #{argument} was shipped (check state.json)</step>
  <step>Run deployment script: `./scripts/deploy-staging.sh`</step>
  <step>Post deployment status to GitHub issue comment</step>
</instructions>
```

### Hooks Can Call Custom Commands

The hook system and custom commands work together:

```bash
#!/bin/bash
# .tiki/hooks/post-ship.sh

# After shipping, trigger custom deploy
echo "Triggering deployment for issue $TIKI_ISSUE..."
# The user's next command could be the custom deploy
```

---

## File Structure

```text
.tiki/
├── state.json              # Single execution state (multi-context)
├── config.json             # Project settings
├── plans/
│   └── issue-N.json        # Phase definitions per issue
├── releases/
│   ├── v1.1.json           # Active release
│   └── archive/            # Completed releases
├── research/
│   ├── index.json          # Research document index
│   └── *.md                # Research documents
├── knowledge/
│   ├── index.json          # Knowledge entry index
│   └── entries/            # Individual entries
├── commands/               # USER custom commands (extensibility)
│   └── *.md                # Project-specific commands
├── hooks/                  # Lifecycle scripts
│   ├── hooks.json          # Hook registry
│   └── *.sh / *.ps1        # Hook scripts
├── schemas/                # JSON Schema validation
│   ├── state.schema.json
│   └── plan.schema.json
└── docs/                   # Documentation
    └── TIKI-V2-DESIGN.md   # This file

.claude/commands/tiki/      # CORE Tiki commands (the framework)
├── get.md
├── plan.md
├── execute.md
├── ship.md
├── yolo.md
├── release-new.md
└── ...
```

---

## Migration from v1

### Automatic Detection

When a v1 state structure is detected:
1. Back up existing `.tiki/` to `.tiki-v1-backup/`
2. Migrate state files to new schema
3. Preserve plans, research, knowledge
4. Log migration steps

### Manual Cleanup

After migration:
- Remove unused conditional prompt files (124 → ~20)
- Update CLAUDE.md with v2 patterns
- Test with a simple issue

---

## Implementation Phases

### Phase 1: Core State & Commands
- [ ] New state.json schema with multi-context
- [ ] Core commands: get, plan, execute, ship
- [ ] State validation on write

### Phase 2: Workflow Integration
- [ ] review command
- [ ] audit command
- [ ] yolo pipeline

### Phase 3: Release Layer
- [ ] release:new, release:add
- [ ] release:yolo, release:ship
- [ ] release:status

### Phase 4: Project Setup
- [ ] init command (greenfield/brownfield detection)
- [ ] update command
- [ ] Migration from v1

### Phase 5: Support Features
- [ ] research integration
- [ ] knowledge system
- [ ] debug sessions
- [ ] hooks (simplified)

---

## Open Questions

### Resolved

1. **Hooks system** - ✅ **Keep it.** Hooks are essential for extensibility. They allow users to extend Tiki without modifying core commands.

2. **Custom commands** - ✅ **Keep it.** The `.tiki/commands/` folder allows project-specific commands that can work with hooks.

3. **Update mechanism** - ✅ **Keep current approach.** `update` command pulls latest Tiki version. Works well as-is.

### Still Open

1. **Context persistence** - How does a terminal session remember its context ID across commands?
   - Option A: Environment variable (TIKI_CONTEXT)
   - Option B: PID-based lookup
   - Option C: File in .tiki/sessions/
   - **Leaning toward:** Environment variable set on first command, or auto-detect from recent activity

2. **Parallel execution limits** - Should there be a max number of concurrent contexts?
   - Probably yes, to prevent state file conflicts
   - Suggested: 3-5 concurrent contexts max

3. **Context cleanup** - How long do stale contexts persist?
   - Auto-cleanup contexts with no activity for 24h?
   - Or manual cleanup via `state --cleanup`?

4. **Research integration depth** - How much research context to pass to sub-agents?
   - Full research docs? Summaries only? Keywords?

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-02-02 | Initial design draft |
| 0.2 | 2026-02-02 | Added: hybrid Markdown+XML format (research-backed), extensibility system (hooks + custom commands), resolved open questions on hooks/update/custom commands |

## Next Steps

When continuing this design work:

1. **Context persistence** - Decide how terminals track their context ID
2. **Detailed schemas** - Write JSON Schema for state.json and plan files
3. **Sub-agent protocol** - Define what passes between phases
4. **Write a sample command** - Create one v2 command as a reference template
5. **Migration plan** - How to convert v1 installations
