/**
 * Tests for packages/framework/scripts/migrate-stale-artifacts.mjs (#300) —
 * the one-time artifact migration: archive stale-location plans + release
 * defs, reconstruct ghost release defs.
 *
 * node:test runner (zero test devDependencies, mirrors plan.test.mjs
 * conventions): temp fixture `.tiki/` tree under os.tmpdir(), spawn the real
 * CLI with --tiki-path + --closed-issues-file (so NO gh calls are made),
 * assert file locations + JSON contents + exit codes.
 *
 * Fixture covers every migration class from the issue:
 *   - stale plan for a CLOSED issue with pending/executing phases  → archived,
 *     phases normalized to completed
 *   - plan for an OPEN issue (not in history, not closed)          → untouched
 *   - plan for an issue active in activeWork                       → untouched
 *   - stranded release def with status "completed"                 → archived,
 *     status normalized to "shipped"
 *   - active release def with status "active"                      → untouched
 *   - ghost history.recentReleases record with no def              → def
 *     reconstructed into releases/archive/
 *   - changelog-only ghost (changelog + no def + absent from history)
 *     → def reconstructed with issue list parsed from /issues/N links
 *   - orphan changelog whose def is archived                       → stays in
 *     active releases/ (documented keep-in-place decision)
 *
 * Run: node --test packages/framework/__tests__/migrate-stale-artifacts.test.mjs
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "migrate-stale-artifacts.mjs");

const tempDirs = [];
after(async () => {
  for (const d of tempDirs) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/** Build the full fixture tree; returns { root, tiki, closedFile }. */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-migrate-test-"));
  tempDirs.push(root);
  const tiki = path.join(root, ".tiki");

  // state.json: one active issue, history with a ghost release record.
  writeJson(path.join(tiki, "state.json"), {
    activeWork: {
      "issue:90": {
        type: "issue",
        issue: { number: 90, title: "Active issue" },
        status: "executing",
        pipelineStep: "EXECUTE",
      },
      "release:v9.9.9": {
        type: "release",
        status: "executing",
        release: { version: "v9.9.9", issues: [90] },
      },
    },
    history: {
      recentIssues: [{ number: 42, title: "Closed via history", completedAt: "2026-01-01T00:00:00.000Z" }],
      recentReleases: [
        {
          version: "v0.5.5",
          issues: [42, 43],
          completedAt: "2026-02-01T00:00:00.000Z",
          tag: "v0.5.5",
        },
      ],
    },
  });

  // Plans.
  writeJson(path.join(tiki, "plans", "issue-42.json"), {
    issue: { number: 42, title: "Closed via history" },
    phases: [
      { number: 1, title: "a", status: "completed" },
      { number: 2, title: "b", status: "executing" },
      { number: 3, title: "c", status: "pending" },
      { number: 4, title: "d", status: "skipped" },
    ],
  });
  writeJson(path.join(tiki, "plans", "issue-43.json"), {
    issue: { number: 43, title: "Closed via gh set" },
    phases: [{ number: 1, title: "a", status: "pending" }],
  });
  // Open issue: NOT in history, NOT in closed set.
  writeJson(path.join(tiki, "plans", "issue-77.json"), {
    issue: { number: 77, title: "Open issue" },
    phases: [{ number: 1, title: "a", status: "pending" }],
  });
  // Active in activeWork (even though also listed closed — activeWork wins).
  writeJson(path.join(tiki, "plans", "issue-90.json"), {
    issue: { number: 90, title: "Active issue" },
    phases: [{ number: 1, title: "a", status: "executing" }],
  });

  // Releases.
  writeJson(path.join(tiki, "releases", "v0.2.5.json"), {
    version: "v0.2.5",
    status: "completed",
    completedAt: "2026-02-08T16:23:14.000Z",
    issues: [{ number: 43, title: "Closed via gh set" }],
    createdAt: "2026-02-08T00:00:00.000Z",
  });
  writeJson(path.join(tiki, "releases", "v9.9.9.json"), {
    version: "v9.9.9",
    status: "active",
    issues: [{ number: 90, title: "Active issue" }],
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  // Archived def whose changelog is an orphan in active releases/.
  writeJson(path.join(tiki, "releases", "archive", "v0.6.0.json"), {
    version: "v0.6.0",
    status: "shipped",
    issues: [],
    createdAt: "2026-03-01T00:00:00.000Z",
  });
  fs.writeFileSync(
    path.join(tiki, "releases", "v0.6.0-changelog.md"),
    "# v0.6.0\norphan changelog, def archived — must stay put\n",
    "utf-8"
  );
  // Changelog-only ghost: no def anywhere, absent from history.
  fs.writeFileSync(
    path.join(tiki, "releases", "v0.7.4-changelog.md"),
    [
      "# v0.7.4 — ghost",
      "- fix ([#231](https://github.com/x/y/issues/231))",
      "- refactor ([#230](https://github.com/x/y/issues/230))",
      "- again #231 dup link (https://github.com/x/y/issues/231)",
    ].join("\n"),
    "utf-8"
  );

  // Closed-issue override file (replaces the batched gh call).
  const closedFile = path.join(root, "closed.json");
  writeJson(closedFile, [
    { number: 42, title: "Closed via history" },
    { number: 43, title: "Closed via gh set" },
    { number: 90, title: "Active issue" },
    { number: 230, title: "Ghost issue 230" },
    { number: 231, title: "Ghost issue 231" },
  ]);

  return { root, tiki, closedFile };
}

function run(tiki, closedFile, extra = []) {
  return spawnSync(
    process.execPath,
    [SCRIPT, "--tiki-path", tiki, "--closed-issues-file", closedFile, ...extra],
    { encoding: "utf-8" }
  );
}

/** Snapshot of every file path+content under a dir, for no-op assertions. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, "utf-8");
    }
  };
  walk(dir);
  return out;
}

test("--dry-run lists every planned move and touches nothing", () => {
  const { tiki, closedFile } = makeFixture();
  const before = snapshot(tiki);
  const res = run(tiki, closedFile, ["--dry-run"]);
  assert.equal(res.status, 0, res.stderr);

  // Lists each class of planned action.
  assert.match(res.stdout, /archive-plan: plans\/issue-42\.json -> plans\/archive\/issue-42\.json/);
  assert.match(res.stdout, /archive-plan: plans\/issue-43\.json/);
  assert.match(res.stdout, /archive-release-def: releases\/v0\.2\.5\.json -> releases\/archive\/v0\.2\.5\.json/);
  assert.match(res.stdout, /reconstruct-release-def: releases\/archive\/v0\.5\.5\.json\s+\(from history/);
  assert.match(res.stdout, /reconstruct-release-def: releases\/archive\/v0\.7\.4\.json\s+\(from changelog/);
  // Guarded items are skipped, with reasons.
  assert.match(res.stdout, /skip: plan issue-77: not in history and not known closed/);
  assert.match(res.stdout, /skip: plan issue-90: active in activeWork/);
  assert.match(res.stdout, /skip: release v9\.9\.9: active in activeWork/);
  assert.match(res.stdout, /dry-run: 2 plans, 1 release defs, 2 ghost reconstructions planned/);

  // Nothing changed on disk (including no backups dir).
  assert.deepEqual(snapshot(tiki), before);
  assert.equal(fs.existsSync(path.join(tiki, "backups")), false);
});

test("real run migrates, normalizes, reconstructs, and backs up", () => {
  const { tiki, closedFile } = makeFixture();
  const res = run(tiki, closedFile);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /done: 2 plans archived, 1 release defs archived, 2 ghost defs reconstructed/);

  // Stale plans moved to archive with statuses normalized (skipped preserved).
  assert.equal(fs.existsSync(path.join(tiki, "plans", "issue-42.json")), false);
  const p42 = readJson(path.join(tiki, "plans", "archive", "issue-42.json"));
  assert.deepEqual(
    p42.phases.map((p) => p.status),
    ["completed", "completed", "completed", "skipped"]
  );
  assert.equal(fs.existsSync(path.join(tiki, "plans", "archive", "issue-43.json")), true);

  // Guarded plans untouched.
  assert.equal(fs.existsSync(path.join(tiki, "plans", "issue-77.json")), true);
  assert.equal(fs.existsSync(path.join(tiki, "plans", "issue-90.json")), true);

  // Stranded def archived with status normalized to shipped.
  assert.equal(fs.existsSync(path.join(tiki, "releases", "v0.2.5.json")), false);
  const def = readJson(path.join(tiki, "releases", "archive", "v0.2.5.json"));
  assert.equal(def.status, "shipped");

  // Active def untouched.
  const active = readJson(path.join(tiki, "releases", "v9.9.9.json"));
  assert.equal(active.status, "active");

  // Ghost from history reconstructed with titles from the closed set.
  const ghost = readJson(path.join(tiki, "releases", "archive", "v0.5.5.json"));
  assert.equal(ghost.status, "shipped");
  assert.equal(ghost.reconstructed, true);
  assert.equal(ghost.tag, "v0.5.5");
  assert.equal(ghost.completedAt, "2026-02-01T00:00:00.000Z");
  assert.deepEqual(ghost.issues, [
    { number: 42, title: "Closed via history" },
    { number: 43, title: "Closed via gh set" },
  ]);
  assert.equal(typeof ghost.createdAt, "string");
  assert.ok(ghost.createdAt.length > 0);

  // Changelog-only ghost: issue list parsed + deduped from /issues/N links.
  const ghost74 = readJson(path.join(tiki, "releases", "archive", "v0.7.4.json"));
  assert.equal(ghost74.status, "shipped");
  assert.equal(ghost74.reconstructed, true);
  assert.deepEqual(ghost74.issues, [
    { number: 230, title: "Ghost issue 230" },
    { number: 231, title: "Ghost issue 231" },
  ]);

  // Orphan changelog for the archived def stayed in place.
  assert.equal(fs.existsSync(path.join(tiki, "releases", "v0.6.0-changelog.md")), true);
  // Ghost changelog also stays (changelogs are never moved).
  assert.equal(fs.existsSync(path.join(tiki, "releases", "v0.7.4-changelog.md")), true);

  // Backup: state.json copy + manifest listing every action.
  const backupsRoot = path.join(tiki, "backups");
  const backups = fs.readdirSync(backupsRoot);
  assert.equal(backups.length, 1);
  const backupDir = path.join(backupsRoot, backups[0]);
  assert.equal(fs.existsSync(path.join(backupDir, "state.json")), true);
  const manifest = readJson(path.join(backupDir, "manifest.json"));
  assert.equal(manifest.actions.length, 5); // 2 plans + 1 def + 2 ghosts
  assert.equal(manifest.closedIssueSource, "file");
  assert.ok(Array.isArray(manifest.skips));

  // state.json itself was never mutated.
  const state = readJson(path.join(tiki, "state.json"));
  assert.equal(state.activeWork["issue:90"].status, "executing");
});

test("second run is a no-op (idempotent): no changes, no new backup", () => {
  const { tiki, closedFile } = makeFixture();
  const first = run(tiki, closedFile);
  assert.equal(first.status, 0, first.stderr);

  const before = snapshot(tiki);
  const second = run(tiki, closedFile);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /nothing to migrate — no-op\./);
  assert.deepEqual(snapshot(tiki), before);
  assert.equal(fs.readdirSync(path.join(tiki, "backups")).length, 1);
});

test("without closed-issue data, non-history plans are skipped, never guessed", () => {
  const { root, tiki } = makeFixture();
  // Empty closed set: only history-based guards remain.
  const emptyClosed = path.join(root, "closed-empty.json");
  writeJson(emptyClosed, []);
  const res = run(tiki, emptyClosed, ["--dry-run"]);
  assert.equal(res.status, 0, res.stderr);
  // issue-42 still eligible via history.recentIssues; issue-43 via the
  // v0.5.5 history release issue list; issue-77 skipped.
  assert.match(res.stdout, /archive-plan: plans\/issue-42\.json/);
  assert.match(res.stdout, /archive-plan: plans\/issue-43\.json/);
  assert.match(res.stdout, /skip: plan issue-77/);
  // Ghost titles fall back to "Issue #N" — verify via real run.
  const real = run(tiki, emptyClosed);
  assert.equal(real.status, 0, real.stderr);
  const ghost = readJson(path.join(tiki, "releases", "archive", "v0.5.5.json"));
  assert.deepEqual(ghost.issues.map((i) => i.title), ["Issue #42", "Issue #43"]);
});

test("--help exits 0 and bad --closed-issues-file exits 1", () => {
  const help = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf-8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);

  const { tiki } = makeFixture();
  const bad = run(tiki, path.join(tiki, "does-not-exist.json"), ["--dry-run"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /cannot read --closed-issues-file/);
});
