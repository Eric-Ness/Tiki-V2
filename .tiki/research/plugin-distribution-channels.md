---
topic: plugin-distribution-channels
tags: [plugin, distribution, hooks, doctor, install]
issues: [268]
created: 2026-06-13T00:25:00Z
---

# Plugin distribution channels — mechanics and constraints

Findings from #268 REVIEW (verified against code 2026-06-13).

## The two channels

| | Copy-install (desktop / dogfood) | Plugin (`/plugin install tiki@Eric-Ness/Tiki-V2`) |
|---|---|---|
| Commands | `install.js` copies `commands/*.md` → `.claude/commands/tiki/` | Served from plugin; namespaced `/tiki:*`; **nothing lands in the project** |
| Scripts | `install.js` copies `scripts/*.mjs` → `.claude/tiki/scripts/` | Ship at `${CLAUDE_PLUGIN_ROOT}/scripts/`; **`.claude/tiki/scripts/` does not exist** |
| Reconciler hook | `ensureReconcilerHook()` writes Stop/SubagentStop into `.claude/settings.json` (project-relative command) | `hooks/hooks.json` via `plugin.json` `"hooks"` key, command uses `${CLAUDE_PLUGIN_ROOT}` |
| `.framework-version` | `install.js` stamps `.tiki/.framework-version` from plugin.json version | **never stamped** |

Canonical scripts (4): `state.mjs`, `reconcile-state.mjs`, `run-hook.mjs`, `mark-audited.mjs`.

## Hard constraints (from #251 red-team, re-confirmed)

- `${CLAUDE_PLUGIN_ROOT}` expands **only in hook commands** (hooks.json / settings.json hooks), never in slash-command markdown bodies. Command bodies therefore *must* reference a project-relative path → `.claude/tiki/scripts/` is the only universal target.
- `$CLAUDE_PLUGIN_ROOT` *is* present as an env var inside the Bash tool during command execution, so a shell-guard fallback in command bodies is technically possible — but it bloats every invocation site (~25 sites across 8 commands) and Windows/PowerShell vs bash quoting makes it fragile. SessionStart copy is the cleaner fix.
- Plugin hooks.json supports the same event set as settings hooks; `SessionStart` is a standard event (fires on session startup; supports `async` per current Claude Code).

## SessionStart copy-script design considerations (#268 Fix A)

- **Hook fires in every project the user opens with the plugin enabled**, not just Tiki projects. Decision needed on scope:
  - Copying scripts into `.claude/tiki/scripts/` unconditionally is cheap (4 small files) and `.claude/` is Claude-domain — acceptable.
  - **Never create `.tiki/`** as a side effect (would pollute non-Tiki projects). Only stamp `.framework-version` when `.tiki/` already exists.
- **Idempotency / staleness**: skip copy when installed scripts already match the plugin version. Simplest robust check: compare a version marker (e.g. `.claude/tiki/scripts/.version` or `.tiki/.framework-version`) against plugin.json version; or always byte-compare (4 files, trivial). Must not fight `install.js` copies (desktop channel writes the same target — last writer wins is fine since both copy from same canonical source at same version).
- The copy script itself must live in the plugin (`scripts/` so it ships) and be invoked as `node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs"` from hooks.json. It can locate the plugin root via its own `import.meta.url` (no env needed inside the script).
- Hook cwd = project dir (same assumption the reconciler hook already relies on).

## tiki_doctor / Diagnostics mirrors (#268 Fix B touches 3 places)

1. Rust: `DiagnosticsReport` struct (`apps/desktop/src-tauri/src/state.rs:638-672`), populated by `tiki_doctor` (`commands.rs:856-932`).
2. TS mirror: `apps/desktop/src/utils/diagnosticsSummary.ts` — **local mirror, documented as such**; field-name drift = silent `undefined`.
3. Panel: `apps/desktop/src/components/settings/DiagnosticsPanel.tsx` renders `diagnosticsSummary()` findings (warn/info/pass).

Subtlety found in REVIEW: `reconciler_hook_installed` only inspects `.claude/settings.json` — on a plugin-only install it reports `false` even though the plugin's hooks.json delivers the reconciler. After Fix A this stays misleading (warn that isn't actionable). The unresolved-script-paths check should be designed so the *script* check is the authoritative install-health signal; consider rewording/qualifying the hook finding for the plugin case (doctor cannot see plugin config).

Doctor check shape: parsing installed `.claude/commands/tiki/*.md` for `node <path>.mjs` works on copy-installs but **plugin-only projects have no installed command files to parse** — the check must ALWAYS also verify the canonical required-scripts list exists at `.claude/tiki/scripts/` (the path command bodies hardcode), independent of command-file presence.

## 2026-06-13 findings (#268 PLAN decisions)

- **Bootstrap script does NOT write `.claude/settings.json`.** Considered having SessionStart also run `ensureReconcilerHook` so both channels converge to identical project layouts — rejected: writing settings.json in *every* project the user ever opens is too invasive, and the plugin's hooks.json already delivers the reconciler (double delivery would be harmless via the lenient lock, but unnecessary). Revisit only if plugin-hook delivery proves unreliable.
- **Channel detection heuristic for the doctor:** `copyInstallDetected = .claude/commands/tiki/ exists`. Used by `diagnosticsSummary` to downgrade the "reconciler hook not installed" finding from WARN to INFO on plugin-only installs (doctor cannot inspect plugin config; a permanent false warning is worse than an info note). The `unresolvedScriptPaths` check is the authoritative install-health signal.
- **Bootstrap idempotency marker:** `.claude/tiki/scripts/.version` (inside the target dir, not `.tiki/` — must work in projects with no `.tiki/`). `.tiki/.framework-version` is stamped only when `.tiki/` already exists.
- **SessionStart hooks must exit 0 even when degraded** — a failing SessionStart breaks every session in every project; warn to stderr instead.

## Test landscape

- `__tests__/plugin-distribution.test.mjs` — manifest/hooks well-formed; dogfood script copies match canonical; commands don't reference monorepo paths. **Nothing models a plugin-only layout or executes anything.**
- `__tests__/commands-sync.test.mjs` — dogfood command mirrors byte-identical.
- Behavioral-test recipe for Fix C: temp dir with `.git/` + commands referencing `.claude/tiki/scripts/`, NO scripts dir → run the SessionStart copy script with the plugin layout as source → then actually `node .claude/tiki/scripts/state.mjs transition issue:1 ...` from that cwd and assert `state.json` `activeWork` gains the entry. Node test runner conventions: see `state.test.mjs` (spawns the real CLI via `execFileSync`).
