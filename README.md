# Tiki v2

GitHub-issue-centric workflow framework for Claude Code.

## Status

**v0.1 In Progress** - Shared schemas and framework commands complete. Desktop app not started.

| Package | Status |
|---------|--------|
| `@tiki/shared` | ✅ Complete |
| `@tiki/framework` | ✅ Complete |
| `apps/desktop` | ❌ Not started |

## Quick Start

```bash
pnpm install    # Install dependencies
pnpm build      # Build shared package
```

## Architecture

- **Framework**: Claude Code custom commands (`.claude/commands/tiki/`)
- **Desktop**: Tauri app (React + Rust) - planned
- **Shared**: TypeScript types and JSON schemas

## Commands

| Command | Purpose |
|---------|---------|
| `tiki:get` | Fetch and display GitHub issue |
| `tiki:review` | Analyze issue before planning |
| `tiki:plan` | Break issue into executable phases |
| `tiki:audit` | Validate plan before execution |
| `tiki:execute` | Run phases with sub-agents |
| `tiki:ship` | Commit, push, and close issue |
| `tiki:yolo` | Full automated pipeline |

## Workflow

```
GET → REVIEW → PLAN → AUDIT → EXECUTE → SHIP
                  ↑                        |
                  └────── (or YOLO) ───────┘
```

## Roadmap

| Version | Focus | Status |
|---------|-------|--------|
| v0.1 | Foundation - single issue workflow | In progress |
| v0.2 | Releases & multi-issue | Planned |
| v0.3 | Parallel execution | Planned |
| v0.4 | Verification & quality | Planned |
| v0.5 | Knowledge & research | Planned |

## Project Structure

```
tiki-v2/
├── apps/
│   └── desktop/              # Tauri app (not started)
├── packages/
│   ├── framework/            # Claude Code commands
│   │   ├── commands/*.md     # Command definitions
│   │   └── install.js        # Install script
│   └── shared/               # Types & schemas
│       ├── schemas/          # JSON schemas
│       └── src/              # TypeScript types
└── docs/
    ├── DESIGN.md             # Full design document
    └── PLANNING-NOTES.md     # Planning & handoff notes
```

## Documentation

- [DESIGN.md](docs/DESIGN.md) - Full architecture and design
- [PLANNING-NOTES.md](docs/PLANNING-NOTES.md) - Planning context and handoff notes
