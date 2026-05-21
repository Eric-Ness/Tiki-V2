# Lifecycle Hooks

Tiki can run user-supplied shell scripts at fixed points in the issue
workflow. Hooks are the project's primary extensibility mechanism (alongside
custom commands) and let you wire in notifications, deployments, metrics, or
gating checks without modifying the framework.

Hooks are **opt-in and disabled by default**. A project with no
`.tiki/hooks/hooks.json` — or with every hook left `"enabled": false` — runs
the pipeline exactly as if hooks did not exist.

## Where hooks live

```text
.tiki/hooks/
├── hooks.json          # Registry — which hooks are enabled and what runs them
├── pre-execute.sh      # \ one script (or .ps1) per hook point you want to use
├── post-execute.sh     #  > only the ones referenced by an enabled registry
├── phase-start.sh      #  > entry need to exist; the rest can be omitted
├── phase-complete.sh   # /
├── pre-ship.sh
├── post-ship.sh
└── post-ship.ps1       # optional Windows variant (preferred over .sh on win32)
```

## The registry: `hooks.json`

```json
{
  "hooks": {
    "pre-execute":    { "script": "pre-execute.sh",    "enabled": false },
    "post-execute":   { "script": "post-execute.sh",   "enabled": false },
    "phase-start":    { "script": "phase-start.sh",     "enabled": false },
    "phase-complete": { "script": "phase-complete.sh",  "enabled": false },
    "pre-ship":       { "script": "pre-ship.sh",        "enabled": false },
    "post-ship":      { "script": "post-ship.sh",       "enabled": false }
  }
}
```

Each entry has:

- `script` — the file under `.tiki/hooks/` to run. Optional; if omitted the
  runner falls back to `<hook-name>.{ps1|sh}`. The extension in `script` is
  advisory — the runner picks the platform-preferred sibling regardless (see
  [Script resolution](#script-resolution)).
- `enabled` — must be **exactly `true`** to fire. Any other value (`false`,
  missing, a string, etc.) means the hook is a no-op.

If `hooks.json` is missing, unparseable, or the requested hook is not listed,
the runner prints nothing and exits 0. A misconfigured registry never crashes
the pipeline.

## The six hook points

| Hook             | Fires …                                   | Env vars |
|------------------|-------------------------------------------|----------|
| `pre-execute`    | once, before the first phase of EXECUTE   | `TIKI_ISSUE`, `TIKI_TITLE`, `TIKI_TOTAL_PHASES` |
| `post-execute`   | once, after all phases of EXECUTE finish  | `TIKI_ISSUE`, `TIKI_PHASES_COMPLETED` |
| `phase-start`    | before each phase begins                  | `TIKI_ISSUE`, `TIKI_PHASE`, `TIKI_PHASE_TITLE` |
| `phase-complete` | after each phase returns                  | `TIKI_ISSUE`, `TIKI_PHASE`, `TIKI_PHASE_STATUS` |
| `pre-ship`       | before commit/push in SHIP                | `TIKI_ISSUE`, `TIKI_TITLE` |
| `post-ship`      | after a successful push in SHIP           | `TIKI_ISSUE`, `TIKI_COMMIT_SHA` |

The `EXECUTE` step (`/tiki:execute`, also via `/tiki:yolo` and `/tiki:release`)
fires `pre-execute` → (`phase-start` → `phase-complete`)×N → `post-execute`.
The `SHIP` step fires `pre-ship` before the commit and `post-ship` after the
push. All env vars are passed in addition to the inherited process
environment, so your script also sees `PATH`, `HOME`, etc.

## How hooks run

Command prose invokes the runner; you never call it directly:

```bash
node packages/framework/scripts/run-hook.mjs <hook-name> \
  [--env KEY=VALUE ...] [--tiki-path P] [--debug]
```

- `<hook-name>` is one of the six names above.
- `--env KEY=VALUE` may repeat; each pair is injected into the child process
  env (split on the first `=`, so values may contain `=`).
- `--tiki-path` overrides the `.tiki` location. By default the runner resolves
  `.tiki` the same way the state shim does: it walks up to the nearest `.git`,
  and from a git worktree it points back at the **main** repo's `.tiki`. This
  keeps hook config in one place even when sub-agents run in worktrees.
- `--debug` prints a one-line trace to stderr for skipped/absent/disabled
  hooks.

## Script resolution

For a given hook the runner picks the script file like this:

1. Compute the base name from the registry `script` field (extension
   stripped), or `<hook-name>` if `script` is omitted.
2. On **Windows** (`process.platform === 'win32'`): prefer `<base>.ps1` if it
   exists, run it via
   `powershell -NoProfile -ExecutionPolicy Bypass -File <path>`. Otherwise
   fall back to `<base>.sh` run via `bash` (Git Bash).
3. On **macOS / Linux**: run `<base>.sh` via `bash`. (A `.ps1` is ignored —
   it is not runnable there.)

So you can ship both a `.sh` and a `.ps1` for the same hook and the right one
runs on each platform. If an enabled hook has no runnable script on disk, the
runner prints a warning and exits 0 (a config typo never wedges the pipeline).

## Failure policy: block vs warn

The hook's **name prefix** decides what a non-zero exit means:

- **`pre-*` hooks are BLOCKING.** If `pre-execute` or `pre-ship` exits
  non-zero, the runner exits with that non-zero code. The command then
  **PAUSES the pipeline** (sets the work item's `status` to `"paused"`,
  leaving `pipelineStep` where it was) and stops before doing the gated action
  (running phases / committing). Use this to gate work on a precondition —
  e.g. fail `pre-ship` if a lint or license check fails.
- **All other hooks (`post-*`, `phase-*`) are WARN-only.** A non-zero exit
  prints a warning to stderr and the runner still exits 0, so the pipeline
  continues. The gated action has already happened (e.g. the code is pushed
  before `post-ship` runs), so a failing notification should not undo it.

A hook that is disabled, absent, or has no script always exits 0.

## Worked example: Slack notification on ship

`.tiki/hooks/hooks.json`:

```json
{
  "hooks": {
    "post-ship": { "script": "post-ship.sh", "enabled": true }
  }
}
```

`.tiki/hooks/post-ship.sh`:

```bash
#!/bin/bash
# Posts to Slack after an issue ships. Non-blocking: if curl fails the ship
# still succeeds (post-ship is WARN-only).
curl -sf -X POST "$SLACK_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"text\":\"Shipped issue #${TIKI_ISSUE} (commit ${TIKI_COMMIT_SHA})\"}"
```

On Windows, add a `post-ship.ps1` next to it and the runner will prefer it.

## Worked example: gate ship on a clean working tree (blocking)

`.tiki/hooks/pre-ship.sh`:

```bash
#!/bin/bash
# Refuse to ship if there are unrelated staged changes. Exiting non-zero
# BLOCKS the ship (pre-* hooks are blocking).
if ! git diff --cached --quiet -- ':!src/'; then
  echo "pre-ship: staged changes outside src/ — aborting ship for issue #${TIKI_ISSUE}" >&2
  exit 1
fi
```

When this exits 1, `/tiki:ship` pauses the work item and does not commit.

## Testing your hooks

You can drive the runner by hand against a scratch `.tiki`:

```bash
node packages/framework/scripts/run-hook.mjs post-ship \
  --tiki-path /path/to/.tiki \
  --env TIKI_ISSUE=42 --env TIKI_COMMIT_SHA=deadbeef --debug
```

The runner itself is covered by
`packages/framework/__tests__/run-hook.test.mjs` (registry/disabled/absent
handling, env injection, and the block-vs-warn policy).
