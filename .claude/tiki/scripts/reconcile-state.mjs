#!/usr/bin/env node
/**
 * reconcile-state.mjs — derive pipeline state from on-disk artifacts.
 *
 * Epic #244 / issue #245. Tiki's pipeline tracking has historically been a
 * "report" contract: each /tiki step must remember to run `state.mjs transition`
 * before it. When the LLM forgets (common in long EXECUTE runs / sub-agent
 * dispatch), the desktop kanban freezes mid-pipeline. This reconciler flips the
 * write side to a "reconcile" contract: it RECOMPUTES each active issue's true
 * pipeline step from artifacts the work physically had to produce, so a dropped
 * transition self-heals on the next pass.
 *
 * It is meant to run as a Claude Code `Stop` AND `SubagentStop` hook (see
 * .claude/settings.json) so it fires after every assistant/sub-agent turn —
 * independent of whether the imperative transition ran.
 *
 * SAFETY CONTRACT (every rule here is a fix for a real trap found in design
 * review — do not relax without re-reviewing):
 *
 *   1. activeWork-scoped. ONLY mutates issue entries that ALREADY exist in
 *      state.activeWork. It never scans plan files to CREATE entries — the repo
 *      has ~100 live plan files for long-shipped issues (plan archiving is
 *      dropped as often as transitions), and resurrecting them would flood the
 *      kanban. Early steps (GET→PLAN, before an entry exists) are covered by the
 *      unconditional foreground transitions from #247, not by this reconciler.
 *   2. Advance-only. Never moves an item backward; only forward when artifacts
 *      justify a later step (or more phase progress) than currently recorded.
 *   3. Skips LLM-set / terminal states. Never touches status failed | paused |
 *      completed — those are decisions the artifacts can't override.
 *   4. Completion comes from history, not plan phases. "All phases complete"
 *      does NOT mean shipped (no ship/archive artifact is reliable). The
 *      authoritative done-signal is membership in history.recentIssues.
 *   5. Legality pre-guarded. Every advance is checked with isLegalTransition
 *      BEFORE applyTransition, so applyTransition can never die() and crash the
 *      hook. release:* entries and parentRelease are left untouched.
 *   6. Never blocks. Lenient locking (skip on contention) + a top-level guard so
 *      --quiet always exits 0. A missed pass is harmless; the next turn retries.
 *
 * Usage:
 *   node reconcile-state.mjs [--tiki-path <path>] [--dry-run] [--quiet]
 *
 * Exit codes: always 0 in --quiet (hook mode). Without --quiet: 0 success,
 * 2 on unexpected error (for tests/manual diagnosis).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  resolveTikiPath,
  withStateLock,
  applyTransition,
  isLegalTransition,
} from "./state.mjs";

// Monotonic step ordering — used for the advance-only check.
const STEP_ORDER = { GET: 0, REVIEW: 1, PLAN: 2, AUDIT: 3, EXECUTE: 4, SHIP: 5 };

// Statuses the reconciler must never override (LLM-set or terminal).
const FROZEN_STATUSES = new Set(["failed", "paused", "completed"]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

/** Read + parse state.json defensively (never throws past here). */
function readStateSafe(tikiPath) {
  const stateFile = path.join(tikiPath, "state.json");
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch {
    return null; // corrupt JSON — skip this pass rather than block
  }
}

/** Atomic write (tmp + rename); returns true on success, false on failure. */
function writeStateSafe(tikiPath, state) {
  const stateFile = path.join(tikiPath, "state.json");
  const tmp = stateFile + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmp, stateFile);
    return true;
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return false;
  }
}

function readPlanSafe(tikiPath, number) {
  const planFile = path.join(tikiPath, "plans", `issue-${number}.json`);
  if (!fs.existsSync(planFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(planFile, "utf-8"));
  } catch {
    return null;
  }
}

function inHistory(history, number) {
  if (!history) return false;
  const recent = Array.isArray(history.recentIssues) ? history.recentIssues : [];
  for (const r of recent) {
    if (r && r.number === number) return true;
  }
  return false;
}

/**
 * Derive EXECUTE phase progress from a plan's phase statuses, or null if no
 * phase has started yet. `current` is the phase in flight (or the next one).
 */
function derivePhase(plan) {
  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  const total = phases.length;
  if (total === 0) return null;
  let completed = 0;
  let anyExecuting = false;
  for (const p of phases) {
    if (p && p.status === "completed") completed++;
    else if (p && p.status === "executing") anyExecuting = true;
  }
  if (completed === 0 && !anyExecuting) return null; // execution not started
  const allDone = completed >= total;
  const current = allDone ? total : Math.min(completed + 1, total);
  return { current, total, status: allDone ? "completed" : "executing" };
}

/**
 * The furthest (status, step[, phase]) justified by artifacts for an in-flight
 * issue, or null if nothing is derivable (pre-PLAN — left to #247).
 */
function deriveTarget(plan) {
  if (!plan) return null;
  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  if (phases.length === 0) return null; // plan not really written yet

  const phase = derivePhase(plan);
  if (phase) {
    // EXECUTE: status stays "executing" even when all phases are done — SHIP is
    // only signalled by history membership, never fabricated here.
    return { status: "executing", step: "EXECUTE", phase };
  }
  // Plan exists, no phase started yet. Distinguish AUDIT from PLAN via the
  // audit artifact (plan.audited). Keep status "planning" until a phase runs;
  // only the step marker advances.
  if (plan.audited === true) {
    return { status: "planning", step: "AUDIT" };
  }
  return { status: "planning", step: "PLAN" };
}

/** Structural equality for a { current, total, status } phase (null-safe). */
function phaseEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.current === b.current && a.total === b.total && a.status === b.status;
}

/**
 * Build a recorded-vs-derived report for every issue:* entry in activeWork.
 *
 * PURE / READ-ONLY: reads plan files but never mutates state. This powers the
 * `--print` "reconciler doctor" — a human-readable snapshot of what state.json
 * RECORDS versus what the on-disk artifacts IMPLY, so a dropped /tiki transition
 * (the freeze class from epic #244) is visible at a glance. `drift: true` marks a
 * row the reconciler WOULD advance on its next pass.
 *
 * Mirrors reconcileEntry's decision sources without applying them:
 *   - frozen status (failed | paused | completed) → derived == recorded (the
 *     reconciler never touches these), so drift is false by construction.
 *   - in history → derived is SHIP (completed for a release child, otherwise the
 *     entry would be removed).
 *   - otherwise → deriveTarget(plan); a null target (pre-PLAN) is left as-is.
 */
export function buildReport(state, tikiPath) {
  const rows = [];
  const activeWork = (state && state.activeWork) || {};
  const history = (state && state.history) || {};

  for (const [workId, entry] of Object.entries(activeWork)) {
    if (!workId.startsWith("issue:")) continue;
    if (!entry || entry.type !== "issue" || !entry.issue) continue;
    const number = entry.issue.number;

    const recordedStatus = entry.status ?? null;
    const recordedStep = entry.pipelineStep ?? null;
    const recordedPhase = entry.phase
      ? {
          current: entry.phase.current ?? null,
          total: entry.phase.total ?? null,
          status: entry.phase.status ?? null,
        }
      : null;

    let derivedStatus = recordedStatus;
    let derivedStep = recordedStep;
    let derivedPhase = recordedPhase;
    let note = "";

    if (FROZEN_STATUSES.has(recordedStatus)) {
      note = `frozen (${recordedStatus})`;
    } else if (typeof number === "number" && inHistory(history, number)) {
      derivedStatus = entry.parentRelease ? "completed" : "(shipped → remove)";
      derivedStep = "SHIP";
      derivedPhase = null;
      note = "in history";
    } else {
      const plan = readPlanSafe(tikiPath, number);
      const target = deriveTarget(plan);
      if (target) {
        derivedStatus = target.status;
        derivedStep = target.step;
        derivedPhase = target.phase ?? null;
      } else {
        note = plan ? "plan has no phases" : "no plan (pre-PLAN, see #247)";
      }
    }

    const drift =
      derivedStatus !== recordedStatus ||
      derivedStep !== recordedStep ||
      !phaseEqual(recordedPhase, derivedPhase);

    rows.push({
      workId,
      number,
      recordedStatus,
      recordedStep,
      recordedPhase,
      derivedStatus,
      derivedStep,
      derivedPhase,
      drift,
      note,
    });
  }

  return rows;
}

/** Render one report row's (status, step, phase) triple compactly. */
function fmtCell(status, step, phase) {
  const p = phase ? ` ${phase.current ?? "?"}/${phase.total ?? "?"}` : "";
  return `${status ?? "-"}/${step ?? "-"}${p}`;
}

/** Render buildReport() rows as a human-readable, ASCII-only table. */
export function formatReport(rows) {
  if (!rows || rows.length === 0) {
    return "Reconciler doctor: no active issues to report.";
  }
  const lines = [
    `Reconciler doctor — ${rows.length} active issue${rows.length === 1 ? "" : "s"}`,
    "",
  ];
  for (const r of rows) {
    const marker = r.drift ? "<-- DRIFT" : "ok";
    const noteStr = r.note ? `  [${r.note}]` : "";
    lines.push(
      `  ${r.workId.padEnd(12)} recorded: ${fmtCell(
        r.recordedStatus,
        r.recordedStep,
        r.recordedPhase
      ).padEnd(26)} derived: ${fmtCell(
        r.derivedStatus,
        r.derivedStep,
        r.derivedPhase
      ).padEnd(26)} ${marker}${noteStr}`
    );
  }
  const driftCount = rows.filter((r) => r.drift).length;
  lines.push("");
  lines.push(
    driftCount === 0
      ? "All active issues are in sync with their artifacts."
      : `${driftCount} issue${driftCount === 1 ? "" : "s"} drifted — the reconciler will heal on its next pass.`
  );
  return lines.join("\n");
}

/**
 * Reconcile a single issue entry in place. Returns a small change record or null
 * if nothing changed. Mutates `state` only via guarded applyTransition / delete.
 */
function reconcileEntry(state, workId, entry, history, tikiPath) {
  if (!entry || entry.type !== "issue" || !entry.issue) return null;
  const number = entry.issue.number;
  if (typeof number !== "number") return null;

  const status = entry.status;
  if (FROZEN_STATUSES.has(status)) return null; // never fight failed/paused/completed

  // --- Completion via history (the authoritative done-signal) ---------------
  if (inHistory(history, number)) {
    if (entry.parentRelease) {
      // Release child: should end as completed; the release teardown keeps it.
      if (status !== "completed" && isLegalTransition(status, "completed")) {
        applyTransition(state, {
          workId,
          toStatus: "completed",
          toStep: "SHIP",
          phase: null,
          parallelExecution: null,
          parentRelease: undefined, // preserve
          issue: null,
          release: null,
        });
        return { workId, action: "completed" };
      }
      return null;
    }
    // Standalone & already shipped but lingering in activeWork → remove it, so
    // the display stops showing a stale "executing" for a closed issue.
    delete state.activeWork[workId];
    return { workId, action: "removed" };
  }

  // --- In-flight: advance from artifacts ------------------------------------
  const plan = readPlanSafe(tikiPath, number);
  const target = deriveTarget(plan);
  if (!target) return null;

  const curIdx = STEP_ORDER[entry.pipelineStep] ?? -1;
  const tgtIdx = STEP_ORDER[target.step] ?? -1;

  const stepAdvances = tgtIdx > curIdx;
  const phaseAdvances =
    tgtIdx === curIdx &&
    target.step === "EXECUTE" &&
    target.phase &&
    (target.phase.current > (entry.phase?.current ?? 0) ||
      entry.phase?.status !== target.phase.status);

  if (!stepAdvances && !phaseAdvances) return null;

  // Legality pre-guard so applyTransition can never die() (would crash the hook).
  if (!isLegalTransition(status, target.status)) return null;

  applyTransition(state, {
    workId,
    toStatus: target.status,
    toStep: target.step,
    phase: target.phase ?? null,
    parallelExecution: null,
    parentRelease: undefined, // preserve existing
    issue: null,
    release: null,
  });
  return {
    workId,
    action: stepAdvances ? `advanced to ${target.step}` : `phase ${target.phase.current}/${target.phase.total}`,
  };
}

/**
 * Run one reconcile pass. Returns { changes: [...] } (changes empty if nothing
 * to do or the lock was contended). Writes state.json only when something
 * actually changed (so the watcher isn't churned every turn).
 */
export function reconcile(tikiPath, { dryRun = false } = {}) {
  const result = { changes: [] };

  const pass = () => {
    const state = readStateSafe(tikiPath);
    if (!state || typeof state !== "object") return;
    state.activeWork = state.activeWork || {};
    const history = state.history || {};

    for (const [workId, entry] of Object.entries(state.activeWork)) {
      if (!workId.startsWith("issue:")) continue; // leave release:* untouched
      const change = reconcileEntry(state, workId, entry, history, tikiPath);
      if (change) result.changes.push(change);
    }

    if (!dryRun && result.changes.length > 0) {
      writeStateSafe(tikiPath, state);
    }
  };

  if (dryRun) {
    pass();
  } else {
    // Lenient: a contended lock returns undefined and we simply skip this pass.
    withStateLock(tikiPath, pass, { lenient: true });
  }

  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const quiet = args.quiet === true;
  const dryRun = args["dry-run"] === true;

  try {
    const tikiPath = resolveTikiPath(args["tiki-path"]);

    // --print: read-only "reconciler doctor". Snapshot recorded-vs-derived
    // state and exit WITHOUT reconciling (never mutates state.json).
    if (args.print === true) {
      const state = readStateSafe(tikiPath);
      const rows = state ? buildReport(state, tikiPath) : [];
      process.stdout.write(formatReport(rows) + "\n");
      process.exit(0);
    }

    const result = reconcile(tikiPath, { dryRun });
    if (!quiet) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    }
    process.exit(0);
  } catch (e) {
    // Hook mode must never block the turn; swallow and exit 0.
    if (!quiet) {
      process.stderr.write(`reconcile-state.mjs: ${e.message}\n`);
      process.exit(2);
    }
    process.exit(0);
  }
}

import { fileURLToPath } from "node:url";
const isCliEntry = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
    return entryFile !== null && path.resolve(thisFile) === entryFile;
  } catch {
    return false;
  }
})();

if (isCliEntry) {
  main();
}
