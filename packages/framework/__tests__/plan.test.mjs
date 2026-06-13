/**
 * Tests for packages/framework/scripts/plan.mjs — the plan-file mutation shim
 * (#275 phase 2): `phase`, `verify-criteria`, `audited` subcommands, plus
 * mark-audited.mjs delegation.
 *
 * Uses Node's built-in `node:test` runner (zero test devDependencies — the
 * Windows pnpm reparse-point block documented in CLAUDE.md makes adding new
 * devDeps painful; node:test sidesteps it). Mirrors state.test.mjs conventions:
 * temp dirs under os.tmpdir() with a .git marker + .tiki/plans fixture, spawn
 * the real CLI with cwd set, assert resulting JSON + reject exit codes.
 *
 * verify-criteria is cross-checked against the canonical @tiki/shared
 * deriveCriteriaVerification for one fixture, ensuring the built-in reimpl in
 * plan.mjs stays byte-faithful to the source rule.
 *
 * Run with:
 *   pnpm -C packages/framework test
 *   # or directly:
 *   node --test packages/framework/__tests__/
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { deriveCriteriaVerification } from "@tiki/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLAN_SHIM = path.resolve(__dirname, "..", "scripts", "plan.mjs");
const MARK_AUDITED = path.resolve(__dirname, "..", "scripts", "mark-audited.mjs");

// ---------------------------------------------------------------------------
// Shared tmp-dir helpers.
// ---------------------------------------------------------------------------

const tmpDirs = [];

async function makeTmpDir(prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  // realpath: mkdtemp may return a symlinked path on macOS / some Windows
  // configs; normalize so resolveTikiPath's path.join lines up.
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

/** Build a repo with a .git dir and a plans/issue-<num>.json fixture. */
async function seededPlanRepo(prefix, num, plan) {
  const repo = await makeTmpDir(prefix);
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  await fsp.mkdir(path.join(repo, ".tiki", "plans"), { recursive: true });
  await fsp.writeFile(
    path.join(repo, ".tiki", "plans", `issue-${num}.json`),
    JSON.stringify(plan, null, 2),
    "utf-8"
  );
  return repo;
}

const runPlanIn = (repo, args, opts = {}) =>
  spawnSync(process.execPath, [PLAN_SHIM, ...args], {
    cwd: repo,
    encoding: "utf-8",
    ...opts,
  });

const readPlanJson = async (repo, num) =>
  JSON.parse(
    await fsp.readFile(path.join(repo, ".tiki", "plans", `issue-${num}.json`), "utf-8")
  );

/** A minimal plan with N phases (all pending) + success criteria + coverage. */
function planFixture(num, { phases, successCriteria, coverageMatrix } = {}) {
  return {
    schemaVersion: 1,
    issue: { number: num, title: `issue ${num}` },
    createdAt: "2026-06-13T00:00:00.000Z",
    successCriteria: successCriteria ?? [],
    phases:
      phases ??
      [
        { number: 1, title: "P1", status: "pending", content: "..." },
        { number: 2, title: "P2", status: "pending", content: "..." },
      ],
    coverageMatrix: coverageMatrix ?? {},
  };
}

// ---------------------------------------------------------------------------
// phase
// ---------------------------------------------------------------------------

test("phase: updates status + optional fields on the matching phase", async () => {
  const repo = await seededPlanRepo("tiki-plan-phase", 42, planFixture(42));

  const r = runPlanIn(repo, [
    "phase",
    "42",
    "--number",
    "1",
    "--status",
    "completed",
    "--summary",
    "did the thing",
    "--completed-at",
    "2026-06-13T01:02:03.000Z",
  ]);
  assert.equal(r.status, 0, `phase failed: ${r.stderr}`);

  const plan = await readPlanJson(repo, 42);
  const p1 = plan.phases.find((p) => p.number === 1);
  assert.equal(p1.status, "completed");
  assert.equal(p1.summary, "did the thing");
  assert.equal(p1.completedAt, "2026-06-13T01:02:03.000Z");
  // Untouched phase stays pending.
  assert.equal(plan.phases.find((p) => p.number === 2).status, "pending");
});

test("phase: --error writes a PhaseError {message,timestamp}", async () => {
  const repo = await seededPlanRepo("tiki-plan-phase-err", 42, planFixture(42));
  const r = runPlanIn(repo, [
    "phase",
    "42",
    "--number",
    "2",
    "--status",
    "failed",
    "--error",
    "boom",
  ]);
  assert.equal(r.status, 0, `phase failed: ${r.stderr}`);
  const plan = await readPlanJson(repo, 42);
  const p2 = plan.phases.find((p) => p.number === 2);
  assert.equal(p2.status, "failed");
  assert.equal(p2.error.message, "boom");
  assert.match(p2.error.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("phase: rejects a bad status", async () => {
  const repo = await seededPlanRepo("tiki-plan-badstatus", 42, planFixture(42));
  const r = runPlanIn(repo, ["phase", "42", "--number", "1", "--status", "bogus"]);
  assert.notEqual(r.status, 0, "bad status must be rejected");
  assert.match(r.stderr, /invalid --status 'bogus'/);
});

test("phase: rejects a missing phase number", async () => {
  const repo = await seededPlanRepo("tiki-plan-nophase", 42, planFixture(42));
  const r = runPlanIn(repo, ["phase", "42", "--number", "9", "--status", "completed"]);
  assert.notEqual(r.status, 0, "non-existent phase number must be rejected");
  assert.match(r.stderr, /no phase number 9/);
});

test("phase: rejects a missing plan file", async () => {
  const repo = await makeTmpDir("tiki-plan-noplan");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  const r = runPlanIn(repo, ["phase", "42", "--number", "1", "--status", "completed"]);
  assert.notEqual(r.status, 0, "missing plan must be rejected");
  assert.match(r.stderr, /no plan file at/);
});

// ---------------------------------------------------------------------------
// verify-criteria
// ---------------------------------------------------------------------------

test("verify-criteria: all covering phases complete → verified:true + verifiedAt", async () => {
  const num = 50;
  const plan = planFixture(num, {
    phases: [
      { number: 1, title: "P1", status: "completed", content: "..." },
      { number: 2, title: "P2", status: "completed", content: "..." },
    ],
    successCriteria: [
      { id: "SC1", category: "functional", description: "a" },
      { id: "SC2", category: "functional", description: "b" },
    ],
    coverageMatrix: { SC1: [1], SC2: [1, 2] },
  });
  const repo = await seededPlanRepo("tiki-plan-verify-all", num, plan);

  const r = runPlanIn(repo, ["verify-criteria", String(num)]);
  assert.equal(r.status, 0, `verify-criteria failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.verified, ["SC1", "SC2"]);

  const written = await readPlanJson(repo, num);
  for (const c of written.successCriteria) {
    assert.equal(c.verified, true);
    assert.match(c.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  }

  // Cross-check against the canonical @tiki/shared rule: same verified-set and
  // the verifiedAt presence/absence must agree field-for-field.
  const derived = deriveCriteriaVerification(plan);
  assert.deepEqual(
    written.successCriteria.map((c) => ({ id: c.id, verified: c.verified, hasAt: "verifiedAt" in c })),
    derived.map((c) => ({ id: c.id, verified: c.verified, hasAt: "verifiedAt" in c })),
    "plan.mjs verify must agree with @tiki/shared deriveCriteriaVerification"
  );
});

test("verify-criteria: partial completion → verified:false, no verifiedAt; preserves existing timestamp on re-verify", async () => {
  const num = 51;
  const plan = planFixture(num, {
    phases: [
      { number: 1, title: "P1", status: "completed", content: "..." },
      { number: 2, title: "P2", status: "pending", content: "..." },
    ],
    successCriteria: [
      // SC1 fully covered+complete and already verified — verifiedAt preserved.
      { id: "SC1", description: "a", verified: true, verifiedAt: "2026-06-01T00:00:00.000Z" },
      // SC2 covered by an incomplete phase — must become verified:false, no At.
      { id: "SC2", description: "b" },
      // SC3 has no coverage entry — stays unverified.
      { id: "SC3", description: "c" },
    ],
    coverageMatrix: { SC1: [1], SC2: [1, 2] },
  });
  const repo = await seededPlanRepo("tiki-plan-verify-partial", num, plan);

  const r = runPlanIn(repo, ["verify-criteria", String(num)]);
  assert.equal(r.status, 0, `verify-criteria failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.verified, ["SC1"]);

  const written = await readPlanJson(repo, num);
  const byId = Object.fromEntries(written.successCriteria.map((c) => [c.id, c]));
  assert.equal(byId.SC1.verified, true);
  assert.equal(byId.SC1.verifiedAt, "2026-06-01T00:00:00.000Z", "existing verifiedAt preserved");
  assert.equal(byId.SC2.verified, false);
  assert.equal("verifiedAt" in byId.SC2, false, "unverified criterion drops verifiedAt");
  assert.equal(byId.SC3.verified, false);
  assert.equal("verifiedAt" in byId.SC3, false);
});

test("verify-criteria: rejects a missing plan file", async () => {
  const repo = await makeTmpDir("tiki-plan-verify-noplan");
  await fsp.mkdir(path.join(repo, ".git"), { recursive: true });
  const r = runPlanIn(repo, ["verify-criteria", "42"]);
  assert.notEqual(r.status, 0, "missing plan must be rejected");
  assert.match(r.stderr, /no plan file at/);
});

// ---------------------------------------------------------------------------
// audited (+ mark-audited.mjs delegation)
// ---------------------------------------------------------------------------

test("audited: sets audited:true + auditedAt", async () => {
  const repo = await seededPlanRepo("tiki-plan-audited", 60, planFixture(60));
  const r = runPlanIn(repo, ["audited", "60"]);
  assert.equal(r.status, 0, `audited failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.audited, true);
  assert.match(out.auditedAt, /^\d{4}-\d{2}-\d{2}T/);

  const plan = await readPlanJson(repo, 60);
  assert.equal(plan.audited, true);
  assert.equal(plan.auditedAt, out.auditedAt);
});

test("mark-audited.mjs delegates to the shared logic and produces the same result", async () => {
  const repo = await seededPlanRepo("tiki-mark-audited", 61, planFixture(61));
  const r = spawnSync(process.execPath, [MARK_AUDITED, "61"], {
    cwd: repo,
    encoding: "utf-8",
  });
  assert.equal(r.status, 0, `mark-audited failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out).sort(), ["audited", "auditedAt", "issue"]);
  assert.equal(out.issue, 61);
  assert.equal(out.audited, true);

  const plan = await readPlanJson(repo, 61);
  assert.equal(plan.audited, true);
  assert.equal(plan.auditedAt, out.auditedAt);
});
