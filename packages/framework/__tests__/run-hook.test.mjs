/**
 * Tests for packages/framework/scripts/run-hook.mjs — the lifecycle hook
 * runner introduced by issue #215.
 *
 * Uses Node's built-in `node:test` runner so this package needs zero test
 * devDependencies (the Windows pnpm reparse-point block documented in
 * CLAUDE.md makes adding devDeps painful; node:test sidesteps it).
 *
 * Run with:
 *   pnpm -C packages/framework test
 *   # or directly:
 *   node --test packages/framework/__tests__/
 *
 * OS tolerance: the env-injection / failure-policy tests need a real shell to
 * execute a tiny hook script. On a host where neither bash nor PowerShell is
 * available we skip those cases and still assert the registry/resolution logic
 * that needs no shell. On Windows we prefer a `.ps1`; elsewhere a `.sh`.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUN_HOOK = path.resolve(__dirname, "..", "scripts", "run-hook.mjs");

const isWin = process.platform === "win32";

// ---------------------------------------------------------------------------
// Shell availability probes — decide which hook flavor we can actually run.
// ---------------------------------------------------------------------------

function hasBash() {
  try {
    const r = spawnSync("bash", ["-c", "exit 0"], { encoding: "utf-8" });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

function hasPowerShell() {
  if (!isWin) return false;
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", "exit 0"],
      { encoding: "utf-8" }
    );
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

const BASH_OK = hasBash();
const PS_OK = hasPowerShell();
// We can run a shell hook at all if at least one runner exists for this host.
const CAN_RUN_HOOK = isWin ? PS_OK || BASH_OK : BASH_OK;

// ---------------------------------------------------------------------------
// Temp-dir helpers (same pattern as state.test.mjs).
// ---------------------------------------------------------------------------

const tmpDirs = [];

async function makeTmpDir(prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const real = await fsp.realpath(dir);
  tmpDirs.push(real);
  return real;
}

/**
 * Lay out a `.tiki/hooks/` directory inside a fresh tmp dir.
 * Returns the tikiPath (the `.tiki` dir).
 */
async function makeTikiHooks(prefix) {
  const root = await makeTmpDir(prefix);
  const tikiPath = path.join(root, ".tiki");
  const hooksDir = path.join(tikiPath, "hooks");
  await fsp.mkdir(hooksDir, { recursive: true });
  return { root, tikiPath, hooksDir };
}

async function writeRegistry(hooksDir, hooks) {
  await fsp.writeFile(
    path.join(hooksDir, "hooks.json"),
    JSON.stringify({ hooks }, null, 2),
    "utf-8"
  );
}

/**
 * Write a hook script (one or both flavors) that echoes selected env vars,
 * one per line, into `outFile`, then exits with `exitCode`.
 *
 * Returns the registry `script` basename to reference (e.g. "pre-execute.sh").
 * We always name the registry entry with the `.sh` basename — the runner's
 * resolver picks the platform-preferred sibling, so on Windows the matching
 * `.ps1` is selected automatically.
 */
async function writeEnvDumpHook(hooksDir, hookName, envKeys, outFile, exitCode = 0) {
  if (BASH_OK || !isWin) {
    const lines = envKeys.map((k) => `echo "${k}=$${k}" >> "${outFile.replace(/\\/g, "/")}"`);
    const sh =
      `#!/bin/bash\n` +
      lines.join("\n") +
      `\n` +
      `exit ${exitCode}\n`;
    await fsp.writeFile(path.join(hooksDir, `${hookName}.sh`), sh, "utf-8");
  }
  if (isWin && PS_OK) {
    const psOut = outFile.replace(/'/g, "''");
    const lines = envKeys.map(
      (k) => `Add-Content -LiteralPath '${psOut}' -Value ("${k}=" + $env:${k})`
    );
    const ps =
      lines.join("\n") +
      `\n` +
      `exit ${exitCode}\n`;
    await fsp.writeFile(path.join(hooksDir, `${hookName}.ps1`), ps, "utf-8");
  }
  return `${hookName}.sh`;
}

function runRunner(hookName, extraArgs, tikiPath) {
  return spawnSync(
    process.execPath,
    [RUN_HOOK, hookName, "--tiki-path", tikiPath, ...extraArgs],
    { encoding: "utf-8" }
  );
}

after(async () => {
  for (const dir of tmpDirs) {
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

// ---------------------------------------------------------------------------
// Registry / resolution logic — no shell required, runs on every host.
// ---------------------------------------------------------------------------

test("missing registry → exit 0, nothing run", async () => {
  const { tikiPath } = await makeTikiHooks("hook-no-registry");
  // No hooks.json written.
  const r = runRunner("pre-execute", [], tikiPath);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
});

test("disabled hook → exit 0, not executed", async () => {
  const { tikiPath, hooksDir } = await makeTikiHooks("hook-disabled");
  await writeRegistry(hooksDir, {
    "post-ship": { script: "post-ship.sh", enabled: false },
  });
  const outFile = path.join(hooksDir, "ran.txt");
  // Write a hook that WOULD create a sentinel file if it ever ran.
  await writeEnvDumpHook(hooksDir, "post-ship", ["TIKI_ISSUE"], outFile, 0);

  const r = runRunner("post-ship", ["--env", "TIKI_ISSUE=42"], tikiPath);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
  assert.equal(
    fs.existsSync(outFile),
    false,
    "disabled hook must NOT execute (sentinel file should not exist)"
  );
});

test("hook absent from registry → exit 0", async () => {
  const { tikiPath, hooksDir } = await makeTikiHooks("hook-absent-entry");
  await writeRegistry(hooksDir, {
    "post-ship": { script: "post-ship.sh", enabled: true },
  });
  // Ask for a different hook that isn't listed.
  const r = runRunner("pre-execute", ["--env", "TIKI_ISSUE=42"], tikiPath);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
});

test("unknown hook name → exit 1 (bad argument)", async () => {
  const { tikiPath } = await makeTikiHooks("hook-unknown-name");
  const r = runRunner("not-a-hook", [], tikiPath);
  assert.equal(r.status, 1, `expected exit 1 for unknown hook, got ${r.status}`);
  assert.match(r.stderr, /unknown hook/i);
});

test("enabled hook but no script on disk → exit 0 with warning", async () => {
  const { tikiPath, hooksDir } = await makeTikiHooks("hook-missing-script");
  await writeRegistry(hooksDir, {
    "pre-ship": { script: "pre-ship.sh", enabled: true },
  });
  // Deliberately do NOT create pre-ship.sh / pre-ship.ps1.
  const r = runRunner("pre-ship", ["--env", "TIKI_ISSUE=42"], tikiPath);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
  assert.match(r.stderr, /no script was found/i);
});

test("malformed --env pair → exit 1", async () => {
  const { tikiPath, hooksDir } = await makeTikiHooks("hook-bad-env");
  await writeRegistry(hooksDir, {
    "post-ship": { script: "post-ship.sh", enabled: true },
  });
  await writeEnvDumpHook(
    hooksDir,
    "post-ship",
    ["TIKI_ISSUE"],
    path.join(hooksDir, "out.txt"),
    0
  );
  const r = runRunner("post-ship", ["--env", "NOEQUALS"], tikiPath);
  assert.equal(r.status, 1, `expected exit 1 for malformed --env, got ${r.status}`);
  assert.match(r.stderr, /KEY=VALUE/);
});

// ---------------------------------------------------------------------------
// Execution / failure-policy tests — need a shell. Skipped if none available.
// ---------------------------------------------------------------------------

test(
  "enabled hook receives injected env vars",
  { skip: CAN_RUN_HOOK ? false : "no bash/powershell available" },
  async () => {
    const { tikiPath, hooksDir } = await makeTikiHooks("hook-env-inject");
    await writeRegistry(hooksDir, {
      "post-ship": { script: "post-ship.sh", enabled: true },
    });
    const outFile = path.join(hooksDir, "env-dump.txt");
    await writeEnvDumpHook(
      hooksDir,
      "post-ship",
      ["TIKI_ISSUE", "TIKI_COMMIT_SHA"],
      outFile,
      0
    );

    const r = runRunner(
      "post-ship",
      ["--env", "TIKI_ISSUE=215", "--env", "TIKI_COMMIT_SHA=abc123"],
      tikiPath
    );
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);

    const dump = await fsp.readFile(outFile, "utf-8");
    assert.match(dump, /TIKI_ISSUE=215/, `env dump missing TIKI_ISSUE; got:\n${dump}`);
    assert.match(
      dump,
      /TIKI_COMMIT_SHA=abc123/,
      `env dump missing TIKI_COMMIT_SHA; got:\n${dump}`
    );
  }
);

test(
  "pre-* hook non-zero exit → runner exits non-zero (BLOCK)",
  { skip: CAN_RUN_HOOK ? false : "no bash/powershell available" },
  async () => {
    const { tikiPath, hooksDir } = await makeTikiHooks("hook-pre-block");
    await writeRegistry(hooksDir, {
      "pre-execute": { script: "pre-execute.sh", enabled: true },
    });
    await writeEnvDumpHook(
      hooksDir,
      "pre-execute",
      ["TIKI_ISSUE"],
      path.join(hooksDir, "pre-out.txt"),
      7 // non-zero
    );

    const r = runRunner("pre-execute", ["--env", "TIKI_ISSUE=215"], tikiPath);
    assert.notEqual(r.status, 0, "blocking pre-* hook should make runner exit non-zero");
    assert.match(r.stderr, /BLOCKING/i);
  }
);

test(
  "post-* hook non-zero exit → runner exits 0 with warning (WARN)",
  { skip: CAN_RUN_HOOK ? false : "no bash/powershell available" },
  async () => {
    const { tikiPath, hooksDir } = await makeTikiHooks("hook-post-warn");
    await writeRegistry(hooksDir, {
      "post-ship": { script: "post-ship.sh", enabled: true },
    });
    await writeEnvDumpHook(
      hooksDir,
      "post-ship",
      ["TIKI_ISSUE"],
      path.join(hooksDir, "post-out.txt"),
      9 // non-zero
    );

    const r = runRunner("post-ship", ["--env", "TIKI_ISSUE=215"], tikiPath);
    assert.equal(
      r.status,
      0,
      `non-blocking post-* hook should exit 0 even on child failure; got ${r.status}`
    );
    assert.match(r.stderr, /WARNING/i);
  }
);

// ---------------------------------------------------------------------------
// Unit test for the script resolver (no spawn).
// ---------------------------------------------------------------------------

test("resolveHookScript prefers .ps1 on win32, .sh elsewhere", async () => {
  const { resolveHookScript } = await import("../scripts/run-hook.mjs");
  const { hooksDir } = await makeTikiHooks("hook-resolve");

  // Create both flavors.
  await fsp.writeFile(path.join(hooksDir, "post-ship.sh"), "exit 0\n", "utf-8");
  await fsp.writeFile(path.join(hooksDir, "post-ship.ps1"), "exit 0\n", "utf-8");

  const resolved = resolveHookScript(hooksDir, "post-ship", "post-ship.sh");
  assert.ok(resolved, "should resolve a script when both flavors exist");
  if (isWin) {
    assert.equal(resolved.runner, "powershell");
    assert.match(resolved.file, /\.ps1$/);
  } else {
    assert.equal(resolved.runner, "bash");
    assert.match(resolved.file, /\.sh$/);
  }
});

test("resolveHookScript falls back to <hook-name>.sh when registry script omitted", async () => {
  const { resolveHookScript } = await import("../scripts/run-hook.mjs");
  const { hooksDir } = await makeTikiHooks("hook-resolve-fallback");
  await fsp.writeFile(path.join(hooksDir, "phase-start.sh"), "exit 0\n", "utf-8");

  const resolved = resolveHookScript(hooksDir, "phase-start", undefined);
  // On non-Windows this resolves the .sh; on Windows (with only a .sh present)
  // the resolver still finds the .sh as the second candidate.
  assert.ok(resolved, "should fall back to <hook-name>.sh");
  assert.match(resolved.file, /phase-start\.sh$/);
});
