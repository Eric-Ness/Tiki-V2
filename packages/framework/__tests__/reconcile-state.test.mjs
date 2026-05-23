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
import { reconcile, buildReport } from "../scripts/reconcile-state.mjs";

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
  // issue:299 shipped long ago (live plan, all complete) but is not tracked.
  // Only issue:300 is active. The reconciler must not recreate 299.
  const tikiPath = makeTiki(
    { schemaVersion: 1, activeWork: { "issue:300": issueEntry(300, { status: "reviewing", pipelineStep: "REVIEW" }) }, history: {} },
    {
      299: plan(299, ["completed", "completed"], { audited: true }),
      300: plan(300, ["pending"]),
    }
  );
  reconcile(tikiPath);
  const aw = readBack(tikiPath).activeWork;
  assert.equal("issue:299" in aw, false);
  assert.ok("issue:300" in aw);
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
