/**
 * Tests for packages/framework/scripts/bootstrap-scripts.mjs — the plugin
 * SessionStart bootstrap that copies framework scripts into a project's
 * .claude/tiki/scripts/ so command bodies resolve them on plugin-only
 * installs (#268, Fix A).
 *
 * Uses Node's built-in `node:test` runner (zero test devDependencies — the
 * Windows pnpm reparse-point block documented in CLAUDE.md makes adding new
 * devDeps painful; node:test sidesteps it). Mirrors state.test.mjs
 * conventions: temp dirs under os.tmpdir(), spawn the real script with cwd
 * set, best-effort cleanup.
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
const BOOTSTRAP = path.join(FRAMEWORK, "scripts", "bootstrap-scripts.mjs");
const SCRIPTS_SOURCE = path.join(FRAMEWORK, "scripts");

const PLUGIN_VERSION = JSON.parse(
  fs.readFileSync(path.join(FRAMEWORK, ".claude-plugin", "plugin.json"), "utf8")
).version;

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

/** Run the real bootstrap script with `cwd` as the project root. */
function runBootstrap(cwd) {
  return spawnSync(process.execPath, [BOOTSTRAP], { cwd, encoding: "utf-8" });
}

const targetDir = (project) => path.join(project, ".claude", "tiki", "scripts");
const markerFile = (project) => path.join(targetDir(project), ".version");

// ---------------------------------------------------------------------------
// (a) Fresh project: full delivery + marker + one-line stdout.
// ---------------------------------------------------------------------------

test("fresh project: copies every canonical .mjs, writes .version marker, prints one line", async () => {
  const project = await makeTmpDir("tiki-bootstrap-fresh");

  const result = runBootstrap(project);
  assert.equal(result.status, 0, `exited non-zero: stderr=${result.stderr}`);

  const installed = fs
    .readdirSync(targetDir(project))
    .filter((f) => f.endsWith(".mjs"))
    .sort();
  assert.deepEqual(installed, CANONICAL_SCRIPTS, "all canonical scripts must be delivered");
  // Guard against the canonical set silently shrinking: the contract is 5 scripts.
  for (const expected of [
    "bootstrap-scripts.mjs",
    "mark-audited.mjs",
    "reconcile-state.mjs",
    "run-hook.mjs",
    "state.mjs",
  ]) {
    assert.ok(installed.includes(expected), `${expected} must be delivered`);
  }

  assert.equal(
    fs.readFileSync(markerFile(project), "utf8"),
    PLUGIN_VERSION,
    ".version marker must contain the plugin.json version"
  );

  assert.equal(
    result.stdout,
    `tiki: installed framework scripts -> .claude/tiki/scripts/ (v${PLUGIN_VERSION})\n`,
    "stdout must be exactly the one-line install message"
  );
});

// ---------------------------------------------------------------------------
// (b) Re-run at same version: silent no-op, copy skipped entirely.
// ---------------------------------------------------------------------------

test("re-run at same version: exit 0, empty stdout, files untouched", async () => {
  const project = await makeTmpDir("tiki-bootstrap-rerun");
  assert.equal(runBootstrap(project).status, 0);

  // Sentinel: vandalize a copied file. If the re-run skips the copy (as it
  // must, marker matches), the garbage survives.
  const sentinel = path.join(targetDir(project), "state.mjs");
  fs.writeFileSync(sentinel, "GARBAGE-SENTINEL");

  const rerun = runBootstrap(project);
  assert.equal(rerun.status, 0, `re-run exited non-zero: stderr=${rerun.stderr}`);
  assert.equal(rerun.stdout, "", "re-run at same version must print nothing");
  assert.equal(
    fs.readFileSync(sentinel, "utf8"),
    "GARBAGE-SENTINEL",
    "re-run must not re-copy when the .version marker matches"
  );
});

// ---------------------------------------------------------------------------
// (c) Stale marker: re-copies and updates the marker.
// ---------------------------------------------------------------------------

test("stale .version marker: re-run re-copies scripts and updates the marker", async () => {
  const project = await makeTmpDir("tiki-bootstrap-stale");
  assert.equal(runBootstrap(project).status, 0);

  const sentinel = path.join(targetDir(project), "state.mjs");
  fs.writeFileSync(sentinel, "GARBAGE-SENTINEL");
  fs.writeFileSync(markerFile(project), "0.0.0");

  const rerun = runBootstrap(project);
  assert.equal(rerun.status, 0, `re-run exited non-zero: stderr=${rerun.stderr}`);
  assert.match(rerun.stdout, /tiki: installed framework scripts/);

  const canonical = fs.readFileSync(path.join(SCRIPTS_SOURCE, "state.mjs"), "utf8");
  assert.equal(
    fs.readFileSync(sentinel, "utf8"),
    canonical,
    "stale marker must trigger a re-copy restoring canonical content"
  );
  assert.equal(fs.readFileSync(markerFile(project), "utf8"), PLUGIN_VERSION);
});

// ---------------------------------------------------------------------------
// (d) Non-Tiki project: NEVER creates .tiki/ as a side effect.
// ---------------------------------------------------------------------------

test("project without .tiki/: bootstrap does not create it", async () => {
  const project = await makeTmpDir("tiki-bootstrap-no-tiki");

  const result = runBootstrap(project);
  assert.equal(result.status, 0);
  assert.equal(
    fs.existsSync(path.join(project, ".tiki")),
    false,
    "SessionStart bootstrap must never create .tiki/ (it fires in EVERY project)"
  );
});

// ---------------------------------------------------------------------------
// (e) Tiki project: stamps .tiki/.framework-version.
// ---------------------------------------------------------------------------

test("project with .tiki/: stamps .tiki/.framework-version with the plugin version", async () => {
  const project = await makeTmpDir("tiki-bootstrap-with-tiki");
  await fsp.mkdir(path.join(project, ".tiki"), { recursive: true });

  const result = runBootstrap(project);
  assert.equal(result.status, 0);
  assert.equal(
    fs.readFileSync(path.join(project, ".tiki", ".framework-version"), "utf8"),
    PLUGIN_VERSION,
    ".framework-version must be the plugin version, no trailing newline (matches install.js)"
  );
});
