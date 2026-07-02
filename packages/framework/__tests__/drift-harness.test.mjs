/**
 * Drift harness — framework layer (#302).
 *
 * Golden fixtures live at packages/shared/fixtures/tiki-workspaces/: each
 * fixture is a canonical `.tiki/` tree (`<name>/tiki/**`) plus an
 * `expected.json` declaring what EVERY layer must derive from it. This suite
 * is the framework layer: it drives temp COPIES of the fixtures through the
 * REAL shim surface (state.mjs / plan.mjs / reconcile-state.mjs /
 * migrate-stale-artifacts.mjs) and asserts state.json + plan + journal per
 * step. The desktop vitest layer (driftHarnessFixtures.test.ts) and the cargo
 * layer (drift_harness_tests.rs) consume the SAME trees, so one fixture pins
 * all three implementations to one ground truth.
 *
 * Tests:
 *   1. Fixture conformance — every fixture's tree matches its own
 *      expected.json (state subset, plan phase statuses, journal floor).
 *   2. Pipeline drive — start from a COPY of fresh-get and run the real shim
 *      GET→SHIP; at the mid-EXECUTE checkpoint the live tree must satisfy
 *      mid-execute/expected.json, and after ship teardown it must satisfy
 *      shipped-standalone/expected.json (SC2).
 *   3. Reconciler heal — drift-dropped-transition: reconcile-state.mjs must
 *      advance the entry to MAX(artifact target, journal floor).
 *   4. Migration heal — the three artifact-drift fixtures: run
 *      migrate-stale-artifacts.mjs (offline via --closed-issues-file) and
 *      assert expected.migrate.
 *   5. SC5 mutation meta-test (framework half) — flip one phase status in a
 *      COPY of mid-execute and assert THIS SUITE's own checkers now report
 *      mismatches. The vitest half applies the same mutation to prove a
 *      second layer fails (cross-layer coupling). Never commits a broken
 *      fixture — the mutation only ever exists in a temp copy.
 *
 * node:test runner, Node built-ins only. Run:
 *   node --test packages/framework/__tests__/drift-harness.test.mjs
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJournalEntries, journalFloor } from "../scripts/state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, "..", "scripts");
const STATE = path.join(SCRIPTS, "state.mjs");
const PLAN = path.join(SCRIPTS, "plan.mjs");
const RECONCILE = path.join(SCRIPTS, "reconcile-state.mjs");
const MIGRATE = path.join(SCRIPTS, "migrate-stale-artifacts.mjs");
const FIXTURES = path.join(__dirname, "..", "..", "shared", "fixtures", "tiki-workspaces");

const FIXTURE_NAMES = [
  "fresh-get",
  "mid-execute",
  "shipped-standalone",
  "shipped-release-child",
  "archived-release",
  "drift-dropped-transition",
  "drift-stale-active-plan",
  "drift-stale-active-def",
  "drift-ghost-release",
];

const tempDirs = [];
after(async () => {
  for (const d of tempDirs) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8");
}

function fixtureTiki(name) {
  return path.join(FIXTURES, name, "tiki");
}

function fixtureExpected(name) {
  return readJson(path.join(FIXTURES, name, "expected.json"));
}

/** Copy a fixture's tiki tree into a fresh temp dir; returns the copy's path. */
function copyFixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `tiki-drift-${name}-`));
  tempDirs.push(root);
  const dest = path.join(root, "tiki");
  fs.cpSync(fixtureTiki(name), dest, { recursive: true });
  return dest;
}

/** Run a shim script; asserts exit 0 unless allowFail. Returns the result. */
function run(script, args, { allowFail = false } = {}) {
  const res = spawnSync(process.execPath, [script, ...args], { encoding: "utf-8" });
  if (!allowFail) {
    assert.equal(
      res.status,
      0,
      `${path.basename(script)} ${args.join(" ")} exited ${res.status}\nstderr: ${res.stderr}`
    );
  }
  return res;
}

// ---------------------------------------------------------------------------
// Mismatch collectors. These return string[] instead of throwing so the SC5
// mutation meta-test can assert that the SAME checks used by the green-path
// tests DO fire on a corrupted tree (assert on the array, not on a throw).
// ---------------------------------------------------------------------------

/** Compare a live tiki tree's state.json + journal against expected.state. */
function collectStateMismatches(expectedState, tikiPath) {
  const out = [];
  const stateFile = path.join(tikiPath, "state.json");
  if (!fs.existsSync(stateFile)) {
    return [`state.json missing at ${stateFile}`];
  }
  let state;
  try {
    state = readJson(stateFile);
  } catch (e) {
    return [`state.json unparseable: ${e.message}`];
  }
  const activeWork = state.activeWork || {};

  const expectedEntries = expectedState.activeWork || {};
  const expectedKeys = Object.keys(expectedEntries).sort();
  const actualKeys = Object.keys(activeWork).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    out.push(`activeWork keys: expected [${expectedKeys}], got [${actualKeys}]`);
  }

  for (const [workId, exp] of Object.entries(expectedEntries)) {
    const entry = activeWork[workId];
    if (!entry) continue; // already reported via key mismatch
    if (entry.status !== exp.status) {
      out.push(`${workId}.status: expected ${exp.status}, got ${entry.status}`);
    }
    if (exp.pipelineStep !== undefined && entry.pipelineStep !== exp.pipelineStep) {
      out.push(`${workId}.pipelineStep: expected ${exp.pipelineStep}, got ${entry.pipelineStep}`);
    }
    if (exp.phase === null) {
      if (entry.phase !== undefined) {
        out.push(`${workId}.phase: expected absent, got ${JSON.stringify(entry.phase)}`);
      }
    } else if (exp.phase !== undefined) {
      const got = entry.phase || {};
      if (
        got.current !== exp.phase.current ||
        got.total !== exp.phase.total ||
        got.status !== exp.phase.status
      ) {
        out.push(
          `${workId}.phase: expected ${JSON.stringify(exp.phase)}, got ${JSON.stringify(entry.phase)}`
        );
      }
    }
    if (exp.parentRelease !== undefined && entry.parentRelease !== exp.parentRelease) {
      out.push(
        `${workId}.parentRelease: expected ${exp.parentRelease}, got ${entry.parentRelease}`
      );
    }
  }

  const history = state.history || {};
  const recentNumbers = (history.recentIssues || []).map((r) => r && r.number);
  for (const n of expectedState.historyIssuesInclude || []) {
    if (!recentNumbers.includes(n)) {
      out.push(`history.recentIssues missing #${n} (got ${JSON.stringify(recentNumbers)})`);
    }
  }

  for (const [workId, expectedFloor] of Object.entries(expectedState.journalFloor || {})) {
    const entries = readJournalEntries(tikiPath);
    const floor = journalFloor(entries, workId);
    const got = floor ? floor.step : null;
    if (got !== expectedFloor) {
      out.push(`journal floor for ${workId}: expected ${expectedFloor}, got ${got}`);
    }
  }

  return out;
}

/** Locate a plan file per expected planLocation (active | archive | null). */
function planFileFor(tikiPath, issueNumber, planLocation) {
  const active = path.join(tikiPath, "plans", `issue-${issueNumber}.json`);
  const archived = path.join(tikiPath, "plans", "archive", `issue-${issueNumber}.json`);
  if (planLocation === "active") return active;
  if (planLocation === "archive") return archived;
  return null;
}

/** Compare a plan file's phase statuses + coverage-derived criteria flags. */
function collectPlanMismatches(expectedIssue, tikiPath, issueNumber) {
  const out = [];
  const active = path.join(tikiPath, "plans", `issue-${issueNumber}.json`);
  const archived = path.join(tikiPath, "plans", "archive", `issue-${issueNumber}.json`);

  if (expectedIssue.planLocation === null) {
    if (fs.existsSync(active)) out.push(`unexpected active plan for #${issueNumber}`);
    if (fs.existsSync(archived)) out.push(`unexpected archived plan for #${issueNumber}`);
    return out;
  }

  const file = planFileFor(tikiPath, issueNumber, expectedIssue.planLocation);
  if (!fs.existsSync(file)) {
    return [`plan for #${issueNumber} missing at ${file}`];
  }
  const plan = readJson(file);

  const statuses = (plan.phases || []).map((p) => p.status);
  if (JSON.stringify(statuses) !== JSON.stringify(expectedIssue.planPhaseStatuses)) {
    out.push(
      `#${issueNumber} phase statuses: expected ${JSON.stringify(
        expectedIssue.planPhaseStatuses
      )}, got ${JSON.stringify(statuses)}`
    );
  }

  // Coverage-derived verification (the shared rule plan.mjs verify-criteria
  // ports): verified iff coverage non-empty AND every covering phase completed.
  if (expectedIssue.criteria) {
    const statusByNumber = new Map((plan.phases || []).map((p) => [p.number, p.status]));
    const coverage = plan.coverageMatrix || {};
    const verifiedIds = (plan.successCriteria || [])
      .filter((c) => {
        const covering = coverage[c.id] || [];
        return covering.length > 0 && covering.every((n) => statusByNumber.get(n) === "completed");
      })
      .map((c) => c.id);
    if (JSON.stringify(verifiedIds) !== JSON.stringify(expectedIssue.criteria.verifiedIds)) {
      out.push(
        `#${issueNumber} derived verified criteria: expected ${JSON.stringify(
          expectedIssue.criteria.verifiedIds
        )}, got ${JSON.stringify(verifiedIds)}`
      );
    }
  }

  return out;
}

function assertNoMismatches(mismatches, label) {
  assert.deepEqual(mismatches, [], `${label} drifted from expected.json:\n${mismatches.join("\n")}`);
}

// ---------------------------------------------------------------------------
// 1. Fixture conformance: every checked-in tree matches its own expected.json.
// ---------------------------------------------------------------------------

for (const name of FIXTURE_NAMES) {
  test(`fixture conformance: ${name}`, () => {
    const expected = fixtureExpected(name);
    const tiki = fixtureTiki(name);
    assertNoMismatches(collectStateMismatches(expected.state, tiki), `${name} state`);
    for (const [num, expIssue] of Object.entries(expected.issues || {})) {
      assertNoMismatches(
        collectPlanMismatches(expIssue, tiki, Number(num)),
        `${name} plan #${num}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Pipeline drive (SC2): fresh-get -> mid-execute -> shipped-standalone
//    through the REAL shim, asserting each stage fixture's expectations.
// ---------------------------------------------------------------------------

test("pipeline drive: real shim reproduces the stage fixtures step by step", () => {
  const tiki = copyFixture("fresh-get");
  const tp = ["--tiki-path", tiki];

  assertNoMismatches(
    collectStateMismatches(fixtureExpected("fresh-get").state, tiki),
    "drive@fresh-get"
  );

  // REVIEW
  run(STATE, ["journal", "issue:42", "--step", "REVIEW", ...tp]);
  run(STATE, ["transition", "issue:42", "--to-status", "reviewing", "--to-step", "REVIEW", ...tp]);

  // PLAN — transition + write the plan artifact (plan.md writes the file; the
  // phase/criteria mutations afterwards go through plan.mjs).
  run(STATE, ["journal", "issue:42", "--step", "PLAN", ...tp]);
  run(STATE, [
    "transition", "issue:42", "--to-status", "planning", "--to-step", "PLAN",
    "--phase-current", "1", "--phase-total", "4", "--phase-status", "pending", ...tp,
  ]);
  const midPlan = readJson(path.join(fixtureTiki("mid-execute"), "plans", "issue-42.json"));
  const freshPlan = {
    ...midPlan,
    phases: midPlan.phases.map(({ startedAt, completedAt, summary, ...p }) => ({
      ...p,
      status: "pending",
    })),
    successCriteria: midPlan.successCriteria.map(
      ({ verified, verifiedAt, ...c }) => ({ ...c })
    ),
  };
  delete freshPlan.audited;
  delete freshPlan.auditedAt;
  writeJson(path.join(tiki, "plans", "issue-42.json"), freshPlan);

  // AUDIT
  run(STATE, ["journal", "issue:42", "--step", "AUDIT", ...tp]);
  run(STATE, [
    "transition", "issue:42", "--to-status", "planning", "--to-step", "AUDIT",
    "--phase-current", "1", "--phase-total", "4", "--phase-status", "pending", ...tp,
  ]);
  run(PLAN, ["audited", "42", ...tp]);

  // EXECUTE phase 1 -> completed, then phase 2 starts (the mid-execute stage).
  run(STATE, ["journal", "issue:42", "--step", "EXECUTE", ...tp]);
  run(STATE, [
    "transition", "issue:42", "--to-status", "executing", "--to-step", "EXECUTE",
    "--phase-current", "1", "--phase-total", "4", "--phase-status", "executing", ...tp,
  ]);
  run(PLAN, ["phase", "42", "--number", "1", "--status", "executing",
    "--started-at", "2026-01-10T11:00:00.000Z", ...tp]);
  run(PLAN, ["phase", "42", "--number", "1", "--status", "completed",
    "--completed-at", "2026-01-10T11:30:00.000Z", "--summary", "Scaffolded the widget module.", ...tp]);
  run(PLAN, ["verify-criteria", "42", ...tp]);
  run(STATE, [
    "transition", "issue:42", "--to-status", "executing", "--to-step", "EXECUTE",
    "--phase-current", "2", "--phase-total", "4", "--phase-status", "executing", ...tp,
  ]);
  run(PLAN, ["phase", "42", "--number", "2", "--status", "executing",
    "--started-at", "2026-01-10T11:45:00.000Z", ...tp]);

  // CHECKPOINT: the live tree must satisfy the mid-execute fixture.
  const mid = fixtureExpected("mid-execute");
  assertNoMismatches(collectStateMismatches(mid.state, tiki), "drive@mid-execute state");
  assertNoMismatches(collectPlanMismatches(mid.issues["42"], tiki, 42), "drive@mid-execute plan");

  // Finish phases 2-4, verify criteria after each completion.
  for (const n of [2, 3, 4]) {
    if (n > 2) {
      run(STATE, [
        "transition", "issue:42", "--to-status", "executing", "--to-step", "EXECUTE",
        "--phase-current", String(n), "--phase-total", "4", "--phase-status", "executing", ...tp,
      ]);
      run(PLAN, ["phase", "42", "--number", String(n), "--status", "executing", ...tp]);
    }
    run(PLAN, ["phase", "42", "--number", String(n), "--status", "completed",
      "--completed-at", `2026-01-10T1${n + 1}:00:00.000Z`, ...tp]);
    run(PLAN, ["verify-criteria", "42", ...tp]);
  }

  // SHIP: transition, history append, plan archive move (ship.md teardown),
  // entry removal.
  run(STATE, ["journal", "issue:42", "--step", "SHIP", ...tp]);
  run(STATE, ["transition", "issue:42", "--to-status", "shipping", "--to-step", "SHIP", ...tp]);
  run(STATE, ["append-history", "issue", "--number", "42",
    "--title", "Add drift harness widget", ...tp]);
  fs.mkdirSync(path.join(tiki, "plans", "archive"), { recursive: true });
  fs.renameSync(
    path.join(tiki, "plans", "issue-42.json"),
    path.join(tiki, "plans", "archive", "issue-42.json")
  );
  run(STATE, ["remove", "issue:42", ...tp]);

  // FINAL: the live tree must satisfy the shipped-standalone fixture's state
  // and archived-plan phase statuses. (Stored SC flags are NOT asserted here:
  // the fixture deliberately keeps a human-gated visual SC verified:false,
  // while a fully driven verify-criteria pass flips everything covered.)
  const shipped = fixtureExpected("shipped-standalone");
  assertNoMismatches(collectStateMismatches(shipped.state, tiki), "drive@shipped state");
  const archivedPlan = readJson(path.join(tiki, "plans", "archive", "issue-42.json"));
  assert.deepEqual(
    archivedPlan.phases.map((p) => p.status),
    shipped.issues["42"].planPhaseStatuses,
    "archived plan phases after the drive"
  );
});

// ---------------------------------------------------------------------------
// 3. Reconciler heal (drift-dropped-transition).
// ---------------------------------------------------------------------------

test("reconciler heals a dropped EXECUTE transition to the journal/artifact target", () => {
  const name = "drift-dropped-transition";
  const expected = fixtureExpected(name);
  const tiki = copyFixture(name);

  // Pre-heal: the tree matches the drifted fixture (state stuck at REVIEW).
  assertNoMismatches(collectStateMismatches(expected.state, tiki), `${name} pre-heal`);

  run(RECONCILE, ["--tiki-path", tiki]);

  const healed = readJson(path.join(tiki, "state.json")).activeWork[expected.reconcile.workId];
  assert.ok(healed, `${expected.reconcile.workId} must survive the reconcile pass`);
  assert.equal(healed.status, expected.reconcile.healedStatus);
  assert.equal(healed.pipelineStep, expected.reconcile.healedStep);
  assert.deepEqual(
    { current: healed.phase?.current, total: healed.phase?.total, status: healed.phase?.status },
    expected.reconcile.healedPhase,
    "healed phase must come from the plan artifact"
  );
});

// ---------------------------------------------------------------------------
// 4. Migration heal (the artifact-drift fixtures).
// ---------------------------------------------------------------------------

const MIGRATE_FIXTURES = [
  ["drift-stale-active-plan", []],
  ["drift-stale-active-def", []],
  ["drift-ghost-release", [{ number: 60, title: "Speed up the cold start" }]],
];

for (const [name, closedIssues] of MIGRATE_FIXTURES) {
  test(`migration heals ${name}`, () => {
    const expected = fixtureExpected(name);
    const tiki = copyFixture(name);
    const closedFile = path.join(path.dirname(tiki), "closed.json");
    writeJson(closedFile, closedIssues);

    run(MIGRATE, ["--tiki-path", tiki, "--closed-issues-file", closedFile]);

    const mig = expected.migrate;
    for (const n of mig.archivedPlans) {
      const dest = path.join(tiki, "plans", "archive", `issue-${n}.json`);
      assert.ok(fs.existsSync(dest), `plan #${n} must be archived`);
      assert.ok(
        !fs.existsSync(path.join(tiki, "plans", `issue-${n}.json`)),
        `active plan #${n} must be gone`
      );
      const statuses = readJson(dest).phases.map((p) => p.status);
      assert.deepEqual(
        statuses,
        mig.archivedPlanPhaseStatuses[String(n)],
        `plan #${n} phases must be normalized on archive`
      );
    }
    for (const v of mig.archivedDefs) {
      const dest = path.join(tiki, "releases", "archive", `${v}.json`);
      assert.ok(fs.existsSync(dest), `def ${v} must be archived`);
      assert.ok(
        !fs.existsSync(path.join(tiki, "releases", `${v}.json`)),
        `active def ${v} must be gone`
      );
      assert.equal(readJson(dest).status, "shipped", `${v} status normalized to shipped`);
    }
    for (const ghost of mig.reconstructedDefs) {
      const dest = path.join(tiki, "releases", "archive", `${ghost.version}.json`);
      assert.ok(fs.existsSync(dest), `ghost def ${ghost.version} must be reconstructed`);
      const def = readJson(dest);
      assert.equal(def.status, "shipped");
      assert.equal(def.reconstructed, true);
      assert.deepEqual(
        (def.issues || []).map((i) => i.number),
        ghost.issues,
        `ghost def ${ghost.version} issues recovered from the changelog links`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 5. SC5 mutation meta-test (framework half): a deliberately corrupted COPY
//    must make this suite's own checkers report mismatches. The vitest layer
//    applies the SAME mutation (mid-execute plan phase 1 completed->pending)
//    in memory and fails its derivation assertions — together they prove the
//    fixture couples at least two layers.
// ---------------------------------------------------------------------------

test("SC5: mutated mid-execute copy fails the framework checkers", () => {
  const expected = fixtureExpected("mid-execute");
  const tiki = copyFixture("mid-execute");

  // Green baseline on the untouched copy.
  assertNoMismatches(collectPlanMismatches(expected.issues["42"], tiki, 42), "pre-mutation");

  // THE mutation: flip phase 1 completed -> pending (see the vitest twin in
  // apps/desktop/src/utils/__tests__/driftHarnessFixtures.test.ts).
  const planFile = path.join(tiki, "plans", "issue-42.json");
  const plan = readJson(planFile);
  plan.phases[0].status = "pending";
  writeJson(planFile, plan);

  const mismatches = collectPlanMismatches(expected.issues["42"], tiki, 42);
  assert.ok(
    mismatches.length >= 2,
    `mutation must trip BOTH the phase-status check and the derived-criteria check, got: ${JSON.stringify(mismatches)}`
  );
  assert.ok(
    mismatches.some((m) => m.includes("phase statuses")),
    "phase-status checker must fire"
  );
  assert.ok(
    mismatches.some((m) => m.includes("verified criteria")),
    "derived-criteria checker must fire (SC1 loses its completed covering phase)"
  );
});
