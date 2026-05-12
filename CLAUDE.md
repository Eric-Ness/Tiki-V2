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
pnpm build                # Build all packages (uses tsc -b: stricter than typecheck)
pnpm typecheck            # Type-check all packages (uses tsc --noEmit)
pnpm test                 # Run all tests (vitest + cargo test)
pnpm clean                # Clean all build outputs

# From apps/desktop - Tauri development
pnpm tauri:dev            # Run desktop app in dev mode
pnpm tauri:build          # Build desktop binary
pnpm lint                 # ESLint

# Windows requirement: Run Tauri dev from "x64 Native Tools Command Prompt for VS 2022"
```

### Important: `pnpm build` ≠ `pnpm typecheck`

`pnpm build` runs `tsc -b` (project references), which is **stricter** than the `--noEmit` mode used by `pnpm typecheck`. In particular, discriminated-union narrowing through intermediate booleans fails under `tsc -b` but slips past `tsc --noEmit`. **Always verify with `pnpm build` before assuming a change is type-clean.**

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

## State Mutation: Always Through `state.mjs`

The framework has **two** mirrored implementations of the state-transition contract:

- `apps/desktop/src-tauri/src/state_transition.rs` — typed Rust IPC the desktop app calls
- `packages/framework/scripts/state.mjs` — bash-callable Node CLI mirror for framework commands

Framework commands (`.claude/commands/tiki/*.md`) must mutate `state.json` via the shim, not raw JSON writes:

```bash
node packages/framework/scripts/state.mjs transition issue:42 \
  --to-status executing --to-step EXECUTE \
  --phase-current 2 --phase-total 5 --phase-status executing
```

The canonical transition table lives at `packages/shared/src/types/transitions.ts` and both implementations mirror it. The shim validates transitions (rejects illegal pairs with exit 1), preserves `parentRelease`, and atomically writes via temp-file + rename. Acknowledged direct-JSON exceptions are noted inline in `ship.md` (history append, entry deletion) and `execute.md` (`parallelExecution` field).

## Known Environment Gotchas

### Windows pnpm reparse-point block

On some Windows machines (notably this one), pnpm's isolated linker creates NTFS junctions under `node_modules/.pnpm/` that the OS rejects as "untrusted mount points," causing `pnpm install` to fail mid-link. Symptoms include `UNKNOWN: unknown error, open '...node_modules\.pnpm\<pkg>\node_modules\<sub>\package.json'`.

**Do NOT use `pnpm install --ignore-workspace` as a workaround** — it corrupts the node_modules layout (lower-version transitive packages hoist to root and shadow workspace-declared versions). The minimal-damage workaround that still produces a working install is `$env:NPM_CONFIG_NODE_LINKER='hoisted'` for the shell session only (no `.npmrc` committed).

The durable fix is OS-level: add `node_modules` and `pnpm.exe`/`node.exe` exclusions to Windows Defender (or whichever filesystem filter driver is intercepting), or develop inside WSL.

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md) - Full architecture (773 lines)
- [docs/PLANNING-NOTES.md](docs/PLANNING-NOTES.md) - Planning context and decisions
- [docs/ENHANCEMENT-IDEAS.md](docs/ENHANCEMENT-IDEAS.md) - Backlog of small/medium enhancements (E1–E48)
- [CHANGELOG.md](CHANGELOG.md) - Human-readable release history
