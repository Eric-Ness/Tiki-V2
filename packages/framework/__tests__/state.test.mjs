/**
 * Tests for packages/framework/scripts/state.mjs — worktree-aware tikiPath
 * resolution.
 *
 * Uses Node 22's built-in `node:test` runner so this package needs zero
 * test devDependencies. (The Windows pnpm reparse-point block documented in
 * CLAUDE.md makes adding new devDeps painful; node:test sidesteps it.)
 *
 * Run with:
 *   pnpm -C packages/framework test
 *   # or directly:
 *   node --test packages/framework/__tests__/
 */

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveTikiPath } from "../scripts/state.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_SHIM = path.resolve(__dirname, "..", "scripts", "state.mjs");

// ---------------------------------------------------------------------------
// Shared tmp-dir helpers.
// ---------------------------------------------------------------------------

const tmpDirs = [];
const originalCwd = process.cwd();

async function makeTmpDir(prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  // realpath: on macOS / some Windows configs, mkdtemp returns a symlinked
  // path; normalize so equality checks line up with what resolveTikiPath
  // produces via path.join.
  const real = await fsp.realpath(dir);
  tmpDirs.push(real);
  return real;
}

after(async () => {
  // Restore CWD before cleanup so we don't try to rmdir our own pwd.
  try {
    process.chdir(originalCwd);
  } catch {
    /* ignore */
  }
  for (const dir of tmpDirs) {
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

afterEach(() => {
  // Each test sets its own CWD; reset between tests so cross-test pollution
  // can't mask bugs.
  try {
    process.chdir(originalCwd);
  } catch {
    /* ignore */
  }
});

// ---------------------------------------------------------------------------
// Unit tests for resolveTikiPath.
// ---------------------------------------------------------------------------

test("resolveTikiPath: normal repo root with .git directory", async () => {
  const repo = await makeTmpDir("tiki-test-repo");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  process.chdir(repo);

  const result = resolveTikiPath();
  assert.equal(path.resolve(result), path.resolve(path.join(repo, ".tiki")));
});

test("resolveTikiPath: walks up to ancestor with .git directory", async () => {
  const repo = await makeTmpDir("tiki-test-repo-deep");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  const sub = path.join(repo, "src", "a", "b");
  await fsp.mkdir(sub, { recursive: true });
  process.chdir(sub);

  const result = resolveTikiPath();
  assert.equal(path.resolve(result), path.resolve(path.join(repo, ".tiki")));
});

test("resolveTikiPath: worktree CWD with .git file points back to main repo", async () => {
  // Simulate the layout `git worktree add` produces:
  //   <mainRepo>/.git/                                     (main repo)
  //   <mainRepo>/.git/worktrees/<wtName>/                  (worktree metadata)
  //   <wtRoot>/.git                                        (file w/ gitdir:)
  const mainRepo = await makeTmpDir("tiki-test-main");
  const mainGitDir = path.join(mainRepo, ".git");
  await fsp.mkdir(path.join(mainGitDir, "worktrees", "wt-x"), { recursive: true });

  const wtRoot = await makeTmpDir("tiki-test-worktree");
  const gitdirPointer = path.join(mainGitDir, "worktrees", "wt-x");
  await fsp.writeFile(
    path.join(wtRoot, ".git"),
    `gitdir: ${gitdirPointer}\n`,
    "utf-8"
  );

  process.chdir(wtRoot);
  const result = resolveTikiPath();
  assert.equal(path.resolve(result), path.resolve(path.join(mainRepo, ".tiki")));
});

test("resolveTikiPath: worktree CWD with .git file using POSIX-style separators", async () => {
  // Even on Windows, the gitdir line uses forward slashes when git itself
  // wrote it. Make sure we cope with that.
  const mainRepo = await makeTmpDir("tiki-test-main-posix");
  const mainGitDir = path.join(mainRepo, ".git");
  await fsp.mkdir(path.join(mainGitDir, "worktrees", "wt-y"), { recursive: true });

  const wtRoot = await makeTmpDir("tiki-test-wt-posix");
  // Force forward slashes in the gitdir line:
  const gitdirPointer = path
    .join(mainGitDir, "worktrees", "wt-y")
    .replace(/\\/g, "/");
  await fsp.writeFile(
    path.join(wtRoot, ".git"),
    `gitdir: ${gitdirPointer}\n`,
    "utf-8"
  );

  process.chdir(wtRoot);
  const result = resolveTikiPath();
  assert.equal(path.resolve(result), path.resolve(path.join(mainRepo, ".tiki")));
});

test("resolveTikiPath: explicit --tiki-path override beats CWD inference", async () => {
  const repo = await makeTmpDir("tiki-test-override");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  process.chdir(repo);

  const custom = path.join(os.tmpdir(), "tiki-custom-override-target", ".tiki");
  const result = resolveTikiPath(custom);
  assert.equal(path.resolve(result), path.resolve(custom));
});

test("resolveTikiPath: non-repo CWD falls back to <cwd>/.tiki", async () => {
  // Pick a tmp dir with no .git anywhere above it that we control. The OS
  // tmpdir's ancestors should not contain a .git (it's typically under
  // C:\Users\<u>\AppData\Local\Temp on Windows or /tmp on POSIX). We make
  // sure by walking up and asserting no .git is found before we trust this.
  const tmp = await makeTmpDir("tiki-test-nonrepo");
  // Sanity check: confirm the walk would naturally find nothing.
  let dir = tmp;
  let foundGit = false;
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      foundGit = true;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (foundGit) {
    // Environment happens to have a .git somewhere above tmp (rare —
    // e.g., user put their tmpdir inside a repo). Skip rather than fail.
    return;
  }

  process.chdir(tmp);
  const result = resolveTikiPath();
  assert.equal(path.resolve(result), path.resolve(path.join(tmp, ".tiki")));
});

// ---------------------------------------------------------------------------
// Integration test: spawn the shim from a synthetic worktree CWD and assert
// the transition lands in the main repo's tmp .tiki/.
// ---------------------------------------------------------------------------

test("integration: shim invoked from worktree CWD writes to main repo .tiki/", async () => {
  // Build the fake main repo with its own .tiki dir.
  const mainRepo = await makeTmpDir("tiki-int-main");
  const mainGitDir = path.join(mainRepo, ".git");
  await fsp.mkdir(path.join(mainGitDir, "worktrees", "wt-int"), { recursive: true });
  await fsp.mkdir(path.join(mainRepo, ".tiki"), { recursive: true });

  // Build the worktree with a .git pointer file.
  const wtRoot = await makeTmpDir("tiki-int-wt");
  const gitdirPointer = path.join(mainGitDir, "worktrees", "wt-int");
  await fsp.writeFile(
    path.join(wtRoot, ".git"),
    `gitdir: ${gitdirPointer}\n`,
    "utf-8"
  );

  // Spawn the shim with the worktree as CWD.
  const result = spawnSync(
    process.execPath,
    [
      STATE_SHIM,
      "transition",
      "issue:9999",
      "--to-status",
      "pending",
      "--to-step",
      "GET",
      "--issue-number",
      "9999",
      "--issue-title",
      "integration test",
    ],
    {
      cwd: wtRoot,
      encoding: "utf-8",
    }
  );

  assert.equal(
    result.status,
    0,
    `shim exited non-zero: stdout=${result.stdout} stderr=${result.stderr}`
  );

  // Stderr should contain the auto-resolve diagnostic.
  assert.match(
    result.stderr,
    /resolved tikiPath from worktree to/,
    `expected auto-resolve message on stderr, got: ${JSON.stringify(result.stderr)}`
  );

  // State file should be in the MAIN repo, not the worktree.
  const mainState = path.join(mainRepo, ".tiki", "state.json");
  const wtState = path.join(wtRoot, ".tiki", "state.json");
  assert.equal(fs.existsSync(mainState), true, "main repo .tiki/state.json should exist");
  assert.equal(fs.existsSync(wtState), false, "worktree .tiki/state.json should NOT exist");

  const parsed = JSON.parse(await fsp.readFile(mainState, "utf-8"));
  assert.ok(parsed.activeWork, "state should have activeWork");
  assert.ok(parsed.activeWork["issue:9999"], "state should have issue:9999 entry");
  assert.equal(parsed.activeWork["issue:9999"].status, "pending");
  assert.equal(parsed.activeWork["issue:9999"].pipelineStep, "GET");
  assert.equal(parsed.activeWork["issue:9999"].issue.number, 9999);
  assert.equal(parsed.activeWork["issue:9999"].issue.title, "integration test");
});

test("integration: shim invoked from normal repo root writes to <repo>/.tiki/", async () => {
  // Build a normal repo (no worktree).
  const repo = await makeTmpDir("tiki-int-normal");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  await fsp.mkdir(path.join(repo, ".tiki"), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [
      STATE_SHIM,
      "transition",
      "issue:8888",
      "--to-status",
      "pending",
      "--to-step",
      "GET",
      "--issue-number",
      "8888",
      "--issue-title",
      "normal repo test",
    ],
    {
      cwd: repo,
      encoding: "utf-8",
    }
  );

  assert.equal(
    result.status,
    0,
    `shim exited non-zero: stdout=${result.stdout} stderr=${result.stderr}`
  );

  // CWD already IS the repo root, so the auto-resolve message should NOT
  // appear (resolved path equals naive <cwd>/.tiki).
  assert.doesNotMatch(
    result.stderr,
    /resolved tikiPath from worktree/,
    `unexpected auto-resolve message on stderr: ${JSON.stringify(result.stderr)}`
  );

  const stateFile = path.join(repo, ".tiki", "state.json");
  assert.equal(fs.existsSync(stateFile), true);
  const parsed = JSON.parse(await fsp.readFile(stateFile, "utf-8"));
  assert.equal(parsed.activeWork["issue:8888"].status, "pending");
});

test("integration: --tiki-path override wins over CWD-based resolution", async () => {
  // CWD will be a normal repo, but we'll pass --tiki-path to redirect to a
  // completely unrelated dir.
  const repo = await makeTmpDir("tiki-int-override-cwd");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  const overrideDir = await makeTmpDir("tiki-int-override-target");
  const overrideTiki = path.join(overrideDir, "custom-tiki");

  const result = spawnSync(
    process.execPath,
    [
      STATE_SHIM,
      "transition",
      "issue:7777",
      "--to-status",
      "pending",
      "--to-step",
      "GET",
      "--issue-number",
      "7777",
      "--issue-title",
      "override test",
      "--tiki-path",
      overrideTiki,
    ],
    {
      cwd: repo,
      encoding: "utf-8",
    }
  );

  assert.equal(
    result.status,
    0,
    `shim exited non-zero: stdout=${result.stdout} stderr=${result.stderr}`
  );

  // Override path: state should land in overrideTiki, NOT in repo/.tiki.
  const overrideState = path.join(overrideTiki, "state.json");
  const repoState = path.join(repo, ".tiki", "state.json");
  assert.equal(fs.existsSync(overrideState), true, "override .tiki should exist");
  assert.equal(fs.existsSync(repoState), false, "repo .tiki should NOT have been written");

  const parsed = JSON.parse(await fsp.readFile(overrideState, "utf-8"));
  assert.equal(parsed.activeWork["issue:7777"].status, "pending");
});
