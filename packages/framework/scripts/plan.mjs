#!/usr/bin/env node
/**
 * Tiki plan-file mutation shim (#275 phase 2).
 *
 * Owns every write to `.tiki/plans/issue-<n>.json` that the framework commands
 * used to perform as raw "direct JSON write acknowledged" edits:
 *   - phase status/summary/timestamps/error  (was execute.md per-phase writes)
 *   - successCriteria[].verified/verifiedAt   (was execute.md verify write)
 *   - audited/auditedAt                       (folded from mark-audited.mjs)
 *
 * Mirrors mark-audited.mjs conventions: parseArgs, writeJsonAtomic,
 * `resolveTikiPath` + the VALID_* enum constants imported from state.mjs (single
 * enum source — NO second copy), Node built-ins only, die() exit codes.
 *
 * Usage:
 *   node plan.mjs phase <issue> --number N --status S
 *        [--summary "..."] [--completed-at ISO] [--started-at ISO] [--error "..."]
 *        [--tiki-path <path>] [--dry-run]
 *   node plan.mjs verify-criteria <issue> [--tiki-path <path>] [--dry-run]
 *   node plan.mjs audited <issue> [--tiki-path <path>] [--dry-run]
 *
 * Exit codes: 0 success · 1 bad args / missing plan / bad enum · 2 I/O error.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveTikiPath, VALID_PHASE_STATUS } from "./state.mjs";

const VALID_PHASE_STATUS_SET = new Set(VALID_PHASE_STATUS);

function die(code, msg) {
  process.stderr.write(`plan.mjs: ${msg}\n`);
  process.exit(code);
}

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

function writeJsonAtomic(file, obj) {
  const tmp = file + ".tmp";
  const json = JSON.stringify(obj, null, 2);
  try {
    fs.writeFileSync(tmp, json, "utf-8");
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    die(2, `failed to write ${file}: ${e.message}`);
  }
}

/** Resolve <issue> arg → integer issue number (>= 1) or die(1). */
function requireIssueNumber(raw) {
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) {
    die(1, `missing/invalid <issue> (got '${raw}')`);
  }
  return number;
}

/** Locate + parse the plan file for an issue, or die. */
function loadPlan(tikiPath, number) {
  const planFile = path.join(tikiPath, "plans", `issue-${number}.json`);
  if (!fs.existsSync(planFile)) {
    die(1, `no plan file at ${planFile} — run /tiki:plan ${number} first`);
  }
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planFile, "utf-8"));
  } catch (e) {
    die(2, `plan file is not valid JSON: ${e.message}`);
  }
  return { planFile, plan };
}

// ---------------------------------------------------------------------------
// Shared audited logic — mark-audited.mjs delegates here so both produce an
// identical result (single source for the audit-artifact write).
// ---------------------------------------------------------------------------

/**
 * Set `audited: true` + a fresh `auditedAt` on the plan and (unless dryRun)
 * atomically write it back. Returns the result payload both CLIs print.
 */
export function applyAudited(tikiPath, number, { dryRun = false } = {}) {
  const { planFile, plan } = loadPlan(tikiPath, number);
  plan.audited = true;
  plan.auditedAt = new Date().toISOString();
  if (!dryRun) {
    writeJsonAtomic(planFile, plan);
  }
  return { issue: number, audited: true, auditedAt: plan.auditedAt };
}

// ---------------------------------------------------------------------------
// verify-criteria: faithful port of @tiki/shared deriveCriteriaVerification.
// Pure rule: a criterion is verified iff its coverageMatrix entry is non-empty
// AND every covering phase (by number) has status 'completed'. Preserve an
// existing verifiedAt when already verified; strip verified/verifiedAt
// otherwise (set verified:false). plan.mjs cannot import @tiki/shared, so the
// rule is reimplemented with built-ins — kept byte-faithful to the source.
// ---------------------------------------------------------------------------

function deriveCriteriaVerification(plan) {
  const criteria = plan.successCriteria ?? [];
  const coverage = plan.coverageMatrix ?? {};
  const now = new Date().toISOString();

  const statusByNumber = new Map();
  for (const phase of plan.phases ?? []) {
    statusByNumber.set(phase.number, phase.status);
  }

  return criteria.map((criterion) => {
    const coveringPhases = coverage[criterion.id] ?? [];
    const verified =
      coveringPhases.length > 0 &&
      coveringPhases.every(
        (phaseNumber) => statusByNumber.get(phaseNumber) === "completed"
      );

    if (verified) {
      return {
        ...criterion,
        verified: true,
        verifiedAt: criterion.verifiedAt ?? now,
      };
    }

    const { verified: _verified, verifiedAt: _verifiedAt, ...rest } = criterion;
    return { ...rest, verified: false };
  });
}

// ---------------------------------------------------------------------------
// Subcommand handlers.
// ---------------------------------------------------------------------------

function cmdPhase(args) {
  const number = requireIssueNumber(args._[1]);
  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const { planFile, plan } = loadPlan(tikiPath, number);

  const phaseNumRaw = args.number;
  const phaseNum = Number(phaseNumRaw);
  if (phaseNumRaw === undefined || phaseNumRaw === true || !Number.isInteger(phaseNum)) {
    die(1, `phase requires --number <int> (got '${phaseNumRaw}')`);
  }

  const status = args.status;
  if (status === undefined || status === true) {
    die(1, "phase requires --status <status>");
  }
  if (!VALID_PHASE_STATUS_SET.has(status)) {
    die(
      1,
      `invalid --status '${status}' (expected one of ${VALID_PHASE_STATUS.join(", ")})`
    );
  }

  const phase = (plan.phases ?? []).find((p) => p.number === phaseNum);
  if (!phase) {
    die(1, `plan issue-${number} has no phase number ${phaseNum}`);
  }

  phase.status = status;

  if (typeof args.summary === "string") {
    phase.summary = args.summary;
  }
  if (typeof args["completed-at"] === "string") {
    phase.completedAt = args["completed-at"];
  }
  if (typeof args["started-at"] === "string") {
    phase.startedAt = args["started-at"];
  }
  if (typeof args.error === "string") {
    // Plan schema PhaseError = { message, timestamp }.
    phase.error = { message: args.error, timestamp: new Date().toISOString() };
  }

  if (args["dry-run"] !== true) {
    writeJsonAtomic(planFile, plan);
  }

  process.stdout.write(
    JSON.stringify(
      { issue: number, phase: phaseNum, status, summary: phase.summary },
      null,
      2
    ) + "\n"
  );
}

function cmdVerifyCriteria(args) {
  const number = requireIssueNumber(args._[1]);
  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const { planFile, plan } = loadPlan(tikiPath, number);

  const derived = deriveCriteriaVerification(plan);
  plan.successCriteria = derived;

  if (args["dry-run"] !== true) {
    writeJsonAtomic(planFile, plan);
  }

  const verifiedIds = derived.filter((c) => c.verified).map((c) => c.id);
  process.stdout.write(
    JSON.stringify(
      { issue: number, verified: verifiedIds, total: derived.length },
      null,
      2
    ) + "\n"
  );
}

function cmdAudited(args) {
  const number = requireIssueNumber(args._[1]);
  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const result = applyAudited(tikiPath, number, { dryRun: args["dry-run"] === true });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];
  switch (sub) {
    case "phase":
      return cmdPhase(args);
    case "verify-criteria":
      return cmdVerifyCriteria(args);
    case "audited":
      return cmdAudited(args);
    default:
      die(
        1,
        `unknown subcommand '${sub ?? ""}' (expected: phase | verify-criteria | audited)`
      );
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
