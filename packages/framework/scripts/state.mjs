#!/usr/bin/env node
/**
 * Tiki state.json CLI shim.
 *
 * Claude Code drives the Tiki framework via bash, not Tauri IPC. This script
 * is the bash-callable counterpart to the typed `state_transition` Tauri
 * command in `apps/desktop/src-tauri/src/state_transition.rs`. Both
 * implementations produce the same JSON shape and enforce the same legal
 * transition table, so framework command prose can call either one and
 * get a consistent state.json.
 *
 * Subcommands:
 *
 *   transition <work-id> --to-status <s> [--to-step <S>] [--phase-*] ...
 *     Mutate status / step / phase on an activeWork entry (creating it if
 *     this is the first transition). Validates against the legal table.
 *
 *   get <work-id> [--field <path>]
 *     Read an activeWork entry. With --field, returns just that
 *     dot-path (scalars print raw, objects/arrays as JSON).
 *
 *   remove <work-id>
 *     Delete activeWork[workId]. Used by ship.md when finalizing a
 *     standalone issue.
 *
 *   append-history issue --number N --title "..." [--completed-at ISO]
 *   append-history release --version V [--issues "1,2,3"] [--tag T] [--completed-at ISO]
 *     Append a completed-work record to history.recentIssues /
 *     recentReleases and update history.lastCompletedIssue /
 *     lastCompletedRelease. Shapes match completedIssueRecord /
 *     completedReleaseRecord in state.schema.json.
 *
 * Common flags:
 *
 *   --tiki-path <path>      Override .tiki location (defaults to <cwd>/.tiki).
 *   --dry-run               Apply in memory and print the would-be result,
 *                           but do NOT write state.json. Honored by
 *                           transition, remove, and append-history.
 *                           Illegal transitions still exit 1.
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
 *   # Preview a transition without writing:
 *   node state.mjs transition issue:42 --to-status shipping --to-step SHIP --dry-run
 *
 *   # Read the current status of an issue:
 *   node state.mjs get issue:42 --field status
 *
 *   # Remove a finalized issue from activeWork (standalone ship):
 *   node state.mjs remove issue:42
 *
 *   # Append a completed issue record to history:
 *   node state.mjs append-history issue --number 42 --title "Add user profiles"
 *
 *   # Append a completed release record to history:
 *   node state.mjs append-history release --version v1.2.0 --issues "41,42,43" --tag v1.2.0
 *
 * Exit codes:
 *   0  success (prints relevant JSON or scalar to stdout)
 *   1  validation error (illegal transition, bad arguments, missing entry)
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
// Legal transition table. The canonical table lives at
// packages/shared/src/types/transitions.ts. This file mirrors it, as does
// apps/desktop/src-tauri/src/state_transition.rs. All three must be kept in
// sync (the parity test in packages/shared/src/__tests__/transitions-parity.test.ts
// enforces this mechanically).
//
// Format: from-status -> Set of allowed to-statuses. Same-status transitions
// (e.g. executing -> executing) are always allowed and not enumerated.
// ---------------------------------------------------------------------------

const LEGAL = {
  pending: new Set(["reviewing", "planning", "executing", "paused", "failed"]),
  reviewing: new Set(["planning", "executing", "paused", "failed"]),
  planning: new Set(["executing", "paused", "failed"]),
  executing: new Set(["shipping", "paused", "failed", "completed"]),
  shipping: new Set(["completed", "failed"]),
  paused: new Set(["pending", "reviewing", "planning", "executing", "shipping"]),
  failed: new Set(["pending", "reviewing", "planning", "executing"]),
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

/**
 * Resolve the `.tiki/` directory path with worktree awareness.
 *
 * Resolution rules:
 *   1. If `override` is provided, honor it exactly (absolute resolved).
 *   2. Otherwise, walk upward from `process.cwd()` looking for the first
 *      ancestor that contains a `.git/` entry (directory OR file).
 *        - `.git` directory  -> normal repo root, return `<ancestor>/.tiki`.
 *        - `.git` file       -> git worktree marker. Parse `gitdir:` line,
 *                               extract the path before `/worktrees/<name>`
 *                               to get the main repo's `.git` directory, go
 *                               up one level to reach the main repo root,
 *                               return `<main-repo-root>/.tiki`.
 *   3. If no ancestor has a `.git`, fall back to `<cwd>/.tiki`.
 *
 * Worktree case rationale: sub-agents dispatched with `isolation: "worktree"`
 * have a CWD inside `<repo>/.git/worktrees/<name>/...`. The Tauri watcher
 * observes the main repo's `.tiki/state.json`, not the worktree's. Without
 * this resolution, sub-agent state writes are invisible to the desktop app.
 *
 * When auto-resolution produces a path that differs from the naive
 * `<cwd>/.tiki`, a single-line debug message is emitted on stderr.
 */
function resolveTikiPath(override) {
  if (override) return path.resolve(override);

  const cwd = process.cwd();
  const naive = path.join(cwd, ".tiki");

  // Walk upward looking for `.git`.
  let dir = cwd;
  let resolved = null;
  while (true) {
    const gitEntry = path.join(dir, ".git");
    if (fs.existsSync(gitEntry)) {
      let stat;
      try {
        stat = fs.statSync(gitEntry);
      } catch {
        stat = null;
      }
      if (stat && stat.isDirectory()) {
        // Normal repo root.
        resolved = path.join(dir, ".tiki");
      } else if (stat && stat.isFile()) {
        // Worktree marker: read the gitdir pointer.
        try {
          const content = fs.readFileSync(gitEntry, "utf-8");
          const firstLine = content.split(/\r?\n/, 1)[0] || "";
          const match = firstLine.match(/^gitdir:\s*(.+)$/);
          if (match) {
            const gitDirPath = match[1].trim();
            // Find `/worktrees/<name>` segment and strip it to find main .git.
            const worktreesIdx = gitDirPath.search(/[\\/]worktrees[\\/]/);
            if (worktreesIdx !== -1) {
              const mainGitDir = gitDirPath.slice(0, worktreesIdx);
              const mainRepoRoot = path.dirname(mainGitDir);
              resolved = path.join(mainRepoRoot, ".tiki");
            } else {
              // Unrecognized .git file format - treat dir as repo root.
              resolved = path.join(dir, ".tiki");
            }
          } else {
            resolved = path.join(dir, ".tiki");
          }
        } catch {
          resolved = path.join(dir, ".tiki");
        }
      } else {
        // Some other entry type — bail to naive fallback.
        resolved = path.join(dir, ".tiki");
      }
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Hit filesystem root with no .git found.
      break;
    }
    dir = parent;
  }

  if (resolved === null) {
    // No `.git` ancestor — preserve legacy non-repo behavior.
    return naive;
  }

  if (path.resolve(resolved) !== path.resolve(naive)) {
    process.stderr.write(
      `state.mjs: resolved tikiPath from worktree to ${resolved}\n`
    );
  }

  return resolved;
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
// Shared helpers.
// ---------------------------------------------------------------------------

function assertWorkIdShape(workId) {
  const isIssue = workId.startsWith("issue:");
  const isRelease = workId.startsWith("release:");
  if (!isIssue && !isRelease) {
    die(1, `invalid work_id '${workId}': must start with 'issue:' or 'release:'`);
  }
  return { isIssue, isRelease };
}

function getNested(obj, dotPath) {
  if (!dotPath) return obj;
  const parts = dotPath.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    cur = cur[part];
  }
  return cur;
}

function printValue(value) {
  // Scalars (string/number/boolean) print raw for shell-friendliness.
  // Objects, arrays, null → JSON, pretty-printed.
  if (value === null) {
    process.stdout.write("null\n");
    return;
  }
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    process.stdout.write(String(value) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Subcommand: transition
// ---------------------------------------------------------------------------

function applyTransition(state, input) {
  const { workId, toStatus, toStep, phase, parallelExecution, parentRelease, issue, release } =
    input;

  const { isIssue } = assertWorkIdShape(workId);

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

function handleTransition(args) {
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

  // Read existing state, apply, optionally write atomically.
  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const state = readState(tikiPath);
  const dryRun = args["dry-run"] === true;

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

  if (!dryRun) {
    writeStateAtomic(tikiPath, state);
  }

  // Emit the updated entry as JSON to stdout. Callers can pipe / jq this.
  process.stdout.write(JSON.stringify(updated, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Subcommand: get
// ---------------------------------------------------------------------------

function handleGet(args) {
  const workId = args._[1];
  if (!workId) {
    die(1, "missing <work-id> argument (e.g. 'issue:42' or 'release:v1.2')");
  }
  assertWorkIdShape(workId);

  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const state = readState(tikiPath);
  const entry = (state.activeWork || {})[workId];
  if (!entry) {
    die(1, `no active work for '${workId}'`);
  }

  const field = args.field;
  if (field === undefined || field === true) {
    process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
    return;
  }
  const value = getNested(entry, String(field));
  if (value === undefined) {
    die(1, `field '${field}' not present on ${workId}`);
  }
  printValue(value);
}

// ---------------------------------------------------------------------------
// Subcommand: remove
// ---------------------------------------------------------------------------

function handleRemove(args) {
  const workId = args._[1];
  if (!workId) {
    die(1, "missing <work-id> argument (e.g. 'issue:42' or 'release:v1.2')");
  }
  assertWorkIdShape(workId);

  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const state = readState(tikiPath);
  state.activeWork = state.activeWork || {};
  const entry = state.activeWork[workId];
  if (!entry) {
    die(1, `no active work for '${workId}'`);
  }

  delete state.activeWork[workId];
  const dryRun = args["dry-run"] === true;
  if (!dryRun) {
    writeStateAtomic(tikiPath, state);
  }

  // Print the removed entry so callers can see what was deleted.
  process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Subcommand: append-history
// ---------------------------------------------------------------------------

function buildCompletedIssueRecord(args) {
  const numberRaw = args.number;
  if (numberRaw === undefined || numberRaw === true) {
    die(1, "append-history issue requires --number N");
  }
  const number = Number(numberRaw);
  if (!Number.isFinite(number) || number < 1) {
    die(1, `invalid --number '${numberRaw}' (must be a positive integer)`);
  }
  const titleRaw = args.title;
  const title = typeof titleRaw === "string" ? titleRaw : undefined;
  if (!title) {
    die(1, "append-history issue requires --title \"...\"");
  }
  const completedAtRaw = args["completed-at"];
  const completedAt =
    typeof completedAtRaw === "string" ? completedAtRaw : new Date().toISOString();

  return { number, title, completedAt };
}

function buildCompletedReleaseRecord(args) {
  const versionRaw = args.version;
  const version = typeof versionRaw === "string" ? versionRaw : undefined;
  if (!version) {
    die(1, "append-history release requires --version V");
  }
  const issuesRaw = args.issues;
  const issues =
    typeof issuesRaw === "string"
      ? issuesRaw
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n >= 1)
      : undefined;

  const tagRaw = args.tag;
  const tag = typeof tagRaw === "string" ? tagRaw : undefined;

  const completedAtRaw = args["completed-at"];
  const completedAt =
    typeof completedAtRaw === "string" ? completedAtRaw : new Date().toISOString();

  return {
    version,
    ...(issues !== undefined ? { issues } : {}),
    completedAt,
    ...(tag !== undefined ? { tag } : {}),
  };
}

function handleAppendHistory(args) {
  const kind = args._[1];
  if (kind !== "issue" && kind !== "release") {
    die(1, `append-history requires 'issue' or 'release' as the second argument (got '${kind}')`);
  }

  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const state = readState(tikiPath);
  state.history = state.history || {};

  let record;
  if (kind === "issue") {
    record = buildCompletedIssueRecord(args);
    state.history.recentIssues = Array.isArray(state.history.recentIssues)
      ? state.history.recentIssues
      : [];
    state.history.recentIssues.unshift(record);
    state.history.lastCompletedIssue = record;
  } else {
    record = buildCompletedReleaseRecord(args);
    state.history.recentReleases = Array.isArray(state.history.recentReleases)
      ? state.history.recentReleases
      : [];
    state.history.recentReleases.unshift(record);
    state.history.lastCompletedRelease = record;
  }

  const dryRun = args["dry-run"] === true;
  if (!dryRun) {
    writeStateAtomic(tikiPath, state);
  }

  process.stdout.write(JSON.stringify(record, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const subcommand = args._[0];
  switch (subcommand) {
    case "transition":
      handleTransition(args);
      return;
    case "get":
      handleGet(args);
      return;
    case "remove":
      handleRemove(args);
      return;
    case "append-history":
      handleAppendHistory(args);
      return;
    default:
      die(
        1,
        `unknown subcommand '${subcommand}' (expected one of: transition, get, remove, append-history)`
      );
  }
}

// Only run main() when this file is invoked directly as a CLI, not when
// imported as a module by tests. We compare the resolved entry script
// against this module's URL.
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

// Named exports for test/programmatic use. The CLI entry point above is
// unaffected by these — they exist purely so tests can import the
// resolver directly without spawning a subprocess for every assertion.
export { resolveTikiPath };
