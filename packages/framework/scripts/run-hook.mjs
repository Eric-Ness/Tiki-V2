#!/usr/bin/env node
/**
 * Tiki lifecycle hook runner.
 *
 * Framework command prose (execute.md, ship.md) fires lifecycle hooks by
 * shelling out to this script rather than by inlining shell snippets. Keeping
 * the runner in one place makes the hook contract testable (see
 * __tests__/run-hook.test.mjs) and gives us a single home for the
 * .ps1-vs-.sh resolution and block-vs-warn failure policy.
 *
 * It is the lifecycle-hook counterpart to the state.mjs shim and deliberately
 * mirrors its conventions: a tiny built-ins-only arg parser, a worktree-aware
 * `resolveTikiPath()`, `--tiki-path` override, and the same exit-code grammar.
 * Like state.mjs it depends on ZERO third-party packages (the Windows pnpm
 * reparse-point block documented in CLAUDE.md makes adding deps painful).
 *
 * Hook points + env vars (from docs/DESIGN.md and docs/HOOKS.md):
 *
 *   | Hook           | Env vars                                          |
 *   |----------------|---------------------------------------------------|
 *   | pre-execute    | TIKI_ISSUE, TIKI_TITLE, TIKI_TOTAL_PHASES         |
 *   | post-execute   | TIKI_ISSUE, TIKI_PHASES_COMPLETED                 |
 *   | phase-start    | TIKI_ISSUE, TIKI_PHASE, TIKI_PHASE_TITLE          |
 *   | phase-complete | TIKI_ISSUE, TIKI_PHASE, TIKI_PHASE_STATUS         |
 *   | pre-ship       | TIKI_ISSUE, TIKI_TITLE                            |
 *   | post-ship      | TIKI_ISSUE, TIKI_COMMIT_SHA                       |
 *
 * Usage:
 *
 *   node run-hook.mjs <hook-name> [--env KEY=VALUE ...] [--tiki-path P] [--debug]
 *
 * The registry lives at `.tiki/hooks/hooks.json`:
 *
 *   {
 *     "hooks": {
 *       "pre-execute": { "script": "pre-execute.sh", "enabled": false },
 *       "post-ship":   { "script": "post-ship.sh",   "enabled": true  }
 *     }
 *   }
 *
 * Resolution:
 *   - If the registry file is missing, the hook is absent, or its `enabled`
 *     field is not exactly `true`, the runner prints nothing (or a --debug
 *     line) and exits 0. A disabled hook is a no-op.
 *   - The hook script is located under `.tiki/hooks/`. The `script` field from
 *     the registry names the file; if absent it falls back to
 *     `<hook-name>.{ps1|sh}`.
 *   - On Windows (`process.platform === 'win32'`) a `.ps1` is preferred when it
 *     exists (run via `powershell -NoProfile -ExecutionPolicy Bypass -File`).
 *     Otherwise a `.sh` is run via `bash` (Git Bash). On non-Windows the `.sh`
 *     is always run via `bash`.
 *
 * Failure policy (block vs warn):
 *   - Hooks whose name starts with `pre-` are BLOCKING: a non-zero child exit
 *     propagates as the runner's exit code, which PAUSES the pipeline.
 *   - All other hooks (post-*, phase-*) are WARN-only: a non-zero child exit
 *     prints a warning to stderr and the runner still exits 0.
 *
 * Exit codes:
 *   0  hook ran successfully, was disabled/absent, or a non-blocking hook
 *      failed (warn only)
 *   1  a blocking (pre-*) hook exited non-zero (the child's code, or 1 if the
 *      child could not be spawned), OR a bad-argument / I/O error in the runner
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The canonical set of lifecycle hook names. Used for validation and for the
// default-script fallback. Mirrors docs/DESIGN.md's hook table.
const KNOWN_HOOKS = new Set([
  "pre-execute",
  "post-execute",
  "phase-start",
  "phase-complete",
  "pre-ship",
  "post-ship",
]);

// ---------------------------------------------------------------------------
// Tiny arg parser. Same shape as state.mjs, but `--env` repeats so it
// accumulates into an array instead of being overwritten.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [], env: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--env") {
      const next = argv[i + 1];
      if (next === undefined) {
        die(1, "--env requires a KEY=VALUE argument");
      }
      args.env.push(next);
      i++;
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function die(code, msg) {
  process.stderr.write(`run-hook.mjs: ${msg}\n`);
  process.exit(code);
}

function debugLog(enabled, msg) {
  if (enabled) {
    process.stderr.write(`run-hook.mjs: ${msg}\n`);
  }
}

// ---------------------------------------------------------------------------
// Worktree-aware .tiki resolution. Identical algorithm to state.mjs's
// resolveTikiPath so a hook fired from a worktree CWD reads the main repo's
// registry, matching where state.json lives.
// ---------------------------------------------------------------------------

function resolveTikiPath(override) {
  if (override) return path.resolve(override);

  const cwd = process.cwd();
  const naive = path.join(cwd, ".tiki");

  let dir = cwd;
  let resolved = null;
  while (true) {
    const gitEntry = path.join(dir, ".git");
    if (fs.existsSync(gitEntry)) {
      let stat;
      try {
        stat = fs.statSync(gitEntry);
      } catch {
        stat = null;
      }
      if (stat && stat.isDirectory()) {
        resolved = path.join(dir, ".tiki");
      } else if (stat && stat.isFile()) {
        try {
          const content = fs.readFileSync(gitEntry, "utf-8");
          const firstLine = content.split(/\r?\n/, 1)[0] || "";
          const match = firstLine.match(/^gitdir:\s*(.+)$/);
          if (match) {
            const gitDirPath = match[1].trim();
            const worktreesIdx = gitDirPath.search(/[\\/]worktrees[\\/]/);
            if (worktreesIdx !== -1) {
              const mainGitDir = gitDirPath.slice(0, worktreesIdx);
              const mainRepoRoot = path.dirname(mainGitDir);
              resolved = path.join(mainRepoRoot, ".tiki");
            } else {
              resolved = path.join(dir, ".tiki");
            }
          } else {
            resolved = path.join(dir, ".tiki");
          }
        } catch {
          resolved = path.join(dir, ".tiki");
        }
      } else {
        resolved = path.join(dir, ".tiki");
      }
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  if (resolved === null) {
    return naive;
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Registry loading.
// ---------------------------------------------------------------------------

/**
 * Load `.tiki/hooks/hooks.json`. Returns `null` if the file is absent or
 * unparseable (treated the same as "no hooks configured" → no-op, exit 0).
 */
function loadRegistry(hooksDir, debug) {
  const registryFile = path.join(hooksDir, "hooks.json");
  if (!fs.existsSync(registryFile)) {
    debugLog(debug, `no registry at ${registryFile}`);
    return null;
  }
  let raw;
  try {
    raw = fs.readFileSync(registryFile, "utf-8");
  } catch (e) {
    debugLog(debug, `failed to read ${registryFile}: ${e.message}`);
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    // A malformed registry should not crash the pipeline — treat as no hooks.
    debugLog(debug, `registry is not valid JSON (${e.message}); treating as no hooks`);
    return null;
  }
}

/**
 * Resolve the on-disk hook script path for a hook entry.
 *
 * Preference order:
 *   - On win32: a `.ps1` (run via PowerShell) if it exists, else a `.sh`.
 *   - On other platforms: a `.sh` (run via bash).
 *
 * The base filename comes from the registry `script` field when present,
 * otherwise `<hook-name>.{ps1|sh}`. When the registry `script` already carries
 * an extension we try the platform-preferred sibling first, then the named
 * file itself, so a registry that lists `post-ship.sh` still picks up a
 * `post-ship.ps1` on Windows.
 *
 * Returns `{ file, runner }` or `null` if nothing runnable exists.
 *   runner: "powershell" | "bash"
 */
function resolveHookScript(hooksDir, hookName, scriptField) {
  const isWin = process.platform === "win32";

  // Build the ordered list of candidate basenames to try.
  const base = scriptField && typeof scriptField === "string"
    ? scriptField.replace(/\.(ps1|sh)$/i, "")
    : hookName;

  const ps1 = base + ".ps1";
  const sh = base + ".sh";

  // Also honor an exact registry filename if it had an extension we don't
  // otherwise generate (defensive; normally base+ext covers it).
  const exact = scriptField && typeof scriptField === "string" ? scriptField : null;

  const candidates = [];
  if (isWin) {
    candidates.push({ name: ps1, runner: "powershell" });
    candidates.push({ name: sh, runner: "bash" });
  } else {
    candidates.push({ name: sh, runner: "bash" });
    // A .ps1 on a non-Windows host is not runnable here; skip it.
  }
  if (exact && exact !== ps1 && exact !== sh) {
    const runner = /\.ps1$/i.test(exact) ? "powershell" : "bash";
    // Only consider a .ps1 exact match on Windows.
    if (!(runner === "powershell" && !isWin)) {
      candidates.push({ name: exact, runner });
    }
  }

  for (const cand of candidates) {
    const full = path.join(hooksDir, cand.name);
    if (fs.existsSync(full)) {
      return { file: full, runner: cand.runner };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Env injection.
// ---------------------------------------------------------------------------

/**
 * Parse `--env KEY=VALUE` pairs into an object. Splits on the FIRST `=` so
 * values may contain `=`. A pair with no `=` is an error.
 */
function parseEnvPairs(pairs) {
  const out = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) {
      die(1, `--env value '${pair}' is not in KEY=VALUE form`);
    }
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    if (!key) {
      die(1, `--env value '${pair}' has an empty key`);
    }
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const debug = args.debug === true;

  const hookName = args._[0];
  if (!hookName) {
    die(1, "missing <hook-name> argument (e.g. 'pre-execute', 'post-ship')");
  }
  if (!KNOWN_HOOKS.has(hookName)) {
    die(
      1,
      `unknown hook '${hookName}' (expected one of: ${[...KNOWN_HOOKS].join(", ")})`
    );
  }

  const isBlocking = hookName.startsWith("pre-");

  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const hooksDir = path.join(tikiPath, "hooks");

  const registry = loadRegistry(hooksDir, debug);
  if (!registry) {
    // No registry → nothing to run. Not an error.
    debugLog(debug, `hook '${hookName}' skipped: no registry`);
    process.exit(0);
  }

  const hooks = registry.hooks && typeof registry.hooks === "object" ? registry.hooks : {};
  const entry = hooks[hookName];

  if (!entry || typeof entry !== "object") {
    debugLog(debug, `hook '${hookName}' skipped: not present in registry`);
    process.exit(0);
  }

  if (entry.enabled !== true) {
    debugLog(debug, `hook '${hookName}' skipped: disabled`);
    process.exit(0);
  }

  const resolved = resolveHookScript(hooksDir, hookName, entry.script);
  if (!resolved) {
    // Enabled but no script on disk: warn, but do not block (a missing script
    // for an enabled hook is a config mistake, not a pipeline-stopping event
    // for post-* hooks; for pre-* hooks we still surface it but exit 0 so a
    // typo'd path doesn't wedge the pipeline — the warning makes it visible).
    process.stderr.write(
      `run-hook.mjs: hook '${hookName}' is enabled but no script was found in ${hooksDir} ` +
      `(looked for ${entry.script || hookName + ".{ps1|sh}"}). Skipping.\n`
    );
    process.exit(0);
  }

  // Build the child env: process.env overlaid with the injected pairs.
  const injected = parseEnvPairs(args.env);
  const childEnv = { ...process.env, ...injected };

  // Build the spawn invocation per runner.
  let command;
  let spawnArgs;
  if (resolved.runner === "powershell") {
    command = "powershell";
    spawnArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolved.file];
  } else {
    command = "bash";
    spawnArgs = [resolved.file];
  }

  debugLog(debug, `running hook '${hookName}' via ${command}: ${resolved.file}`);

  const result = spawnSync(command, spawnArgs, {
    env: childEnv,
    stdio: "inherit",
    encoding: "utf-8",
  });

  // spawnSync error (e.g. runner binary not found).
  if (result.error) {
    const msg =
      `run-hook.mjs: failed to launch ${command} for hook '${hookName}': ${result.error.message}`;
    if (isBlocking) {
      // A blocking hook that cannot even run should pause the pipeline.
      process.stderr.write(msg + "\n");
      process.exit(1);
    }
    // Non-blocking: warn and continue.
    process.stderr.write(msg + " (non-blocking — continuing)\n");
    process.exit(0);
  }

  const childCode = typeof result.status === "number" ? result.status : 1;

  if (childCode !== 0) {
    if (isBlocking) {
      process.stderr.write(
        `run-hook.mjs: BLOCKING hook '${hookName}' exited ${childCode}; pausing the pipeline.\n`
      );
      process.exit(childCode);
    }
    process.stderr.write(
      `run-hook.mjs: WARNING — hook '${hookName}' exited ${childCode} ` +
      `(non-blocking — continuing).\n`
    );
    process.exit(0);
  }

  debugLog(debug, `hook '${hookName}' completed successfully`);
  process.exit(0);
}

// Only run main() when invoked directly as a CLI, not when imported by tests.
const isCliEntry = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
    return entryFile !== null && path.resolve(thisFile) === entryFile;
  } catch {
    return false;
  }
})();

if (isCliEntry) {
  main();
}

// Named exports for test / programmatic use.
export { resolveTikiPath, resolveHookScript, parseEnvPairs, loadRegistry, KNOWN_HOOKS };
