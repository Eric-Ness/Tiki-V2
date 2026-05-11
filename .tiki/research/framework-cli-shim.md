---
topic: framework-cli-shim
tags: [framework, cli, node, bash]
issues: [144]
created: 2026-05-11T01:00:00.000Z
---

# Framework CLI Shim

## Why It's Required

Claude Code drives the Tiki framework via **bash commands**. It cannot invoke
Tauri IPC directly — the desktop app is a separate process. So a new Rust IPC
alone doesn't solve issue #144. We need a Node CLI shim that:

1. Lives in `packages/framework/scripts/state.mjs`.
2. Is invocable from any working directory via `node <repo>/packages/framework/scripts/state.mjs transition <work-id> --to-status executing ...`.
3. Reads/writes `.tiki/state.json` in the **current working directory** (or a path passed via `--tiki-path`).
4. Performs the same validations the Rust IPC does (legal transitions, parentRelease preservation, lastActivity bumping).

## Output Format

The shim writes the canonical JSON shape exactly — same field names, same
camelCase, same atomic-write pattern (`.tmp` sibling, then rename). This
keeps the desktop app's file watcher happy and prevents readers from seeing
partial JSON.

## CLI Surface (minimal)

```
node state.mjs transition <work-id> --to-status <status> [--to-step <step>]
    [--phase-current N --phase-total T --phase-status <status>]
    [--parent-release <version>]
    [--issue-number N --issue-title "..."]
    [--release-version V --release-issues "1,2,3"]
    [--tiki-path <path>]
```

Exit codes:
- `0` — success, prints updated entry as JSON to stdout.
- `1` — validation error (illegal transition, missing required field, etc.).
- `2` — I/O error (state.json unreadable, write failed).

## Why JavaScript and Not Shell

- Shell-based state mutation requires `jq`, which is not universally installed on Windows.
- Node ships with Tiki's monorepo already; `pnpm install` makes it available.
- JSON manipulation in Node is trivial and atomic via fs.renameSync.

## Invocation From Framework Commands

The shim path is resolved relative to the framework package install. The
simplest pattern is to require callers to know the path:

```bash
# From within a project that has Tiki framework installed:
node ./node_modules/@tiki/framework/scripts/state.mjs transition issue:42 \
  --to-status executing --to-step EXECUTE \
  --phase-current 1 --phase-total 3 --phase-status executing
```

But in practice, the framework prose can keep using the legacy path: write
the JSON directly. The shim is an OPTIONAL convenience. This is the
backward-compatibility hatch — see `state-transition-ipc.md`.

## Files It Touches

- Reads: `<tiki-path>/state.json`
- Writes: `<tiki-path>/state.json.tmp` → `<tiki-path>/state.json` (atomic rename)
- Never touches: plan files, release files, history (those have their own commands).
