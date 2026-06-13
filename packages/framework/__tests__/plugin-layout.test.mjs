/**
 * #268 regression guard — plugin-only layout behavioral test (Fix C).
 *
 * Simulates a TRUE plugin-only install: framework scripts living at
 * `<pluginRoot>/scripts/` (NOT the monorepo), a project that has nothing but
 * an empty `.git/`, and proves state tracking works END-TO-END:
 *
 *   1. `node <pluginRoot>/scripts/bootstrap-scripts.mjs` (the SessionStart
 *      hook channel) delivers every canonical script into the project's
 *      `.claude/tiki/scripts/`.
 *   2. The project-relative invocation command bodies actually use —
 *      `node .claude/tiki/scripts/state.mjs transition ...` — succeeds and
 *      writes real state to `<project>/.tiki/state.json` (no mocks).
 *   3. Every `node .claude/...*.mjs` reference in every command body resolves
 *      to a file the bootstrap delivered.
 *
 * Why behavioral, not artifact checks: every prior major escape (#244, #259,
 * #268 itself) slipped through tests that only asserted artifact presence
 * (string in markdown, in-memory struct, file in package). This suite runs
 * the real scripts in a real plugin-shaped filesystem.
 *
 * Uses Node's built-in `node:test` runner (zero test devDependencies — the
 * Windows pnpm reparse-point block documented in CLAUDE.md makes adding new
 * devDeps painful; node:test sidesteps it). Mirrors state.test.mjs /
 * bootstrap-scripts.test.mjs conventions: temp dirs under os.tmpdir(), spawn
 * the real scripts with cwd set, best-effort cleanup in after().
 *
 * Run with:
 *   pnpm -C packages/framework test
 *   # or directly:
 *   node --test packages/framework/__tests__/
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
const FRAMEWORK = path.resolve(__dirname, "..");
const SCRIPTS_SOURCE = path.join(FRAMEWORK, "scripts");
const COMMANDS_SOURCE = path.join(FRAMEWORK, "commands");
const PLUGIN_JSON_SOURCE = path.join(FRAMEWORK, ".claude-plugin", "plugin.json");

// Enumerated at test time from the real scripts dir — never hardcoded, so a
// newly added script is automatically covered by the delivery assertion.
const CANONICAL_SCRIPTS = fs
  .readdirSync(SCRIPTS_SOURCE)
  .filter((f) => f.endsWith(".mjs"))
  .sort();

// ---------------------------------------------------------------------------
// Shared tmp-dir helpers.
// ---------------------------------------------------------------------------

const tmpDirs = [];

async function makeTmpDir(prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const real = await fsp.realpath(dir);
  tmpDirs.push(real);
  return real;
}

after(async () => {
  for (const dir of tmpDirs) {
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

/**
 * Build a temp PLUGIN ROOT shaped like a real plugin install:
 *   <pluginRoot>/scripts/*.mjs          (every canonical framework script)
 *   <pluginRoot>/.claude-plugin/plugin.json
 * bootstrap-scripts.mjs derives its sources purely from import.meta.url, so
 * running the COPY under <pluginRoot> exercises the genuine plugin channel —
 * not the monorepo layout the other suites run from.
 */
async function makePluginRoot() {
  const pluginRoot = await makeTmpDir("tiki-plugin-root");
  const scriptsDir = path.join(pluginRoot, "scripts");
  await fsp.mkdir(scriptsDir, { recursive: true });
  for (const script of CANONICAL_SCRIPTS) {
    await fsp.copyFile(path.join(SCRIPTS_SOURCE, script), path.join(scriptsDir, script));
  }
  const manifestDir = path.join(pluginRoot, ".claude-plugin");
  await fsp.mkdir(manifestDir, { recursive: true });
  await fsp.copyFile(PLUGIN_JSON_SOURCE, path.join(manifestDir, "plugin.json"));
  return pluginRoot;
}

/**
 * Build a temp PROJECT containing ONLY an empty `.git/` directory — the
 * minimal plugin-only consumer. No `.claude/`, no `.tiki/`. The `.git` dir
 * matters: state.mjs resolveTikiPath walks up to a `.git` marker, so without
 * it state would land outside the project.
 */
async function makeProject() {
  const project = await makeTmpDir("tiki-plugin-project");
  await fsp.mkdir(path.join(project, ".git"), { recursive: true });
  return project;
}

/** Bootstrap the project FROM the temp plugin root (the SessionStart channel). */
async function bootstrapProject() {
  const pluginRoot = await makePluginRoot();
  const project = await makeProject();
  const result = spawnSync(
    process.execPath,
    [path.join(pluginRoot, "scripts", "bootstrap-scripts.mjs")],
    { cwd: project, encoding: "utf-8" }
  );
  return { pluginRoot, project, result };
}

const installedScriptsDir = (project) => path.join(project, ".claude", "tiki", "scripts");

// ---------------------------------------------------------------------------
// 1. Bootstrap from a TRUE plugin layout delivers every canonical script.
// ---------------------------------------------------------------------------

test("plugin layout: bootstrap run from <pluginRoot>/scripts/ delivers every canonical script", async () => {
  const { result, project } = await bootstrapProject();
  assert.equal(result.status, 0, `bootstrap exited non-zero: stderr=${result.stderr}`);

  const installed = fs
    .readdirSync(installedScriptsDir(project))
    .filter((f) => f.endsWith(".mjs"))
    .sort();
  assert.deepEqual(
    installed,
    CANONICAL_SCRIPTS,
    "bootstrap from a plugin-shaped tree must deliver exactly the canonical script set"
  );
});

// ---------------------------------------------------------------------------
// 2. The #268 acceptance test: state tracking actually works post-bootstrap.
// ---------------------------------------------------------------------------

test("plugin layout: `node .claude/tiki/scripts/state.mjs transition` writes real state.json (#268)", async () => {
  const { result, project } = await bootstrapProject();
  assert.equal(result.status, 0, `bootstrap exited non-zero: stderr=${result.stderr}`);

  // The EXACT shape command bodies use: project-relative path, project cwd.
  const transition = spawnSync(
    process.execPath,
    [
      path.join(".claude", "tiki", "scripts", "state.mjs"),
      "transition",
      "issue:1",
      "--to-status",
      "pending",
      "--to-step",
      "GET",
      "--issue-number",
      "1",
      "--issue-title",
      "Test",
    ],
    { cwd: project, encoding: "utf-8" }
  );
  assert.equal(
    transition.status,
    0,
    `state.mjs transition failed (the #268 symptom): stderr=${transition.stderr} stdout=${transition.stdout}`
  );

  const statePath = path.join(project, ".tiki", "state.json");
  assert.ok(fs.existsSync(statePath), "state.mjs must create .tiki/state.json inside the project");

  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const work = state.activeWork?.["issue:1"];
  assert.ok(work, 'activeWork["issue:1"] must exist after the GET transition');
  assert.equal(work.status, "pending");
  assert.equal(work.pipelineStep, "GET");
});

// ---------------------------------------------------------------------------
// 3. Invariant: every script a command body references is one bootstrap delivers.
// ---------------------------------------------------------------------------

// Matches `node .claude/<...>.mjs`; the path token ends at whitespace, quote,
// or backtick (covers bare bash lines and prose-backtick mentions alike).
const NODE_INVOCATION_RE = /node\s+(\.claude\/[^\s"'`]*\.mjs)/g;

test("plugin layout: every `node .claude/...*.mjs` reference in command bodies resolves post-bootstrap", async () => {
  const { result, project } = await bootstrapProject();
  assert.equal(result.status, 0, `bootstrap exited non-zero: stderr=${result.stderr}`);

  const commandFiles = fs
    .readdirSync(COMMANDS_SOURCE)
    .filter((f) => f.endsWith(".md"))
    .sort();
  assert.ok(commandFiles.length > 0, "commands dir must contain .md command bodies");

  /** @type {Map<string, string[]>} command file -> referenced .claude/ paths */
  const refsByFile = new Map();
  let totalRefs = 0;

  for (const file of commandFiles) {
    const text = fs.readFileSync(path.join(COMMANDS_SOURCE, file), "utf8");
    const refs = [];
    for (const line of text.split("\n")) {
      // ${CLAUDE_PLUGIN_ROOT} only expands in hook commands, never in command
      // bodies — such lines are a different channel, not a bootstrap target.
      if (line.includes("CLAUDE_PLUGIN_ROOT")) continue;
      for (const match of line.matchAll(NODE_INVOCATION_RE)) {
        refs.push(match[1]);
      }
    }
    refsByFile.set(file, refs);
    totalRefs += refs.length;
  }

  // (a) The extraction must be HEALTHY — a regex that silently stops matching
  // would turn this invariant test into a no-op. Do not lower these bars.
  assert.ok(
    totalRefs >= 20,
    `expected >= 20 node .claude/... references across command files, found ${totalRefs} — ` +
      "if command syntax changed, fix the extraction regex, do NOT lower the bar"
  );
  for (const mustContribute of [
    "get.md",
    "review.md",
    "plan.md",
    "audit.md",
    "execute.md",
    "ship.md",
    "yolo.md",
    "release.md",
  ]) {
    const refs = refsByFile.get(mustContribute) ?? [];
    assert.ok(
      refs.length >= 1,
      `${mustContribute} must reference at least one .claude/ script (found ${refs.length}) — ` +
        "if its syntax changed, fix the extraction regex, do NOT lower the bar"
    );
  }

  // (b) Every referenced path must exist in the bootstrapped project: no
  // command body may invoke a script the bootstrap does not deliver.
  for (const [file, refs] of refsByFile) {
    for (const ref of refs) {
      const resolved = path.join(project, ...ref.split("/"));
      assert.ok(
        fs.existsSync(resolved),
        `${file} references "${ref}" but bootstrap did not deliver it — ` +
          "command bodies must only invoke scripts bootstrap-scripts.mjs installs"
      );
    }
  }
});
