#!/usr/bin/env node
/**
 * Tiki state.json CLI shim — issue #144.
 *
 * Claude Code drives the Tiki framework via bash, not Tauri IPC. This script
 * is the bash-callable counterpart to the typed `state_transition` Tauri
 * command in `apps/desktop/src-tauri/src/state_transition.rs`. Both
 * implementations produce the same JSON shape and enforce the same legal
 * transition table, so framework command prose can call either one and
 * get a consistent state.json.
 *
 * Usage:
 *
 *   node state.mjs transition <work-id> --to-status <status>
 *       [--to-step <step>]
 *       [--phase-current N --phase-total T --phase-status <status>]
 *       [--parent-release <version>]
 *       [--issue-number N --issue-title "..."]
 *       [--release-version V --release-issues "1,2,3"]
 *       [--tiki-path <path>]
 *
 * Examples:
 *
 *   # Fresh GET-step entry for a brand new issue:
 *   node state.mjs transition issue:42 --to-status pending --to-step GET \
 *     --issue-number 42 --issue-title "Add user profiles"
 *
 *   # Advance to executing during EXECUTE step:
 *   node state.mjs transition issue:42 --to-status executing --to-step EXECUTE \
 *     --phase-current 2 --phase-total 5 --phase-status executing
 *
 *   # Ship a release-child issue, preserving parentRelease:
 *   node state.mjs transition issue:42 --to-status completed --to-step SHIP
 *
 * Exit codes:
 *   0  success (prints updated entry JSON to stdout)
 *   1  validation error (illegal transition, bad arguments)
 *   2  I/O error (read/write/atomic-rename failure)
 *
 * Backward compatibility:
 *   The shim is OPTIONAL. Framework commands that still write JSON directly
 *   to state.json continue to work — the shape this shim produces is
 *   identical to what the prose-driven approach produces.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------------
// Legal transition table (mirrors apps/desktop/src-tauri/src/state_transition.rs
// — keep these in sync).
//
// Format: from-status -> Set of allowed to-statuses. Same-status transitions
// (e.g. executing -> executing) are always allowed and not enumerated.
// ---------------------------------------------------------------------------

const LEGAL = {
  pending: new Set(["reviewing", "planning", "executing", "paused", "failed"]),
  reviewing: new Set(["planning", "executing", "paused", "failed"]),
  planning: new Set(["executing", "paused", "failed"]),
  executing: new Set(["shipping", "paused", "failed"]),
  shipping: new Set(["completed", "failed"]),
  paused: new Set(["pending", "reviewing", "planning", "executing", "shipping"]),
  failed: new Set(["pending", "reviewing", "planning", "executing", "shipping"]),
  completed: new Set(), // terminal
};

const VALID_STATUSES = new Set([
  "pending",
  "reviewing",
  "planning",
  "executing",
  "paused",
  "failed",
  "shipping",
  "completed",
]);

const VALID_STEPS = new Set(["GET", "REVIEW", "PLAN", "AUDIT", "EXECUTE", "SHIP"]);

function isLegalTransition(from, to) {
  if (from === to) return true;
  const allowed = LEGAL[from];
  return allowed ? allowed.has(to) : false;
}

// ---------------------------------------------------------------------------
// Tiny arg parser. Avoids pulling in yargs/minimist for a single-purpose CLI.
// ---------------------------------------------------------------------------

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

function die(code, msg) {
  process.stderr.write(`state.mjs: ${msg}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// State file I/O.
// ---------------------------------------------------------------------------

function resolveTikiPath(override) {
  if (override) return path.resolve(override);
  return path.join(process.cwd(), ".tiki");
}

function readState(tikiPath) {
  const stateFile = path.join(tikiPath, "state.json");
  if (!fs.existsSync(stateFile)) {
    return { schemaVersion: 1, activeWork: {}, history: {} };
  }
  let raw;
  try {
    raw = fs.readFileSync(stateFile, "utf-8");
  } catch (e) {
    die(2, `failed to read ${stateFile}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(2, `state.json is not valid JSON: ${e.message}`);
  }
}

function writeStateAtomic(tikiPath, state) {
  if (!fs.existsSync(tikiPath)) {
    fs.mkdirSync(tikiPath, { recursive: true });
  }
  const stateFile = path.join(tikiPath, "state.json");
  const tmp = stateFile + ".tmp";
  const json = JSON.stringify(state, null, 2);
  try {
    fs.writeFileSync(tmp, json, "utf-8");
    fs.renameSync(tmp, stateFile);
  } catch (e) {
    // Best-effort cleanup of the temp file.
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    die(2, `failed to write ${stateFile}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Transition application.
// ---------------------------------------------------------------------------

function applyTransition(state, input) {
  const { workId, toStatus, toStep, phase, parallelExecution, parentRelease, issue, release } =
    input;

  // Sanity-check the work_id prefix.
  const isIssue = workId.startsWith("issue:");
  const isRelease = workId.startsWith("release:");
  if (!isIssue && !isRelease) {
    die(1, `invalid work_id '${workId}': must start with 'issue:' or 'release:'`);
  }

  state.activeWork = state.activeWork || {};
  const existing = state.activeWork[workId];
  const now = new Date().toISOString();

  if (existing) {
    // Existing entry — validate the transition first.
    const fromStatus = existing.status;
    if (!isLegalTransition(fromStatus, toStatus)) {
      die(1, `illegal transition for ${workId}: ${fromStatus} -> ${toStatus}`);
    }
  }

  // Build / update the entry.
  if (isIssue) {
    let entry = existing && existing.type === "issue" ? existing : null;
    if (existing && existing.type !== "issue") {
      die(1, `work_id ${workId} was previously a ${existing.type}, cannot retype as issue`);
    }
    if (!entry) {
      // Fresh — require the issue payload.
      if (!issue) {
        die(1, `creating new entry ${workId} requires --issue-number (and --issue-title)`);
      }
      entry = {
        type: "issue",
        issue,
        status: toStatus,
        ...(toStep ? { pipelineStep: toStep } : {}),
        createdAt: now,
        lastActivity: now,
        ...(parentRelease ? { parentRelease } : {}),
      };
    } else {
      entry.status = toStatus;
      if (toStep) entry.pipelineStep = toStep;
      // Preserve parentRelease unless explicitly overwritten.
      if (parentRelease !== undefined) {
        entry.parentRelease = parentRelease;
      }
      entry.lastActivity = now;
    }

    if (phase) {
      entry.phase = phase;
    }
    if (parallelExecution) {
      entry.parallelExecution = parallelExecution;
    }
    // Clear parallelExecution on terminal-ish transitions, matching the Rust impl.
    if (toStatus === "shipping" || toStatus === "completed") {
      delete entry.parallelExecution;
    }

    state.activeWork[workId] = entry;
  } else {
    // Release branch.
    let entry = existing && existing.type === "release" ? existing : null;
    if (existing && existing.type !== "release") {
      die(1, `work_id ${workId} was previously a ${existing.type}, cannot retype as release`);
    }
    if (!entry) {
      if (!release) {
        die(1, `creating new entry ${workId} requires --release-version and --release-issues`);
      }
      entry = {
        type: "release",
        release,
        status: toStatus,
        ...(toStep ? { pipelineStep: toStep } : {}),
        createdAt: now,
        lastActivity: now,
      };
    } else {
      entry.status = toStatus;
      if (toStep) entry.pipelineStep = toStep;
      entry.lastActivity = now;
    }
    state.activeWork[workId] = entry;
  }

  return state.activeWork[workId];
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const subcommand = args._[0];
  if (subcommand !== "transition") {
    die(1, `unknown subcommand '${subcommand}' (only 'transition' is supported)`);
  }
  const workId = args._[1];
  if (!workId) {
    die(1, "missing <work-id> argument (e.g. 'issue:42' or 'release:v1.2')");
  }
  const toStatus = args["to-status"];
  if (!toStatus) {
    die(1, "missing --to-status flag");
  }
  if (!VALID_STATUSES.has(toStatus)) {
    die(
      1,
      `invalid --to-status '${toStatus}' (must be one of: ${[...VALID_STATUSES].join(", ")})`
    );
  }

  const toStep = args["to-step"];
  if (toStep && !VALID_STEPS.has(toStep)) {
    die(1, `invalid --to-step '${toStep}' (must be one of: ${[...VALID_STEPS].join(", ")})`);
  }

  // Optional phase tri-tuple. All three flags must be provided together.
  const phaseCurrent = args["phase-current"];
  const phaseTotal = args["phase-total"];
  const phaseStatus = args["phase-status"];
  let phase = null;
  if (phaseCurrent !== undefined || phaseTotal !== undefined || phaseStatus !== undefined) {
    if (phaseCurrent === undefined || phaseTotal === undefined || phaseStatus === undefined) {
      die(
        1,
        "--phase-current, --phase-total, and --phase-status must all be provided together"
      );
    }
    phase = {
      current: Number(phaseCurrent),
      total: Number(phaseTotal),
      status: phaseStatus,
    };
    if (Number.isNaN(phase.current) || Number.isNaN(phase.total)) {
      die(1, "--phase-current and --phase-total must be numbers");
    }
  }

  // Optional parentRelease.
  const parentRelease = args["parent-release"];

  // Optional issue payload (for fresh entries).
  const issueNumber = args["issue-number"];
  const issueTitle = args["issue-title"];
  const issue = issueNumber !== undefined
    ? { number: Number(issueNumber), ...(issueTitle ? { title: issueTitle } : {}) }
    : null;

  // Optional release payload.
  const releaseVersion = args["release-version"];
  const releaseIssuesRaw = args["release-issues"];
  const release = releaseVersion !== undefined
    ? {
        version: releaseVersion,
        issues: releaseIssuesRaw
          ? String(releaseIssuesRaw)
              .split(",")
              .map((s) => Number(s.trim()))
              .filter((n) => !Number.isNaN(n))
          : [],
        completedIssues: [],
      }
    : null;

  // Read existing state, apply, write atomically.
  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const state = readState(tikiPath);

  const updated = applyTransition(state, {
    workId,
    toStatus,
    toStep: toStep || null,
    phase,
    parallelExecution: null, // not exposed via CLI yet — Rust IPC is canonical for parallel groups
    parentRelease: parentRelease !== undefined ? parentRelease : undefined,
    issue,
    release,
  });

  writeStateAtomic(tikiPath, state);

  // Emit the updated entry as JSON to stdout. Callers can pipe / jq this.
  process.stdout.write(JSON.stringify(updated, null, 2) + "\n");
}

main();
