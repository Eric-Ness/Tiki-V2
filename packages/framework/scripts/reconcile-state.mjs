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
