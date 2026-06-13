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
 *      has ~120 stale ACTIVE plan files for long-shipped issues (plan archiving is
 *      dropped as often as transitions), and resurrecting them would flood the
 *      kanban. Early steps (GET→PLAN, before an entry exists) are covered by the
 *      unconditional foreground transitions from #247, not by this reconciler.
 *      1a. AMENDMENT (#270): a NARROW bootstrap exception exists for the case
 *          where the entry itself is what got dropped (e.g. a plugin-only
 *          install whose state.mjs path is dead, so GET never created the
 *          entry). findBootstrapCandidates() may create issue:N entries from
 *          plan files, but ONLY when ALL FIVE guards pass, in order:
 *            (1) no issue:N entry already in activeWork — never clobber a
 *                tracked entry;
 *            (2) N not in history.recentIssues — but history only reaches back
 *                to #149 (~52 issues), so this guard ALONE cannot fence off
 *                the ~120 older stale plans;
 *            (3) no plans/archive/issue-N.json — archive presence means the
 *                issue shipped, even where history predates the record;
 *            (4) plan is RECENT: newest of the plan JSON's createdAt /
 *                updatedAt / auditedAt within BOOTSTRAP_RECENCY_MS (14 days)
 *                of now. JSON timestamps ONLY, never file mtime (git clone /
 *                checkout resets mtime → a fresh clone would flood). A plan
 *                with no parseable timestamp is NOT recent. This is the guard
 *                that actually holds back the ~70 stale plans guards 2+3 miss:
 *                a legit bootstrap case has a recently written plan, a
 *                weeks-stale dropped entry is an accepted miss.
 *            (5) plan parses and plan.issue.number matches the filename —
 *                a mismatch means a corrupt/hand-mangled file, never trust it.
 *   2. Advance-only. Never moves an item backward; only forward when artifacts
 *      justify a later step (or more phase progress) than currently recorded.
 *   3. Skips LLM-set / terminal states. Never touches status failed | paused |
 *      completed — those are decisions the artifacts can't override.
 *   4. Completion comes from history, not plan phases. "All phases complete"
 *      does NOT mean shipped (no ship/archive artifact is reliable). The
 *      authoritative done-signal is membership in history.recentIssues.
 *      4a. AMENDMENT (#271): completion may ALSO be derived from the PAIR of
 *          ship signals: plans/archive/issue-N.json exists AND GitHub reports
 *          the issue CLOSED. Both are required — the archive alone can linger
 *          past a reopen, and closed-without-archive means ship's teardown
 *          never ran (that's #247 foreground territory). gh BUDGET RULE: the
 *          gh fetcher is invoked ONLY for entries that are already ship-shaped
 *          (not frozen, not in history, archived plan present), so normal
 *          in-flight passes make ZERO gh calls and the Stop hook stays fast.
 *          DEGRADE SILENTLY: any fetcher failure (no gh, offline, non-zero,
 *          parse error, timeout) yields null → no change (see rule 6). The
 *          fetcher is injectable for tests and --print via
 *          reconcile(tikiPath, { fetchIssueState }).
 *   5. Legality pre-guarded. Every advance is checked with isLegalTransition
 *      BEFORE applyTransition, so applyTransition can never die() and crash the
 *      hook. parentRelease is always preserved.
 *      5a. AMENDMENT (#271): release:* entries are no longer skipped wholesale —
 *          they get TEARDOWN-ONLY reconciliation (reconcileReleaseEntry):
 *          (a) version already in history.recentReleases → the entry is a
 *              lingering leftover of a dropped teardown → removed;
 *          (b) NOT in history but the release def is archived at
 *              releases/archive/<version>.json (v-prefix variance tolerated,
 *              mirroring check-release-readiness.mjs) → reconstruct the release
 *              history record (issues from the archived def, tag = version,
 *              idempotent filter+unshift) and remove the entry;
 *          (c) anything else is in flight → untouched. No release PROGRESS is
 *          ever healed (advance-only semantics for releases deferred), and
 *          FROZEN_STATUSES applies to releases too.
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
import { spawnSync } from "node:child_process";
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

// Bootstrap recency window (#270, contract rule 1a guard 4): a plan whose
// newest JSON timestamp is older than this is never bootstrapped.
export const BOOTSTRAP_RECENCY_MS = 14 * 24 * 60 * 60 * 1000;

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

/** On-disk ship signal (#271 / contract 4a, also bootstrap guard 3). */
function hasArchivedPlan(tikiPath, number) {
  return fs.existsSync(path.join(tikiPath, "plans", "archive", `issue-${number}.json`));
}

/**
 * Default issue-state fetcher (#271, contract amendment 4a): asks the gh CLI
 * whether the issue is open or closed. Returns "OPEN" | "CLOSED" | null and
 * NEVER throws — any failure (gh missing, offline, non-zero exit, timeout,
 * parse error) degrades to null so the hook can never block (rule 6).
 * Injectable via reconcile(tikiPath, { fetchIssueState }) for tests/--print.
 */
export function fetchIssueStateViaGh(number) {
  try {
    const res = spawnSync("gh", ["issue", "view", String(number), "--json", "state"], {
      shell: process.platform === "win32", // PATHEXT resolution for gh.exe shims
      timeout: 5000,
      encoding: "utf-8",
    });
    if (res.error || res.status !== 0) return null;
    const parsed = JSON.parse(res.stdout);
    const s = typeof parsed.state === "string" ? parsed.state.toUpperCase() : null;
    return s === "OPEN" || s === "CLOSED" ? s : null;
  } catch {
    return null;
  }
}

/**
 * Idempotent history append for ship-derivation. state.mjs does not export its
 * append-history internals, so this mirrors the same shape: any prior record
 * for the same number is dropped, the fresh record is unshifted to the front.
 * Mutates `history` (the live state.history object) in place.
 */
function appendShipHistoryRecord(history, record) {
  const prior = Array.isArray(history.recentIssues) ? history.recentIssues : [];
  history.recentIssues = [record, ...prior.filter((r) => !(r && r.number === record.number))];
}

/** The history record shape state.mjs would have written on a real ship. */
function shipHistoryRecord(entry, number) {
  return {
    number,
    title: entry.issue.title,
    completedAt: new Date().toISOString(),
    ...(entry.parentRelease ? { parentRelease: entry.parentRelease } : {}),
  };
}

function inReleaseHistory(history, version) {
  if (!history) return false;
  const recent = Array.isArray(history.recentReleases) ? history.recentReleases : [];
  for (const r of recent) {
    if (r && r.version === version) return true;
  }
  return false;
}

/**
 * Archived release-def lookup (#271, contract amendment 5a case b). Def files
 * historically live with OR without the leading 'v' (releases/v1.2.json vs
 * releases/1.2.json) — check the version as-recorded AND the v-toggled variant,
 * mirroring check-release-readiness.mjs. Returns the file path or null.
 */
function findArchivedReleaseDefFile(tikiPath, version) {
  const toggled = version.startsWith("v") ? version.slice(1) : `v${version}`;
  for (const name of [version, toggled]) {
    const file = path.join(tikiPath, "releases", "archive", `${name}.json`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/**
 * Idempotent release history append — mirrors state.mjs append-history release
 * (filter any prior record for the same version, unshift the fresh record).
 * Mutates `history` (the live state.history object) in place.
 */
function appendReleaseHistoryRecord(history, record) {
  const prior = Array.isArray(history.recentReleases) ? history.recentReleases : [];
  history.recentReleases = [record, ...prior.filter((r) => !(r && r.version === record.version))];
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

/** Newest parseable plan JSON timestamp (epoch ms), or null if none parse. */
function newestPlanTimestamp(plan) {
  let newest = null;
  for (const key of ["createdAt", "updatedAt", "auditedAt"]) {
    const t = Date.parse(plan?.[key]);
    if (!Number.isNaN(t) && (newest === null || t > newest)) newest = t;
  }
  return newest;
}

/**
 * Scan <tikiPath>/plans for issue plans that justify CREATING an activeWork
 * entry (#270 — contract rule 1a). Returns candidate records
 * { workId, number, plan, target }; applies the five 1a guards IN ORDER and
 * never mutates state. `now` is epoch ms (callers pass Date.now(); tests pin it).
 */
export function findBootstrapCandidates(state, tikiPath, now) {
  const candidates = [];
  const plansDir = path.join(tikiPath, "plans");

  let entries;
  try {
    entries = fs.readdirSync(plansDir);
  } catch {
    return []; // no plans dir — nothing to bootstrap
  }

  const activeWork = (state && state.activeWork) || {};
  const history = (state && state.history) || {};

  for (const name of entries) {
    const m = /^issue-(\d+)\.json$/.exec(name);
    if (!m) continue; // skips the archive/ subdir and any non-plan files
    const number = Number(m[1]);
    const workId = `issue:${number}`;

    // Guard 1: never clobber an entry that already exists.
    if (activeWork[workId]) continue;
    // Guard 2: already shipped per history.
    if (inHistory(history, number)) continue;
    // Guard 3: archived copy = shipped, even where history predates the record.
    if (hasArchivedPlan(tikiPath, number)) continue;

    // Guard 5 (parse) is needed before guard 4 can read timestamps.
    const plan = readPlanSafe(tikiPath, number);
    if (!plan) continue; // missing or corrupt JSON

    // Guard 4: recency from plan JSON timestamps ONLY (never file mtime —
    // git clone/checkout resets mtime and would flood a fresh clone).
    const newest = newestPlanTimestamp(plan);
    if (newest === null || now - newest > BOOTSTRAP_RECENCY_MS) continue;

    // Guard 5 (rest): filename/content mismatch = corrupt, never trust it.
    if (plan.issue?.number !== number) continue;

    // A phases-empty plan is still a PLAN artifact — fall back to PLAN.
    const target = deriveTarget(plan) ?? { status: "planning", step: "PLAN" };
    candidates.push({ workId, number, plan, target });
  }

  return candidates;
}

/** Structural equality for a { current, total, status } phase (null-safe). */
function phaseEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.current === b.current && a.total === b.total && a.status === b.status;
}

/**
 * Read-only report row for a release:* entry (#271) — mirrors
 * reconcileReleaseEntry's verdict without applying it. Returns null for
 * malformed entries (which the reconciler also skips).
 */
function buildReleaseRow(workId, entry, history, tikiPath) {
  if (!entry || entry.type !== "release") return null;

  const recordedStatus = entry.status ?? null;
  const recordedStep = entry.pipelineStep ?? null;
  const version = entry.release?.version;

  let derivedStatus = recordedStatus;
  let derivedStep = recordedStep;
  let note = "";

  if (FROZEN_STATUSES.has(recordedStatus)) {
    note = `frozen (${recordedStatus})`;
  } else if (typeof version !== "string" || version === "") {
    note = "no version recorded";
  } else if (inReleaseHistory(history, version)) {
    derivedStatus = "(shipped → remove)";
    derivedStep = "SHIP";
    note = "in release history";
  } else if (findArchivedReleaseDefFile(tikiPath, version)) {
    derivedStatus = "(shipped → remove)";
    derivedStep = "SHIP";
    note = "archived release def";
  } else {
    note = "release in flight";
  }

  const drift = derivedStatus !== recordedStatus || derivedStep !== recordedStep;

  return {
    workId,
    number: null,
    recordedStatus,
    recordedStep,
    recordedPhase: null,
    derivedStatus,
    derivedStep,
    derivedPhase: null,
    drift,
    note,
  };
}

/**
 * Build a recorded-vs-derived report for every issue:* and release:* entry in
 * activeWork.
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
 *   - ship-shaped (#271: archived plan, not in history) → IF a fetcher was
 *     injected via `options.fetchIssueState` AND it reports CLOSED, derived is
 *     the ship-derivation verdict; a missing fetcher or an OPEN/null answer
 *     keeps the row in-sync with an explanatory note — drift is NEVER
 *     fabricated from an unconfirmable signal (SC5). There is deliberately NO
 *     default fetcher here: only --print (main) passes fetchIssueStateViaGh,
 *     so programmatic buildReport callers stay gh-free.
 *   - otherwise → deriveTarget(plan); a null target (pre-PLAN) is left as-is.
 *
 * Release rows (#271, amendment 5a) mirror reconcileReleaseEntry: recorded
 * triple as-is; derived shows the teardown verdict when the version is in
 * history.recentReleases or the def is archived, else derived == recorded.
 *
 * Also appends one "would create (bootstrap #270)" row per bootstrap candidate
 * (recorded -/- since no entry exists yet) so --print previews entry creation.
 */
export function buildReport(state, tikiPath, { fetchIssueState = null } = {}) {
  const rows = [];
  const activeWork = (state && state.activeWork) || {};
  const history = (state && state.history) || {};

  for (const [workId, entry] of Object.entries(activeWork)) {
    if (workId.startsWith("release:")) {
      const row = buildReleaseRow(workId, entry, history, tikiPath);
      if (row) rows.push(row);
      continue;
    }
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
    } else if (typeof number === "number" && hasArchivedPlan(tikiPath, number)) {
      // Ship-shaped (#271): the fetcher is only consulted HERE (gh budget rule).
      let ghState = null;
      if (typeof fetchIssueState === "function") {
        try {
          ghState = fetchIssueState(number);
        } catch {
          ghState = null; // degrade silently, like the reconcile pass
        }
      }
      if (ghState === "CLOSED") {
        derivedStatus = entry.parentRelease ? "completed" : "(ship-derived → remove)";
        derivedStep = "SHIP";
        derivedPhase = null;
        note = "archived plan; gh closed";
      } else {
        // Fetcher absent, failed, or the issue is genuinely open: the ship
        // signal is unconfirmed — stay in-sync, never fabricate drift (SC5).
        note = "archived plan; gh unavailable/open";
      }
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

  // Mirror the bootstrap rule (#270): plans that WOULD create an entry on the
  // next real pass show up in the doctor as "would create" rows. Read-only —
  // findBootstrapCandidates never mutates state.
  for (const c of findBootstrapCandidates(state, tikiPath, Date.now())) {
    rows.push({
      workId: c.workId,
      number: c.number,
      recordedStatus: null,
      recordedStep: null,
      recordedPhase: null,
      derivedStatus: c.target.status,
      derivedStep: c.target.step,
      derivedPhase: c.target.phase ?? null,
      drift: true,
      note: "would create (bootstrap #270)",
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
    return "Reconciler doctor: no active entries to report.";
  }
  const lines = [
    `Reconciler doctor — ${rows.length} active entr${rows.length === 1 ? "y" : "ies"}`,
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
      ? "All active entries are in sync with their artifacts."
      : `${driftCount} entr${driftCount === 1 ? "y" : "ies"} drifted — the reconciler will heal on its next pass.`
  );
  return lines.join("\n");
}

/**
 * Reconcile a single issue entry in place. Returns a small change record or null
 * if nothing changed. Mutates `state` only via guarded applyTransition / delete.
 * Ordering is contractual: history check FIRST (rule 4), then ship-derivation
 * (amendment 4a), then the in-flight artifact advance — an entry healed by
 * ship-derivation returns immediately and is never also advanced.
 */
function reconcileEntry(state, workId, entry, history, tikiPath, fetchIssueState) {
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

  // --- Ship-derivation (#271, contract amendment 4a) -------------------------
  // Not frozen, not in history. The archived plan is the on-disk ship signal;
  // gh confirms the issue actually closed (the archive alone can linger past a
  // reopen). BUDGET RULE: the fetcher only runs PAST the archive check, so a
  // normal in-flight pass makes zero gh calls.
  if (hasArchivedPlan(tikiPath, number)) {
    let ghState = null;
    try {
      ghState = typeof fetchIssueState === "function" ? fetchIssueState(number) : null;
    } catch {
      ghState = null; // degrade silently (rule 6)
    }
    if (ghState === "CLOSED") {
      if (entry.parentRelease) {
        // Release child: keep the entry for the release teardown, mark it done.
        // Legality pre-guard so applyTransition can never die() (rule 5).
        if (status !== "completed" && isLegalTransition(status, "completed")) {
          appendShipHistoryRecord(history, shipHistoryRecord(entry, number));
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
          return { workId, action: "ship-derived: completed" };
        }
        return null; // illegal from here — leave it alone, never crash the hook
      }
      // Standalone: record the ship in history, drop the lingering entry.
      appendShipHistoryRecord(history, shipHistoryRecord(entry, number));
      delete state.activeWork[workId];
      return { workId, action: "ship-derived: removed" };
    }
    // "OPEN" or null (gh unavailable/failed): no ship change — fall through to
    // the in-flight advance (a genuinely reopened issue is in flight again).
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
 * Reconcile a single release entry in place (#271, contract amendment 5a).
 * TEARDOWN-ONLY: (a) version already in history.recentReleases → remove the
 * lingering entry; (b) def archived but the history append was dropped →
 * reconstruct the release history record from the archived def, then remove;
 * (c) in-flight → untouched (no release progress healing). Returns a change
 * record or null.
 */
function reconcileReleaseEntry(state, workId, entry, history, tikiPath) {
  if (!entry || entry.type !== "release") return null;
  if (FROZEN_STATUSES.has(entry.status)) return null; // frozen releases too
  const version = entry.release?.version;
  if (typeof version !== "string" || version === "") return null;

  // (a) Already in history — the teardown ran but the entry deletion dropped.
  if (inReleaseHistory(history, version)) {
    delete state.activeWork[workId];
    return { workId, action: "release: removed (in history)" };
  }

  // (b) Def archived (the on-disk ship signal for releases) but history record
  // missing — reconstruct it, then drop the entry.
  const defFile = findArchivedReleaseDefFile(tikiPath, version);
  if (defFile) {
    let def = null;
    try {
      def = JSON.parse(fs.readFileSync(defFile, "utf-8"));
    } catch {
      def = null; // corrupt def — fall back to the entry's own issue list
    }
    appendReleaseHistoryRecord(history, {
      version,
      issues: def?.issues ?? entry.release?.issues ?? [],
      completedAt: new Date().toISOString(),
      tag: version,
    });
    delete state.activeWork[workId];
    return { workId, action: "release: torn down (archived def)" };
  }

  // (c) In-flight release — left alone.
  return null;
}

/**
 * Run one reconcile pass. Returns { changes: [...] } (changes empty if nothing
 * to do or the lock was contended). Writes state.json only when something
 * actually changed (so the watcher isn't churned every turn).
 */
export function reconcile(tikiPath, { dryRun = false, fetchIssueState = fetchIssueStateViaGh } = {}) {
  const result = { changes: [] };

  const pass = () => {
    const state = readStateSafe(tikiPath);
    if (!state || typeof state !== "object") return;
    state.activeWork = state.activeWork || {};
    // Attach history to the state object so ship-derivation appends (#271)
    // land in the same object that gets written back.
    state.history = state.history || {};
    const history = state.history;

    for (const [workId, entry] of Object.entries(state.activeWork)) {
      if (workId.startsWith("issue:")) {
        const change = reconcileEntry(state, workId, entry, history, tikiPath, fetchIssueState);
        if (change) result.changes.push(change);
      } else if (workId.startsWith("release:")) {
        // Teardown-only release reconciliation (#271, contract amendment 5a).
        const change = reconcileReleaseEntry(state, workId, entry, history, tikiPath);
        if (change) result.changes.push(change);
      }
    }

    // Bootstrap (#270, contract rule 1a): create entries for recent plans whose
    // GET transition was dropped. Runs after the entry loop, inside the same
    // locked pass. applyTransition creates fresh entries without a legality
    // check when `issue` is provided, so no isLegalTransition pre-guard needed.
    for (const c of findBootstrapCandidates(state, tikiPath, Date.now())) {
      applyTransition(state, {
        workId: c.workId,
        toStatus: c.target.status,
        toStep: c.target.step,
        phase: c.target.phase ?? null,
        parallelExecution: null,
        parentRelease: undefined,
        issue: { number: c.number, title: c.plan.issue.title ?? `Issue ${c.number}` },
        release: null,
      });
      result.changes.push({ workId: c.workId, action: `bootstrapped at ${c.target.step}` });
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
      // --print is the ONE buildReport caller that gets the real gh fetcher
      // (#271): it's interactive, so the ship-shaped gh lookups are wanted.
      const rows = state ? buildReport(state, tikiPath, { fetchIssueState: fetchIssueStateViaGh }) : [];
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
