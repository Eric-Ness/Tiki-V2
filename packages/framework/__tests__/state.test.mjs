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
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  resolveTikiPath,
  appendJournalEntry,
  readJournalEntries,
  journalFloor,
  pruneJournal,
  STEP_ORDER,
} from "../scripts/state.mjs";

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

// ---------------------------------------------------------------------------
// Phase-clear parity (#220): completing an issue must drop a stale phase so the
// pipeline timeline / sidebar don't show a leftover "1/N". Mirrors the Rust
// test_phase_cleared_on_completed in state_transition.rs.
// ---------------------------------------------------------------------------

test("phase is cleared when an issue transitions to completed (#220)", async () => {
  const repo = await makeTmpDir("tiki-int-phase-clear");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  await fsp.mkdir(path.join(repo, ".tiki"), { recursive: true });

  const runShim = (args) =>
    spawnSync(process.execPath, [STATE_SHIM, ...args], { cwd: repo, encoding: "utf-8" });

  // Put the issue into executing WITH phase progress set.
  const set = runShim([
    "transition", "issue:6001",
    "--to-status", "executing", "--to-step", "EXECUTE",
    "--issue-number", "6001", "--issue-title", "phase clear",
    "--phase-current", "1", "--phase-total", "3", "--phase-status", "executing",
  ]);
  assert.equal(set.status, 0, `set phase failed: ${set.stderr}`);

  const stateFile = path.join(repo, ".tiki", "state.json");
  let parsed = JSON.parse(await fsp.readFile(stateFile, "utf-8"));
  assert.ok(parsed.activeWork["issue:6001"].phase, "phase should be set after executing transition");
  assert.equal(parsed.activeWork["issue:6001"].phase.current, 1);

  // Complete it — phase must be gone.
  const done = runShim([
    "transition", "issue:6001",
    "--to-status", "completed", "--to-step", "SHIP",
  ]);
  assert.equal(done.status, 0, `complete failed: ${done.stderr}`);

  parsed = JSON.parse(await fsp.readFile(stateFile, "utf-8"));
  assert.equal(parsed.activeWork["issue:6001"].status, "completed");
  assert.equal(
    parsed.activeWork["issue:6001"].phase,
    undefined,
    "phase must be cleared on completion (#220)"
  );
});

// ---------------------------------------------------------------------------
// Write-integrity lock (#224): concurrent read-modify-write must not lose an
// update. Without the lock, interleaved writers clobber each other; with it,
// every append survives.
// ---------------------------------------------------------------------------

test("concurrent state.mjs writers do not lose updates (#224 lock)", async () => {
  const repo = await makeTmpDir("tiki-int-concurrent");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  await fsp.mkdir(path.join(repo, ".tiki"), { recursive: true });

  const N = 8;
  const base = 5000;
  // Launch all writers at once so their read-modify-write windows overlap.
  const codes = await Promise.all(
    Array.from({ length: N }, (_unused, i) => {
      const num = base + i;
      return new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            STATE_SHIM,
            "append-history",
            "issue",
            "--number",
            String(num),
            "--title",
            `concurrent ${num}`,
          ],
          { cwd: repo }
        );
        child.on("exit", (code) => resolve(code));
        child.on("error", reject);
      });
    })
  );

  assert.ok(
    codes.every((c) => c === 0),
    `every concurrent writer should exit 0 (got ${codes.join(",")})`
  );

  const stateFile = path.join(repo, ".tiki", "state.json");
  const parsed = JSON.parse(await fsp.readFile(stateFile, "utf-8"));
  const got = new Set((parsed.history.recentIssues || []).map((r) => r.number));
  for (let i = 0; i < N; i++) {
    assert.ok(
      got.has(base + i),
      `lost update under concurrency: issue ${base + i} missing (got ${[...got].join(",")})`
    );
  }

  // The lock file must not linger after all writers release.
  assert.equal(
    fs.existsSync(path.join(repo, ".tiki", "state.json.lock")),
    false,
    "state.json.lock should be released after all writers finish"
  );
});

// ---------------------------------------------------------------------------
// Intent journal (#272): `state.mjs journal` subcommand + exported helpers
// (appendJournalEntry / readJournalEntries / journalFloor / pruneJournal).
// CLI tests spawn the real shim; helper tests import directly.
// ---------------------------------------------------------------------------

const journalPathIn = (dir) => path.join(dir, ".tiki", "journal.ndjson");

function readJournalLines(dir) {
  return fs
    .readFileSync(journalPathIn(dir), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
}

test("journal CLI: creates .tiki/ and journal.ndjson in a bare project (no pre-existing .tiki)", async () => {
  // The journal may be the FIRST tiki artifact: GET journals before anything
  // else exists. No .tiki dir is created up front here, on purpose.
  const repo = await makeTmpDir("tiki-journal-bare");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [STATE_SHIM, "journal", "issue:42", "--step", "GET", "--title", "Add user profiles"],
    { cwd: repo, encoding: "utf-8" }
  );

  assert.equal(result.status, 0, `journal exited non-zero: ${result.stderr}`);
  assert.equal(fs.existsSync(journalPathIn(repo)), true, ".tiki/journal.ndjson should exist");

  const lines = readJournalLines(repo);
  assert.equal(lines.length, 1, "exactly one journal line");
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.workId, "issue:42");
  assert.equal(entry.step, "GET");
  assert.equal(entry.event, "start");
  assert.equal(entry.title, "Add user profiles");
  assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "ts should be an ISO timestamp");

  // The appended line is also printed on stdout.
  assert.equal(JSON.parse(result.stdout.trim()).workId, "issue:42");
});

test("journal CLI: multiple appends accumulate as NDJSON lines", async () => {
  const repo = await makeTmpDir("tiki-journal-accumulate");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });

  for (const step of ["GET", "REVIEW", "PLAN"]) {
    const r = spawnSync(
      process.execPath,
      [STATE_SHIM, "journal", "issue:7", "--step", step],
      { cwd: repo, encoding: "utf-8" }
    );
    assert.equal(r.status, 0, `journal --step ${step} failed: ${r.stderr}`);
  }

  const lines = readJournalLines(repo);
  assert.equal(lines.length, 3, "three appends → three lines");
  assert.deepEqual(
    lines.map((l) => JSON.parse(l).step),
    ["GET", "REVIEW", "PLAN"],
    "lines preserve append order"
  );
});

test("journal CLI: --title and --phase flags land in the entry", async () => {
  const repo = await makeTmpDir("tiki-journal-flags");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [
      STATE_SHIM, "journal", "issue:11",
      "--step", "EXECUTE",
      "--phase-current", "2", "--phase-total", "5",
      "--title", "flagged entry",
    ],
    { cwd: repo, encoding: "utf-8" }
  );
  assert.equal(result.status, 0, `journal failed: ${result.stderr}`);

  const entry = JSON.parse(readJournalLines(repo)[0]);
  assert.deepEqual(entry.phase, { current: 2, total: 5 });
  assert.equal(entry.title, "flagged entry");
  assert.equal(entry.event, "start", "event defaults to start");
});

test("journal CLI: invalid step warns on stderr but exits 0 and writes no line", async () => {
  const repo = await makeTmpDir("tiki-journal-badstep");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [STATE_SHIM, "journal", "issue:42", "--step", "DEPLOY"],
    { cwd: repo, encoding: "utf-8" }
  );

  // The journal must NEVER break a workflow command: exit 0 even on bad args.
  assert.equal(result.status, 0, "invalid step must still exit 0");
  assert.match(result.stderr, /journal warning/, "expected a warning on stderr");
  assert.match(result.stderr, /invalid --step 'DEPLOY'/);
  assert.equal(
    fs.existsSync(journalPathIn(repo)),
    false,
    "no journal line should be written for an invalid step"
  );

  // Same exit-0 contract for a malformed workId.
  const badId = spawnSync(
    process.execPath,
    [STATE_SHIM, "journal", "story:42", "--step", "GET"],
    { cwd: repo, encoding: "utf-8" }
  );
  assert.equal(badId.status, 0, "invalid workId must still exit 0");
  assert.match(badId.stderr, /journal warning/);
  assert.equal(fs.existsSync(journalPathIn(repo)), false);
});

test("readJournalEntries: skips torn/garbage lines and parses the rest", async () => {
  const dir = await makeTmpDir("tiki-journal-torn");
  const tikiPath = path.join(dir, ".tiki");
  await fsp.mkdir(tikiPath, { recursive: true });

  const good1 = JSON.stringify({ ts: "2026-06-12T00:00:00Z", workId: "issue:1", step: "GET", event: "start" });
  const torn = '{"ts":"2026-06-12T00:01:00Z","workId":"issue:1","st'; // truncated mid-write
  const garbage = "not json at all";
  const good2 = JSON.stringify({ ts: "2026-06-12T00:02:00Z", workId: "issue:1", step: "REVIEW", event: "start" });
  await fsp.writeFile(
    path.join(tikiPath, "journal.ndjson"),
    [good1, torn, garbage, good2].join("\n") + "\n",
    "utf-8"
  );

  const entries = readJournalEntries(tikiPath);
  assert.equal(entries.length, 2, "only the two valid lines parse");
  assert.deepEqual(entries.map((e) => e.step), ["GET", "REVIEW"]);
});

test("readJournalEntries: returns [] when journal.ndjson does not exist", async () => {
  const dir = await makeTmpDir("tiki-journal-missing");
  assert.deepEqual(readJournalEntries(path.join(dir, ".tiki")), []);
});

test("journalFloor: picks the highest step and the newest title", () => {
  const entries = [
    { ts: "2026-06-12T00:00:00Z", workId: "issue:5", step: "GET", event: "start", title: "old title" },
    { ts: "2026-06-12T00:01:00Z", workId: "issue:5", step: "REVIEW", event: "start" },
    // Another workId's entries must not leak in.
    { ts: "2026-06-12T00:02:00Z", workId: "issue:6", step: "SHIP", event: "start", title: "other issue" },
    { ts: "2026-06-12T00:03:00Z", workId: "issue:5", step: "PLAN", event: "start", title: "newest title" },
    // A lower step journaled later (e.g. re-run) must not lower the floor.
    { ts: "2026-06-12T00:04:00Z", workId: "issue:5", step: "GET", event: "start" },
  ];

  const floor = journalFloor(entries, "issue:5");
  assert.deepEqual(floor, { step: "PLAN", title: "newest title" });

  // STEP_ORDER is the shared ordering source the floor is computed with.
  assert.ok(STEP_ORDER.PLAN > STEP_ORDER.REVIEW && STEP_ORDER.REVIEW > STEP_ORDER.GET);

  // Unknown workId → null.
  assert.equal(journalFloor(entries, "issue:999"), null);

  // Entries whose step is not in STEP_ORDER are ignored.
  assert.equal(journalFloor([{ workId: "issue:9", step: "BOGUS" }], "issue:9"), null);
});

test("pruneJournal: below threshold leaves the file byte-identical and returns 0", async () => {
  const dir = await makeTmpDir("tiki-journal-prune-below");
  const tikiPath = path.join(dir, ".tiki");
  await fsp.mkdir(tikiPath, { recursive: true });

  // 6 total lines, 2 prunable — below BOTH thresholds (50 total / 10 prunable).
  const lines = [
    { workId: "issue:1", step: "GET" },
    { workId: "issue:1", step: "REVIEW" },
    { workId: "issue:2", step: "GET" }, // in history → prunable
    { workId: "issue:2", step: "SHIP" }, // in history → prunable
    { workId: "issue:3", step: "GET" },
    { workId: "release:v1.0", step: "EXECUTE" },
  ].map((e) => JSON.stringify({ ts: "2026-06-12T00:00:00Z", event: "start", ...e }));
  const original = lines.join("\n") + "\n";
  await fsp.writeFile(path.join(tikiPath, "journal.ndjson"), original, "utf-8");

  const state = { history: { recentIssues: [{ number: 2, title: "shipped", completedAt: "x" }] } };
  const pruned = pruneJournal(tikiPath, state);
  assert.equal(pruned, 0, "below threshold → nothing pruned");
  assert.equal(
    await fsp.readFile(path.join(tikiPath, "journal.ndjson"), "utf-8"),
    original,
    "file must be untouched below threshold"
  );
});

test("pruneJournal: >= 10 prunable lines removes only history members, atomically", async () => {
  const dir = await makeTmpDir("tiki-journal-prune-above");
  const tikiPath = path.join(dir, ".tiki");
  await fsp.mkdir(tikiPath, { recursive: true });

  const mk = (workId, step) =>
    JSON.stringify({ ts: "2026-06-12T00:00:00Z", workId, step, event: "start" });
  const lines = [];
  // 10 prunable issue lines + 2 prunable release lines.
  for (let i = 0; i < 10; i++) lines.push(mk("issue:100", i % 2 ? "REVIEW" : "GET"));
  lines.push(mk("release:v2.0", "EXECUTE"));
  lines.push(mk("release:v2.0", "SHIP"));
  // Keepers: live issue, live release, and an issue NOT in history.
  lines.push(mk("issue:200", "PLAN"));
  lines.push(mk("release:v3.0", "EXECUTE"));
  await fsp.writeFile(path.join(tikiPath, "journal.ndjson"), lines.join("\n") + "\n", "utf-8");

  const state = {
    history: {
      recentIssues: [{ number: 100, title: "shipped", completedAt: "x" }],
      recentReleases: [{ version: "v2.0", completedAt: "x" }],
    },
  };
  const pruned = pruneJournal(tikiPath, state);
  assert.equal(pruned, 12, "10 issue lines + 2 release lines pruned");

  const remaining = readJournalLines(dir).map((l) => JSON.parse(l).workId);
  assert.deepEqual(remaining, ["issue:200", "release:v3.0"], "only non-history entries survive");

  // Atomic rewrite: the tmp file must not linger.
  assert.equal(
    fs.existsSync(path.join(tikiPath, "journal.ndjson.tmp")),
    false,
    "tmp file must be cleaned up by the rename"
  );
});

test("pruneJournal: >= 50 total lines triggers pruning even with few prunable lines", async () => {
  const dir = await makeTmpDir("tiki-journal-prune-total");
  const tikiPath = path.join(dir, ".tiki");
  await fsp.mkdir(tikiPath, { recursive: true });

  const mk = (workId, step) =>
    JSON.stringify({ ts: "2026-06-12T00:00:00Z", workId, step, event: "start" });
  const lines = [];
  for (let i = 0; i < 48; i++) lines.push(mk(`issue:${300 + i}`, "GET")); // live
  lines.push(mk("issue:42", "GET")); // shipped
  lines.push(mk("issue:42", "SHIP")); // shipped
  assert.equal(lines.length, 50);
  await fsp.writeFile(path.join(tikiPath, "journal.ndjson"), lines.join("\n") + "\n", "utf-8");

  const state = { history: { recentIssues: [{ number: 42, title: "shipped", completedAt: "x" }] } };
  const pruned = pruneJournal(tikiPath, state);
  assert.equal(pruned, 2, "50-total-lines threshold lets 2 prunable lines go");
  assert.equal(readJournalLines(dir).length, 48);
});

test("appendJournalEntry: returns false instead of throwing on unwritable path", async () => {
  // A tikiPath whose parent is a FILE makes mkdir/append fail on every OS.
  const dir = await makeTmpDir("tiki-journal-unwritable");
  const fileAsDir = path.join(dir, "not-a-dir");
  fs.writeFileSync(fileAsDir, "occupied", "utf-8");

  const result = appendJournalEntry(path.join(fileAsDir, ".tiki"), {
    workId: "issue:1",
    step: "GET",
  });
  assert.equal(result, false, "append must degrade to false, never throw");

  // Missing required fields also return false.
  assert.equal(appendJournalEntry(path.join(dir, ".tiki"), { workId: "issue:1" }), false);
  assert.equal(appendJournalEntry(path.join(dir, ".tiki"), { step: "GET" }), false);
});

// ---------------------------------------------------------------------------
// Mutation-surface subcommands (#275): parallel / heal-attempt / enrich /
// release-wave. Each has a happy path (assert resulting state.json) and a
// reject path (non-zero exit + stderr message). All spawn the real CLI.
// ---------------------------------------------------------------------------

/** Build a repo with a .git dir and an activeWork issue entry already seeded. */
async function seededIssueRepo(prefix, num = 42, extra = {}) {
  const repo = await makeTmpDir(prefix);
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  await fsp.mkdir(path.join(repo, ".tiki"), { recursive: true });
  const state = {
    schemaVersion: 1,
    activeWork: {
      [`issue:${num}`]: {
        type: "issue",
        issue: { number: num, title: `issue ${num}` },
        status: "executing",
        pipelineStep: "EXECUTE",
        createdAt: "2026-06-13T00:00:00.000Z",
        lastActivity: "2026-06-13T00:00:00.000Z",
        ...extra,
      },
    },
    history: {},
  };
  await fsp.writeFile(
    path.join(repo, ".tiki", "state.json"),
    JSON.stringify(state, null, 2),
    "utf-8"
  );
  return repo;
}

const runShimIn = (repo, args, opts = {}) =>
  spawnSync(process.execPath, [STATE_SHIM, ...args], {
    cwd: repo,
    encoding: "utf-8",
    ...opts,
  });

const readStateJson = async (repo) =>
  JSON.parse(await fsp.readFile(path.join(repo, ".tiki", "state.json"), "utf-8"));

// --- parallel ---------------------------------------------------------------

test("parallel: --start sets parallelExecution; --complete appends idempotently; --clear removes it", async () => {
  const repo = await seededIssueRepo("tiki-parallel-happy");

  const start = runShimIn(repo, ["parallel", "issue:42", "--start", "1,2,3", "--total", "3"]);
  assert.equal(start.status, 0, `start failed: ${start.stderr}`);
  let state = await readStateJson(repo);
  let pe = state.activeWork["issue:42"].parallelExecution;
  assert.deepEqual(pe.phases, [1, 2, 3]);
  assert.deepEqual(pe.completedInGroup, []);
  assert.equal(pe.totalInGroup, 3);
  assert.match(pe.startedAt, /^\d{4}-\d{2}-\d{2}T/);

  // Complete phase 2, then again (idempotent — no duplicate).
  assert.equal(runShimIn(repo, ["parallel", "issue:42", "--complete", "2"]).status, 0);
  assert.equal(runShimIn(repo, ["parallel", "issue:42", "--complete", "2"]).status, 0);
  state = await readStateJson(repo);
  assert.deepEqual(state.activeWork["issue:42"].parallelExecution.completedInGroup, [2]);

  // Clear removes the field entirely.
  const clear = runShimIn(repo, ["parallel", "issue:42", "--clear"]);
  assert.equal(clear.status, 0, `clear failed: ${clear.stderr}`);
  state = await readStateJson(repo);
  assert.equal(state.activeWork["issue:42"].parallelExecution, undefined);
});

test("parallel: rejects a release work-id and bad numeric input", async () => {
  const repo = await seededIssueRepo("tiki-parallel-reject");

  const rel = runShimIn(repo, ["parallel", "release:v1.2", "--start", "1", "--total", "1"]);
  assert.notEqual(rel.status, 0, "release work-id must be rejected");
  assert.match(rel.stderr, /requires an issue work_id/);

  const badPhase = runShimIn(repo, ["parallel", "issue:42", "--start", "1,x", "--total", "2"]);
  assert.notEqual(badPhase.status, 0, "non-numeric phase must be rejected");
  assert.match(badPhase.stderr, /invalid --start value 'x'/);

  const noTotal = runShimIn(repo, ["parallel", "issue:42", "--start", "1,2"]);
  assert.notEqual(noTotal.status, 0, "missing --total must be rejected");
  assert.match(noTotal.stderr, /requires --total/);

  const noMode = runShimIn(repo, ["parallel", "issue:42"]);
  assert.notEqual(noMode.status, 0, "no mode flag must be rejected");
  assert.match(noMode.stderr, /exactly one of --start, --complete, or --clear/);
});

// --- heal-attempt -----------------------------------------------------------

test("heal-attempt: appends a HealAttempt record to phase.healAttempts", async () => {
  const repo = await seededIssueRepo("tiki-heal-happy", 42, {
    phase: { current: 1, total: 3, status: "executing" },
  });

  const r = runShimIn(repo, [
    "heal-attempt", "issue:42",
    "--category", "type-error",
    "--outcome", "failure",
    "--message", "TS2307 cannot find module",
    "--strategy", "fix import path",
    "--next-step", "re-run tsc",
  ]);
  assert.equal(r.status, 0, `heal-attempt failed: ${r.stderr}`);

  const state = await readStateJson(repo);
  const attempts = state.activeWork["issue:42"].phase.healAttempts;
  assert.equal(attempts.length, 1);
  const a = attempts[0];
  assert.equal(a.category, "type-error");
  assert.equal(a.outcome, "failure");
  assert.equal(a.message, "TS2307 cannot find module");
  assert.equal(a.strategy, "fix import path");
  assert.equal(a.nextStep, "re-run tsc");
  assert.match(a.ts, /^\d{4}-\d{2}-\d{2}T/);

  // A second append accumulates.
  assert.equal(
    runShimIn(repo, ["heal-attempt", "issue:42", "--category", "other", "--outcome", "success"]).status,
    0
  );
  const state2 = await readStateJson(repo);
  assert.equal(state2.activeWork["issue:42"].phase.healAttempts.length, 2);
});

test("heal-attempt: rejects a bad category, a bad outcome, and a missing phase", async () => {
  const withPhase = await seededIssueRepo("tiki-heal-reject", 42, {
    phase: { current: 1, total: 1, status: "executing" },
  });

  const badCat = runShimIn(withPhase, [
    "heal-attempt", "issue:42", "--category", "bogus", "--outcome", "success",
  ]);
  assert.notEqual(badCat.status, 0);
  assert.match(badCat.stderr, /invalid --category 'bogus'/);

  const badOut = runShimIn(withPhase, [
    "heal-attempt", "issue:42", "--category", "build-error", "--outcome", "maybe",
  ]);
  assert.notEqual(badOut.status, 0);
  assert.match(badOut.stderr, /invalid --outcome 'maybe'/);

  // No phase on the entry → reject.
  const noPhase = await seededIssueRepo("tiki-heal-nophase", 99);
  const r = runShimIn(noPhase, [
    "heal-attempt", "issue:99", "--category", "build-error", "--outcome", "success",
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /has no active phase/);
});

// --- enrich -----------------------------------------------------------------

test("enrich: shallow-merges allowlisted metadata from a file onto issue", async () => {
  const repo = await seededIssueRepo("tiki-enrich-file");
  const jsonFile = path.join(repo, "meta.json");
  await fsp.writeFile(
    jsonFile,
    JSON.stringify({
      body: "issue body",
      labels: ["bug", "p1"],
      state: "open",
      url: "https://example.com/42",
    }),
    "utf-8"
  );

  const r = runShimIn(repo, ["enrich", "issue:42", "--json", jsonFile]);
  assert.equal(r.status, 0, `enrich failed: ${r.stderr}`);

  const state = await readStateJson(repo);
  const issue = state.activeWork["issue:42"].issue;
  // Existing number/title preserved, new keys merged.
  assert.equal(issue.number, 42);
  assert.equal(issue.title, "issue 42");
  assert.equal(issue.body, "issue body");
  assert.deepEqual(issue.labels, ["bug", "p1"]);
  assert.equal(issue.state, "open");
  assert.equal(issue.url, "https://example.com/42");
});

test("enrich: reads JSON from stdin when --json is '-'", async () => {
  const repo = await seededIssueRepo("tiki-enrich-stdin");
  const r = runShimIn(repo, ["enrich", "issue:42", "--json", "-"], {
    input: JSON.stringify({ body: "from stdin", updatedAt: "2026-06-13T01:00:00Z" }),
  });
  assert.equal(r.status, 0, `enrich stdin failed: ${r.stderr}`);

  const state = await readStateJson(repo);
  assert.equal(state.activeWork["issue:42"].issue.body, "from stdin");
  assert.equal(state.activeWork["issue:42"].issue.updatedAt, "2026-06-13T01:00:00Z");
});

test("enrich: rejects unknown keys and a release work-id", async () => {
  const repo = await seededIssueRepo("tiki-enrich-reject");

  const unknown = runShimIn(repo, ["enrich", "issue:42", "--json", "-"], {
    input: JSON.stringify({ body: "ok", title: "should-be-rejected", nope: 1 }),
  });
  assert.notEqual(unknown.status, 0, "unknown keys must be rejected");
  assert.match(unknown.stderr, /unknown key\(s\)/);
  // The injection didn't land — state.json untouched (title still original).
  const state = await readStateJson(repo);
  assert.equal(state.activeWork["issue:42"].issue.title, "issue 42");

  const rel = runShimIn(repo, ["enrich", "release:v1.2", "--json", "-"], {
    input: JSON.stringify({ body: "x" }),
  });
  assert.notEqual(rel.status, 0);
  assert.match(rel.stderr, /requires an issue work_id/);
});

// --- release-wave -----------------------------------------------------------

/** Build a repo with an activeWork release entry seeded. */
async function seededReleaseRepo(prefix, version = "v1.2") {
  const repo = await makeTmpDir(prefix);
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  await fsp.mkdir(path.join(repo, ".tiki"), { recursive: true });
  const state = {
    schemaVersion: 1,
    activeWork: {
      [`release:${version}`]: {
        type: "release",
        release: { version, issues: [41, 42, 43], completedIssues: [] },
        status: "executing",
        pipelineStep: "EXECUTE",
        createdAt: "2026-06-13T00:00:00.000Z",
        lastActivity: "2026-06-13T00:00:00.000Z",
      },
    },
    history: {},
  };
  await fsp.writeFile(
    path.join(repo, ".tiki", "state.json"),
    JSON.stringify(state, null, 2),
    "utf-8"
  );
  return repo;
}

test("release-wave: sets currentIssues and idempotently appends completed issue + branch", async () => {
  const repo = await seededReleaseRepo("tiki-wave-happy");

  const setCurrent = runShimIn(repo, ["release-wave", "release:v1.2", "--current", "41,42"]);
  assert.equal(setCurrent.status, 0, `set current failed: ${setCurrent.stderr}`);
  let state = await readStateJson(repo);
  assert.deepEqual(state.activeWork["release:v1.2"].release.currentIssues, [41, 42]);

  // Append a completed issue + branch twice → idempotent.
  runShimIn(repo, ["release-wave", "release:v1.2", "--completed-issue", "41", "--completed-branch", "wt-41"]);
  runShimIn(repo, ["release-wave", "release:v1.2", "--completed-issue", "41", "--completed-branch", "wt-41"]);
  state = await readStateJson(repo);
  assert.deepEqual(state.activeWork["release:v1.2"].release.completedIssues, [41]);
  assert.deepEqual(state.activeWork["release:v1.2"].release.completedBranches, ["wt-41"]);

  // A second distinct completion appends in order.
  runShimIn(repo, ["release-wave", "release:v1.2", "--completed-issue", "42", "--completed-branch", "wt-42"]);
  state = await readStateJson(repo);
  assert.deepEqual(state.activeWork["release:v1.2"].release.completedIssues, [41, 42]);
  assert.deepEqual(state.activeWork["release:v1.2"].release.completedBranches, ["wt-41", "wt-42"]);
});

test("release-wave: rejects an issue work-id, bad --current, and no flags", async () => {
  const repo = await seededReleaseRepo("tiki-wave-reject");

  const issueId = runShimIn(repo, ["release-wave", "issue:42", "--current", "1"]);
  assert.notEqual(issueId.status, 0, "issue work-id must be rejected");
  assert.match(issueId.stderr, /requires a release work_id/);

  const badCurrent = runShimIn(repo, ["release-wave", "release:v1.2", "--current", "41,nope"]);
  assert.notEqual(badCurrent.status, 0, "non-numeric --current must be rejected");
  assert.match(badCurrent.stderr, /invalid --current value 'nope'/);

  const noFlags = runShimIn(repo, ["release-wave", "release:v1.2"]);
  assert.notEqual(noFlags.status, 0, "no wave flags must be rejected");
  assert.match(noFlags.stderr, /at least one of --current/);
});
