# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tiki v2 is a GitHub-issue-centric workflow framework for Claude Code. It orchestrates software development against GitHub issues with a structured pipeline: GET → REVIEW → PLAN → AUDIT → EXECUTE → SHIP.

## Repository Structure

This is a **pnpm monorepo** with three main packages:

- `packages/shared` - TypeScript types and JSON schemas (`@tiki/shared`)
- `packages/framework` - Claude Code commands (7 core workflow commands)
- `apps/desktop` - Tauri desktop app (React frontend + Rust backend)

## Development Commands

```bash
# From root - workspace operations
pnpm install              # Install all dependencies
pnpm build                # Build all packages
pnpm typecheck            # Type-check all packages
pnpm clean                # Clean all build outputs

# From apps/desktop - Tauri development
pnpm tauri:dev            # Run desktop app in dev mode
pnpm tauri:build          # Build desktop binary
pnpm lint                 # ESLint

# Windows requirement: Run Tauri dev from "x64 Native Tools Command Prompt for VS 2022"
```

## Architecture

### Tiki State System

All state lives in `.tiki/` directory:
- `.tiki/state.json` - Central state file (work keyed by ID: `issue:42`, `release:v1.2`)
- `.tiki/plans/issue-N.json` - Phase definitions per issue
- `.tiki/releases/v1.1.json` - Release groupings
- `.tiki/research/*.md` - Domain knowledge
- `.tiki/commands/*.md` - Project-specific custom commands
- `.tiki/hooks/*.sh` - Lifecycle scripts

### Desktop App Architecture

**Frontend (React + TypeScript):**
- Components organized by feature: `layout/`, `sidebar/`, `terminal/`, `detail/`
- State management via Zustand stores in `src/stores/`
- Terminal emulation with xterm.js

**Backend (Rust + Tauri):**
- `src-tauri/src/commands.rs` - IPC commands exposed to frontend
- `src-tauri/src/watcher.rs` - File system watcher for `.tiki/` changes
- `src-tauri/src/state.rs` - Application state management

### Framework Commands

Hybrid Markdown + XML format (see `packages/framework/commands/`):
- `get.md` - Fetch GitHub issue
- `review.md` - Analyze issue
- `plan.md` - Break into phases
- `audit.md` - Validate plan
- `execute.md` - Run phases with sub-agents
- `ship.md` - Commit, push, close
- `yolo.md` - Full automated pipeline

### Type System

Core types in `@tiki/shared`:
- `WorkStatus`: `'pending' | 'planning' | 'executing' | 'paused' | 'shipping' | 'completed' | 'failed'`
- `PhaseStatus`: `'pending' | 'executing' | 'completed' | 'failed' | 'skipped'`
- `Work`: `IssueWork | ReleaseWork` - discriminated union for work items

## Key Design Decisions

1. **GitHub as Source of Truth** - Issues/milestones in GitHub, Tiki orchestrates work
2. **Fresh Context Execution** - Large work broken into phases, each executed by sub-agents
3. **Work-Scoped State Keys** - State keyed by work ID (`issue:N`), not terminal ID
4. **Multi-Context Support** - Multiple terminals can work on different issues simultaneously

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md) - Full architecture (773 lines)
- [docs/PLANNING-NOTES.md](docs/PLANNING-NOTES.md) - Planning context and decisions
