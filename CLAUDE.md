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

On Windows 11 (24H2 and newer; possibly older builds), pnpm's isolated linker creates NTFS junctions under `node_modules/` that the OS rejects as "untrusted mount points," causing `pnpm install` to fail mid-link. Symptoms include `UNKNOWN: unknown error, open '...node_modules\.pnpm\<pkg>\node_modules\<sub>\package.json'` or, with a clearer error path, `The path cannot be traversed because it contains an untrusted mount point.`

**Root cause:** This is a kernel-level mitigation, **not** Defender. Every NTFS reparse point gets labeled with the Mandatory Integrity Level of the process that created it, and the kernel refuses to follow Medium-IL-created junctions for any reader. Defender exclusions don't fix the underlying behavior — they only reduce scan overhead during installs.

**Fix:** Run `pnpm install` from an **elevated PowerShell**. High-IL-created junctions are trusted by the kernel for all readers, so the rest of the toolchain (IDE, vite dev server, tauri build, vitest, cargo) keeps running from a normal (Medium-IL) shell afterward. Only the install step needs admin.

```powershell
# Elevated PowerShell — when installing/updating deps:
cd <repo>
pnpm install

# Normal PowerShell — everything else:
pnpm build
pnpm tauri:dev
```

**Sticky-state gotcha:** If a previous Medium-IL `pnpm install` left partial junctions, a subsequent admin install's *verify* pass will report "Already up to date" without recreating them — and they remain untrusted to Medium-IL readers. To force re-creation: `cmd /c rmdir /s /q <node_modules>` at the repo root **and** each workspace dir (`apps/*/node_modules`, `packages/*/node_modules`), then re-run elevated install.

**Do NOT use `pnpm install --ignore-workspace` as a workaround** — it corrupts the node_modules layout (lower-version transitive packages hoist to root and shadow workspace-declared versions). The `NPM_CONFIG_NODE_LINKER=hoisted` workaround **also no longer suffices** as of 24H2 — workspace junctions to `@tiki/shared` still trip the same kernel check.

WSL is an alternative durable fix (bypasses the Windows reparse-point check entirely) if you don't want every install to require elevation.

## Lifecycle Hooks

The `.tiki/hooks/` lifecycle hook system (DESIGN.md §"Lifecycle Hooks") is **implemented** as a real runner: `packages/framework/scripts/run-hook.mjs` (Node built-ins only, mirrors `state.mjs` conventions). EXECUTE fires `pre-execute` / `phase-start` / `phase-complete` / `post-execute`; SHIP fires `pre-ship` / `post-ship`. The `execute.md` and `ship.md` command files invoke it at each point. `pre-*` hooks BLOCK on non-zero exit (pause the pipeline); `post-*` / `phase-*` hooks WARN only. Registry lives at `.tiki/hooks/hooks.json` (all sample hooks ship **disabled**). See [docs/HOOKS.md](docs/HOOKS.md) for the full contract.

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md) - Full architecture (773 lines)
- [docs/HOOKS.md](docs/HOOKS.md) - Lifecycle hook system (registry, env vars, block-vs-warn policy)
- [docs/PLANNING-NOTES.md](docs/PLANNING-NOTES.md) - Planning context and decisions
- [docs/ENHANCEMENT-IDEAS.md](docs/ENHANCEMENT-IDEAS.md) - Backlog of small/medium enhancements (E1–E48)
- [CHANGELOG.md](CHANGELOG.md) - Human-readable release history
