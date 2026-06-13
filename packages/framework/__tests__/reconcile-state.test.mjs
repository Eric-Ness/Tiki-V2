/**
 * Tests for reconcile-state.mjs (epic #244 / issue #245 + #248).
 *
 * These are RUNTIME assertions: they build fixture .tiki trees and prove the
 * reconciler derives the correct pipeline state from artifacts — including the
 * two traps surfaced in design review (a `failed` item whose artifacts advanced;
 * a stale all-complete plan for a shipped issue) and the drop-resilience case
 * (correct state with ZERO imperative transitions). This closes the gap the
 * prose-only command-transition-coverage test could never cover (the deferred
 * #211 "Phase 4").
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcile, buildReport, findBootstrapCandidates } from "../scripts/reconcile-state.mjs";

function makeTiki(state, plans = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-reconcile-"));
  const tikiPath = path.join(dir, ".tiki");
  fs.mkdirSync(path.join(tikiPath, "plans"), { recursive: true });
  fs.writeFileSync(path.join(tikiPath, "state.json"), JSON.stringify(state, null, 2));
  for (const [num, plan] of Object.entries(plans)) {
    fs.writeFileSync(
      path.join(tikiPath, "plans", `issue-${num}.json`),
      JSON.stringify(plan, null, 2)
    );
  }
  return tikiPath;
}

function readBack(tikiPath) {
  return JSON.parse(fs.readFileSync(path.join(tikiPath, "state.json"), "utf-8"));
}

const issueEntry = (number, over = {}) => ({
  type: "issue",
  issue: { number, title: `Issue ${number}` },
  status: "pending",
  pipelineStep: "GET",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastActivity: "2026-01-01T00:00:00.000Z",
  ...over,
});

const plan = (number, phases, over = {}) => ({
  schemaVersion: 1,
  issue: { number, title: `Issue ${number}` },
  createdAt: "2026-01-01T00:00:00.000Z",
  phases: phases.map((status, i) => ({
    number: i + 1,
    title: `Phase ${i + 1}`,
    status,
    content: "...",
  })),
  ...over,
});

/** ISO timestamp `days` days before now (0 = now). */
const isoAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/** Plan with FRESH timestamps — a bootstrap candidate unless a guard blocks it (#270). */
const makePlan = (number, phases, over = {}) =>
  plan(number, phases, { createdAt: isoAgo(0), updatedAt: isoAgo(0), ...over });

test("advances REVIEW → PLAN when a plan file exists", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:10": issueEntry(10, { status: "reviewing", pipelineStep: "REVIEW" }) }, history: {} },
    { 10: plan(10, ["pending", "pending"]) }
  );
  reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:10"];
  assert.equal(e.status, "planning");
  assert.equal(e.pipelineStep, "PLAN");
});

test("advances PLAN → AUDIT only when plan.audited is true", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:11": issueEntry(11, { status: "planning", pipelineStep: "PLAN" }) }, history: {} },
    { 11: plan(11, ["pending", "pending"], { audited: true }) }
  );
  reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:11"];
  assert.equal(e.pipelineStep, "AUDIT");
  assert.equal(e.status, "planning"); // status stays planning until a phase runs
});

test("derives EXECUTE phase progress from the plan (the freeze the user reported)", () => {
  // Entry frozen at PLAN (its EXECUTE transitions were dropped) but the plan
  // shows phase 1 done, phase 2 running. Reconciler must advance to EXECUTE 2/5.
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:12": issueEntry(12, { status: "planning", pipelineStep: "PLAN" }) }, history: {} },
    { 12: plan(12, ["completed", "executing", "pending", "pending", "pending"], { audited: true }) }
  );
  reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:12"];
  assert.equal(e.status, "executing");
  assert.equal(e.pipelineStep, "EXECUTE");
  assert.deepEqual(e.phase, { current: 2, total: 5, status: "executing" });
});

test("DROP-RESILIENCE: correct EXECUTE state with ZERO imperative transitions after GET", () => {
  // Only the GET entry exists; every later transition was dropped. The plan
  // shows all phases complete. The reconciler must reach EXECUTE 5/5 from
  // artifacts alone — and must NOT fabricate SHIP/completed (no history).
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:13": issueEntry(13) }, history: {} },
    { 13: plan(13, ["completed", "completed", "completed", "completed", "completed"], { audited: true }) }
  );
  reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:13"];
  assert.equal(e.status, "executing");
  assert.equal(e.pipelineStep, "EXECUTE");
  assert.deepEqual(e.phase, { current: 5, total: 5, status: "completed" });
});

test("advances phase progress within EXECUTE", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:14": issueEntry(14, { status: "executing", pipelineStep: "EXECUTE", phase: { current: 1, total: 5, status: "executing" } }) }, history: {} },
    { 14: plan(14, ["completed", "completed", "completed", "executing", "pending"], { audited: true }) }
  );
  reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:14"];
  assert.equal(e.phase.current, 4);
});

test("never moves backward (advance-only)", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:15": issueEntry(15, { status: "executing", pipelineStep: "EXECUTE", phase: { current: 4, total: 5, status: "executing" } }) }, history: {} },
    { 15: plan(15, ["completed", "pending", "pending", "pending", "pending"], { audited: true }) }
  );
  const before = readBack(tikiPath).activeWork["issue:15"];
  const r = reconcile(tikiPath);
  const after = readBack(tikiPath).activeWork["issue:15"];
  assert.equal(after.phase.current, 4); // not pulled back to 2
  assert.equal(r.changes.length, 0);
  assert.equal(before.lastActivity, after.lastActivity);
});

test("TRAP: a `failed` item is never touched even when artifacts advanced", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:16": issueEntry(16, { status: "failed", pipelineStep: "EXECUTE", phase: { current: 2, total: 5, status: "failed" } }) }, history: {} },
    { 16: plan(16, ["completed", "completed", "completed", "completed", "completed"], { audited: true }) }
  );
  const r = reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:16"];
  assert.equal(e.status, "failed");
  assert.equal(r.changes.length, 0);
});

test("TRAP: a `paused` item is never touched", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:17": issueEntry(17, { status: "paused", pipelineStep: "EXECUTE" }) }, history: {} },
    { 17: plan(17, ["completed", "executing", "pending"], { audited: true }) }
  );
  const r = reconcile(tikiPath);
  assert.equal(readBack(tikiPath).activeWork["issue:17"].status, "paused");
  assert.equal(r.changes.length, 0);
});

test("TRAP: a stale all-complete plan for an issue NOT in activeWork is never resurrected", () => {
  // issue:299 shipped long ago (live plan, all complete) but is not tracked,
  // not in history, and not archived — exactly the ~120 stale-plan shape in the
  // dogfood repo. Under the #270 bootstrap rule it must STAY a non-candidate:
  // its timestamps are explicitly OLD (45 days), so the recency guard holds it
  // back. Only issue:300 is active. The reconciler must not recreate 299.
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:300": issueEntry(300, { status: "reviewing", pipelineStep: "REVIEW" }) }, history: {} },
    {
      299: plan(299, ["completed", "completed"], {
        audited: true,
        createdAt: isoAgo(45),
        updatedAt: isoAgo(45),
        auditedAt: isoAgo(45),
      }),
      300: plan(300, ["pending"]),
    }
  );
  const r = reconcile(tikiPath);
  const aw = readBack(tikiPath).activeWork;
  assert.equal("issue:299" in aw, false);
  assert.ok("issue:300" in aw);
  assert.equal(r.changes.some((c) => c.workId === "issue:299"), false);
});

test("completion: standalone issue in history is removed from activeWork", () => {
  const tikiPath = makeTiki(
    {
      schemaVersion: 1,
      activeWork: { "issue:42": issueEntry(42, { status: "executing", pipelineStep: "EXECUTE" }) },
      history: { recentIssues: [{ number: 42, title: "Issue 42", completedAt: "2026-01-02T00:00:00.000Z" }] },
    },
    { 42: plan(42, ["completed"]) }
  );
  const r = reconcile(tikiPath);
  assert.equal("issue:42" in readBack(tikiPath).activeWork, false);
  assert.equal(r.changes[0].action, "removed");
});

test("completion: release child in history becomes completed and keeps parentRelease", () => {
  const tikiPath = makeTiki(
    {
      schemaVersion: 1,
      activeWork: { "issue:43": issueEntry(43, { status: "executing", pipelineStep: "EXECUTE", parentRelease: "v1.0" }) },
      history: { recentIssues: [{ number: 43, title: "Issue 43", completedAt: "2026-01-02T00:00:00.000Z" }] },
    },
    { 43: plan(43, ["completed"]) }
  );
  reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:43"];
  assert.equal(e.status, "completed");
  assert.equal(e.pipelineStep, "SHIP");
  assert.equal(e.parentRelease, "v1.0");
});

test("release:* entries are left untouched", () => {
  const releaseEntry = {
    type: "release",
    release: { version: "v1.0", issues: [50], completedIssues: [] },
    status: "executing",
    pipelineStep: "EXECUTE",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActivity: "2026-01-01T00:00:00.000Z",
  };
  const tikiPath = makeTiki({ schemaVersion: 1, activeWork: { "release:v1.0": releaseEntry }, history: {} });
  const r = reconcile(tikiPath);
  assert.equal(r.changes.length, 0);
  assert.deepEqual(readBack(tikiPath).activeWork["release:v1.0"], releaseEntry);
});

test("no plan file → pre-PLAN entry is left alone (covered by foreground #247)", () => {
  const tikiPath = makeTiki({
    schemaVersion: 1,
    activeWork: { "issue:18": issueEntry(18, { status: "reviewing", pipelineStep: "REVIEW" }) },
    history: {},
  });
  const r = reconcile(tikiPath);
  assert.equal(r.changes.length, 0);
  assert.equal(readBack(tikiPath).activeWork["issue:18"].pipelineStep, "REVIEW");
});

test("--dry-run computes changes without writing", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:19": issueEntry(19, { status: "reviewing", pipelineStep: "REVIEW" }) }, history: {} },
    { 19: plan(19, ["pending"]) }
  );
  const r = reconcile(tikiPath, { dryRun: true });
  assert.equal(r.changes.length, 1);
  // Disk unchanged.
  assert.equal(readBack(tikiPath).activeWork["issue:19"].pipelineStep, "REVIEW");
});

test("--print report: flags drift and is strictly read-only (issue #253)", () => {
  // issue:50 recorded at EXECUTE 1/3 (its phase-2 transition was dropped), but
  // the plan artifact shows phase 2 in flight. issue:51 is in sync at 2/3.
  const tikiPath = makeTiki(
    {
      schemaVersion: 1,
      activeWork: {
        "issue:50": issueEntry(50, { status: "executing", pipelineStep: "EXECUTE", phase: { current: 1, total: 3, status: "executing" } }),
        "issue:51": issueEntry(51, { status: "executing", pipelineStep: "EXECUTE", phase: { current: 2, total: 3, status: "executing" } }),
      },
      history: {},
    },
    {
      50: plan(50, ["completed", "executing", "pending"], { audited: true }),
      51: plan(51, ["completed", "executing", "pending"], { audited: true }),
    }
  );

  const before = fs.readFileSync(path.join(tikiPath, "state.json"), "utf-8");
  const rows = buildReport(readBack(tikiPath), tikiPath);
  const after = fs.readFileSync(path.join(tikiPath, "state.json"), "utf-8");

  // Read-only: buildReport must not touch state.json on disk.
  assert.equal(before, after);

  const r50 = rows.find((x) => x.workId === "issue:50");
  const r51 = rows.find((x) => x.workId === "issue:51");

  // Drift detected for the dropped-transition entry, with the artifact-derived target.
  assert.equal(r50.drift, true);
  assert.equal(r50.recordedPhase.current, 1);
  assert.equal(r50.derivedStep, "EXECUTE");
  assert.equal(r50.derivedPhase.current, 2);

  // In-sync entry is not flagged.
  assert.equal(r51.drift, false);
  assert.equal(r51.derivedPhase.current, 2);
});

test("--print report: a frozen (paused) entry is reported in-sync, never as drift", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:60": issueEntry(60, { status: "paused", pipelineStep: "EXECUTE", phase: { current: 1, total: 3, status: "executing" } }) }, history: {} },
    { 60: plan(60, ["completed", "completed", "completed"], { audited: true }) }
  );
  const rows = buildReport(readBack(tikiPath), tikiPath);
  const r = rows.find((x) => x.workId === "issue:60");
  assert.equal(r.drift, false); // reconciler never touches paused → doctor shows no actionable drift
  assert.match(r.note, /frozen/);
});

// ---------------------------------------------------------------------------
// Bootstrap rule (#270, contract rule 1a): a RECENT plan with no activeWork
// entry, not in history, and not archived gets an entry created — with five
// guards each pinned by its own TRAP test below.
// ---------------------------------------------------------------------------

test("BOOTSTRAP: recent audited plan with no entry creates issue:N at planning/AUDIT", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: {}, history: {} },
    { 70: makePlan(70, ["pending", "pending"], { audited: true, auditedAt: isoAgo(0) }) }
  );
  const r = reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:70"];
  assert.ok(e, "entry was created");
  assert.equal(e.type, "issue");
  assert.deepEqual(e.issue, { number: 70, title: "Issue 70" });
  assert.equal(e.status, "planning");
  assert.equal(e.pipelineStep, "AUDIT");
  assert.deepEqual(r.changes, [{ workId: "issue:70", action: "bootstrapped at AUDIT" }]);
});

test("BOOTSTRAP: recent plan with phase progress creates executing/EXECUTE with phase", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: {}, history: {} },
    { 71: makePlan(71, ["completed", "executing", "pending"], { audited: true }) }
  );
  const r = reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:71"];
  assert.equal(e.status, "executing");
  assert.equal(e.pipelineStep, "EXECUTE");
  assert.deepEqual(e.phase, { current: 2, total: 3, status: "executing" });
  assert.deepEqual(r.changes, [{ workId: "issue:71", action: "bootstrapped at EXECUTE" }]);
});

test("BOOTSTRAP: recent plan with phases [] creates planning/PLAN (fallback past deriveTarget null)", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: {}, history: {} },
    { 72: makePlan(72, []) }
  );
  const r = reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:72"];
  assert.equal(e.status, "planning");
  assert.equal(e.pipelineStep, "PLAN");
  assert.deepEqual(r.changes, [{ workId: "issue:72", action: "bootstrapped at PLAN" }]);
});

test("BOOTSTRAP TRAP: an archived copy means shipped — never created, even with a recent active plan", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: {}, history: {} },
    { 73: makePlan(73, ["completed", "completed"], { audited: true }) }
  );
  const archiveDir = path.join(tikiPath, "plans", "archive");
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, "issue-73.json"),
    JSON.stringify(makePlan(73, ["completed", "completed"], { audited: true }))
  );
  const r = reconcile(tikiPath);
  assert.equal("issue:73" in readBack(tikiPath).activeWork, false);
  assert.equal(r.changes.length, 0);
});

test("BOOTSTRAP TRAP: an issue in history.recentIssues is never created", () => {
  const tikiPath = makeTiki(
    {
      schemaVersion: 1,
      activeWork: {},
      history: { recentIssues: [{ number: 74, title: "Issue 74", completedAt: isoAgo(1) }] },
    },
    { 74: makePlan(74, ["completed"], { audited: true }) }
  );
  const r = reconcile(tikiPath);
  assert.equal("issue:74" in readBack(tikiPath).activeWork, false);
  assert.equal(r.changes.length, 0);
});

test("BOOTSTRAP TRAP: all timestamps 30 days old → not recent, never created", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: {}, history: {} },
    {
      75: makePlan(75, ["pending"], {
        audited: true,
        createdAt: isoAgo(30),
        updatedAt: isoAgo(30),
        auditedAt: isoAgo(30),
      }),
    }
  );
  const r = reconcile(tikiPath);
  assert.equal("issue:75" in readBack(tikiPath).activeWork, false);
  assert.equal(r.changes.length, 0);
});

test("BOOTSTRAP TRAP: corrupt plan JSON is never created", () => {
  const tikiPath = makeTiki({ schemaVersion: 1, activeWork: {}, history: {} });
  fs.writeFileSync(path.join(tikiPath, "plans", "issue-76.json"), "{ this is not json !!!");
  const r = reconcile(tikiPath);
  assert.equal("issue:76" in readBack(tikiPath).activeWork, false);
  assert.equal(r.changes.length, 0);
});

test("BOOTSTRAP TRAP: filename/content number mismatch (issue-7.json says number 8) is never created", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: {}, history: {} },
    { 7: makePlan(8, ["pending"]) } // written to plans/issue-7.json, claims issue 8
  );
  const r = reconcile(tikiPath);
  const aw = readBack(tikiPath).activeWork;
  assert.equal("issue:7" in aw, false);
  assert.equal("issue:8" in aw, false);
  assert.equal(r.changes.length, 0);
});

test("BOOTSTRAP no-op: an existing activeWork entry is left to reconcileEntry (no duplicate change records)", () => {
  // Entry already tracked AND in sync with its (recent) plan — bootstrap must
  // not touch it, and the pass must produce zero changes (not a duplicate).
  const entry = issueEntry(77, {
    status: "executing",
    pipelineStep: "EXECUTE",
    phase: { current: 2, total: 3, status: "executing" },
  });
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:77": entry }, history: {} },
    { 77: makePlan(77, ["completed", "executing", "pending"], { audited: true }) }
  );
  const r = reconcile(tikiPath);
  const e = readBack(tikiPath).activeWork["issue:77"];
  assert.equal(r.changes.length, 0);
  assert.equal(e.lastActivity, entry.lastActivity); // untouched
  assert.equal(e.createdAt, entry.createdAt);
});

test("BOOTSTRAP: --dry-run computes the bootstrap change but does not write", () => {
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: {}, history: {} },
    { 78: makePlan(78, ["pending"], { audited: true }) }
  );
  const r = reconcile(tikiPath, { dryRun: true });
  assert.deepEqual(r.changes, [{ workId: "issue:78", action: "bootstrapped at AUDIT" }]);
  // Disk unchanged.
  assert.equal("issue:78" in readBack(tikiPath).activeWork, false);
});

test("BOOTSTRAP unit: findBootstrapCandidates tolerates a missing plans dir and derives targets", () => {
  // Missing plans dir → [].
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-noplans-"));
  assert.deepEqual(findBootstrapCandidates({ activeWork: {}, history: {} }, emptyDir, Date.now()), []);

  // Candidate record shape, with a pinned `now` just inside the 14-day window.
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: {}, history: {} },
    { 79: makePlan(79, ["pending"], { createdAt: isoAgo(13), updatedAt: isoAgo(13) }) }
  );
  const state = readBack(tikiPath);
  const cands = findBootstrapCandidates(state, tikiPath, Date.now());
  assert.equal(cands.length, 1);
  assert.equal(cands[0].workId, "issue:79");
  assert.equal(cands[0].number, 79);
  assert.deepEqual(cands[0].target, { status: "planning", step: "PLAN" });

  // Same fixture viewed from 15 days later → outside the window, no candidates.
  const later = Date.now() + 15 * 24 * 60 * 60 * 1000;
  assert.deepEqual(findBootstrapCandidates(state, tikiPath, later), []);
});

test("--print report: a fresh bootstrap candidate appears as a 'would create' row, read-only (#270)", () => {
  // One tracked entry (in sync) + one fresh orphan plan with phase progress.
  const tikiPath = makeTiki(
    {
      schemaVersion: 1,
      activeWork: {
        "issue:80": issueEntry(80, { status: "executing", pipelineStep: "EXECUTE", phase: { current: 2, total: 3, status: "executing" } }),
      },
      history: {},
    },
    {
      80: makePlan(80, ["completed", "executing", "pending"], { audited: true }),
      81: makePlan(81, ["completed", "executing", "pending"], { audited: true }),
    }
  );

  const before = fs.readFileSync(path.join(tikiPath, "state.json"), "utf-8");
  const rows = buildReport(readBack(tikiPath), tikiPath);
  const after = fs.readFileSync(path.join(tikiPath, "state.json"), "utf-8");

  // Read-only: --print must not touch state.json on disk.
  assert.equal(before, after);
  assert.equal("issue:81" in readBack(tikiPath).activeWork, false);

  const r81 = rows.find((x) => x.workId === "issue:81");
  assert.ok(r81, "bootstrap candidate row present");
  assert.equal(r81.number, 81);
  assert.equal(r81.recordedStatus, null);
  assert.equal(r81.recordedStep, null);
  assert.equal(r81.recordedPhase, null);
  assert.equal(r81.derivedStatus, "executing");
  assert.equal(r81.derivedStep, "EXECUTE");
  assert.deepEqual(r81.derivedPhase, { current: 2, total: 3, status: "executing" });
  assert.equal(r81.drift, true);
  assert.equal(r81.note, "would create (bootstrap #270)");

  // The tracked, in-sync entry is unaffected by the bootstrap mirror.
  const r80 = rows.find((x) => x.workId === "issue:80");
  assert.equal(r80.drift, false);
});

test("--print report: excluded orphan plans (stale / archived / in-history) yield NO bootstrap rows", () => {
  // 82: stale (30 days old). 83: archived copy exists. 84: in history.
  const tikiPath = makeTiki(
    {
      schemaVersion: 1,
      activeWork: {},
      history: { recentIssues: [{ number: 84, title: "Issue 84", completedAt: isoAgo(1) }] },
    },
    {
      82: makePlan(82, ["pending"], { createdAt: isoAgo(30), updatedAt: isoAgo(30) }),
      83: makePlan(83, ["completed"], { audited: true }),
      84: makePlan(84, ["completed"], { audited: true }),
    }
  );
  const archiveDir = path.join(tikiPath, "plans", "archive");
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, "issue-83.json"),
    JSON.stringify(makePlan(83, ["completed"], { audited: true }))
  );

  const rows = buildReport(readBack(tikiPath), tikiPath);
  assert.equal(rows.length, 0);
  assert.equal(rows.some((r) => /would create/.test(r.note ?? "")), false);
});
