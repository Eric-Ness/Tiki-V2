# Tiki v2

GitHub-issue-centric workflow framework for Claude Code.

## Status

**In Development** - See [docs/PLANNING-NOTES.md](docs/PLANNING-NOTES.md) for roadmap.

## Architecture

- **Framework**: Claude Code custom commands (`.claude/commands/tiki/`)
- **Desktop**: Tauri app (React + Rust)
- **Shared**: Types and JSON schemas

## Roadmap

| Version | Focus |
|---------|-------|
| v0.1 | Foundation - single issue workflow |
| v0.2 | Releases & multi-issue |
| v0.3 | Parallel execution |
| v0.4 | Verification & quality |
| v0.5 | Knowledge & research |

## Project Structure

```
tiki-v2/
├── apps/
│   └── desktop/          # Tauri app
├── packages/
│   ├── framework/        # Claude Code commands
│   └── shared/           # Types & schemas
└── docs/
```
