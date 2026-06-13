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
 *   journal <work-id> --step <STEP> [--event start] [--phase-current N --phase-total T] [--title "..."]
 *     Append one NDJSON intent line to .tiki/journal.ndjson (#272). The
 *     journal is the drop-proof record of "a workflow step started" — the
 *     reconciler uses it as a floor when state transitions get dropped.
 *     UNLIKE every other subcommand, journal NEVER exits non-zero: any
 *     failure (bad args, unwritable disk) warns on stderr and exits 0,
 *     because a journal failure must never break the workflow command
 *     that emitted it. On success the appended line is printed.
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
 *   # Journal that GET started for an issue (title feeds journal bootstrap):
 *   node state.mjs journal issue:42 --step GET --title "Add user profiles"
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

// Monotonic pipeline-step ordering. Exported so the reconciler
// (reconcile-state.mjs) and the journal-floor logic below share ONE source of
// truth for "which step is further along" instead of drifting copies.
const STEP_ORDER = { GET: 0, REVIEW: 1, PLAN: 2, AUDIT: 3, EXECUTE: 4, SHIP: 5 };

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
// Cross-process write lock (#224).
//
// state.mjs is invoked once per transition, often chained rapidly during a
// release cascade — and two processes doing read-modify-write on state.json can
// interleave and LOSE an update (A reads, B reads, A writes, B writes; A's
// mutation vanishes). writeStateAtomic's temp+rename only protects readers from
// partial writes, not writers from clobbering each other. We serialize the whole
// read-modify-write behind an exclusive lockfile.
//
// Node built-ins only (the Windows pnpm reparse-point block makes adding deps
// painful — mirrors the node:test choice). Stale locks (from a crashed/killed
// holder) are stolen after STALE_MS; an exit handler releases our own lock even
// when die()/process.exit() unwinds past the finally.
// ---------------------------------------------------------------------------

let HELD_LOCK = null;

function releaseHeldLock() {
  if (!HELD_LOCK) return;
  const { fd, path: lockPath } = HELD_LOCK;
  HELD_LOCK = null;
  try {
    fs.closeSync(fd);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

// Fires on normal exit AND process.exit() (which die() calls), so an illegal
// transition inside the lock never leaves the lockfile behind.
process.on("exit", releaseHeldLock);

/** Synchronous sleep with zero deps (no busy-spin). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` while holding an exclusive lock on `<tikiPath>/state.json.lock`.
 * `fn` performs the read-modify-write; serializing it prevents lost updates.
 *
 * `opts.lenient` (default false): when a lock cannot be acquired (open error or
 * acquisition timeout), return `undefined` WITHOUT running `fn` instead of
 * `die(2)`. The state reconciler (reconcile-state.mjs) runs as a Claude Code
 * Stop/SubagentStop hook that must never block the user's turn, so it opts in to
 * lenient locking — a missed reconcile pass is harmless (the next turn retries),
 * a blocking exit is not. The default (non-lenient) behavior is unchanged.
 */
function withStateLock(tikiPath, fn, opts = {}) {
  const lenient = opts.lenient === true;
  if (!fs.existsSync(tikiPath)) {
    fs.mkdirSync(tikiPath, { recursive: true });
  }
  const lockPath = path.join(tikiPath, "state.json.lock");
  const STALE_MS = 10_000;
  const MAX_WAIT_MS = 5_000;
  const RETRY_MS = 25;
  const start = Date.now();

  let fd = null;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, "wx"); // exclusive create — fails if held
      break;
    } catch (e) {
      if (e.code !== "EEXIST") {
        if (lenient) return undefined;
        die(2, `failed to acquire state lock ${lockPath}: ${e.message}`);
      }
      // Lock is held. Steal it if the holder died and left it stale.
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > STALE_MS) {
          try {
            fs.unlinkSync(lockPath);
          } catch {
            /* another writer beat us to it */
          }
          continue;
        }
      } catch {
        // Lock vanished between open and stat — retry immediately.
        continue;
      }
      if (Date.now() - start > MAX_WAIT_MS) {
        if (lenient) return undefined;
        die(2, `timed out after ${MAX_WAIT_MS}ms waiting for state lock ${lockPath}`);
      }
      sleepSync(RETRY_MS);
    }
  }

  try {
    fs.writeSync(fd, String(process.pid));
  } catch {
    /* the pid is diagnostic only */
  }
  HELD_LOCK = { fd, path: lockPath };
  try {
    return fn();
  } finally {
    releaseHeldLock();
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
    // Clear stale phase progress on completion so the pipeline timeline and
    // sidebar don't show a leftover "1/N" after the work is done (#220).
    // Mirrors the Rust state_transition impl.
    if (toStatus === "completed") {
      delete entry.phase;
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

  // Read existing state, apply, optionally write atomically. The whole
  // read-modify-write runs under the cross-process lock so chained writes
  // during a release cascade can't lose an update (#224).
  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const dryRun = args["dry-run"] === true;

  let updated;
  const apply = () => {
    const state = readState(tikiPath);
    updated = applyTransition(state, {
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
  };
  if (dryRun) apply();
  else withStateLock(tikiPath, apply);

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
  const dryRun = args["dry-run"] === true;

  let entry;
  const apply = () => {
    const state = readState(tikiPath);
    state.activeWork = state.activeWork || {};
    entry = state.activeWork[workId];
    if (!entry) {
      die(1, `no active work for '${workId}'`);
    }
    delete state.activeWork[workId];
    if (!dryRun) {
      writeStateAtomic(tikiPath, state);
    }
  };
  if (dryRun) apply();
  else withStateLock(tikiPath, apply);

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
  const dryRun = args["dry-run"] === true;

  let record;
  const apply = () => {
    const state = readState(tikiPath);
    state.history = state.history || {};

    if (kind === "issue") {
      record = buildCompletedIssueRecord(args);
      state.history.recentIssues = Array.isArray(state.history.recentIssues)
        ? state.history.recentIssues
        : [];
      // Idempotent: drop any prior entry for the same issue number before
      // re-inserting, so re-running append-history (e.g. ship.md during the
      // cascade AND release.md teardown) never duplicates a child issue.
      state.history.recentIssues = state.history.recentIssues.filter(
        (entry) => entry == null || entry.number !== record.number
      );
      state.history.recentIssues.unshift(record);
      state.history.lastCompletedIssue = record;
    } else {
      record = buildCompletedReleaseRecord(args);
      state.history.recentReleases = Array.isArray(state.history.recentReleases)
        ? state.history.recentReleases
        : [];
      // Idempotent: drop any prior entry for the same release version before
      // re-inserting, so re-running append-history release never duplicates.
      state.history.recentReleases = state.history.recentReleases.filter(
        (entry) => entry == null || entry.version !== record.version
      );
      state.history.recentReleases.unshift(record);
      state.history.lastCompletedRelease = record;
    }

    if (!dryRun) {
      writeStateAtomic(tikiPath, state);
    }
  };
  if (dryRun) apply();
  else withStateLock(tikiPath, apply);

  process.stdout.write(JSON.stringify(record, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Intent journal (#272): append-only .tiki/journal.ndjson.
//
// Every workflow command journals "step X started for workId" as its FIRST
// action. Unlike state.json transitions (which the LLM can forget to emit),
// the journal is a single fire-and-forget line, so the reconciler can use it
// as a step floor and as a bootstrap signal even when every transition was
// dropped. Design contract: .tiki/research/reconciler-contract.md
// "#272 REVIEW decisions".
//
// Entry shape (one JSON object per line):
//   { ts, workId, step, event, phase?, title? }
// `event` is "start" in v1 ("complete" is reserved). GET passes `title` so a
// journal-qualified bootstrap can create an activeWork entry with a real
// title before any plan file exists.
//
// Appends take NO lock: fs.appendFileSync with O_APPEND of a sub-PIPE_BUF
// line is atomic enough, and the defensive reader skips torn lines anyway.
// ---------------------------------------------------------------------------

const JOURNAL_FILE = "journal.ndjson";

/**
 * Append one journal line. Creates `.tiki/` if missing — the journal may be
 * the FIRST tiki artifact in a project (GET journals before anything else).
 *
 * NEVER throws. Returns the appended entry object on success, `false` on any
 * failure (truthy/falsy contract — callers that only care about success can
 * treat the result as a boolean).
 */
function appendJournalEntry(tikiPath, { workId, step, event = "start", phase, title } = {}) {
  try {
    if (!workId || !step) return false;
    if (!fs.existsSync(tikiPath)) {
      fs.mkdirSync(tikiPath, { recursive: true });
    }
    const entry = {
      ts: new Date().toISOString(),
      workId,
      step,
      event,
      ...(phase ? { phase } : {}),
      ...(title ? { title } : {}),
    };
    fs.appendFileSync(path.join(tikiPath, JOURNAL_FILE), JSON.stringify(entry) + "\n", "utf-8");
    return entry;
  } catch {
    return false;
  }
}

/**
 * Read all parseable journal entries, in file (= append) order. Defensive:
 * unparseable / torn / non-object lines are silently skipped — a torn line
 * from an append racing a prune rewrite degrades to "that one line is lost",
 * never to a read failure. Returns [] when the journal doesn't exist.
 */
function readJournalEntries(tikiPath) {
  const journalFile = path.join(tikiPath, JOURNAL_FILE);
  let raw;
  try {
    raw = fs.readFileSync(journalFile, "utf-8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        entries.push(parsed);
      }
    } catch {
      /* torn or garbage line — skip */
    }
  }
  return entries;
}

/**
 * Highest journaled step for `workId`, by STEP_ORDER. Returns
 * `{ step, title? }` or null when no entry (with a known step) exists for the
 * workId. `title` comes from the NEWEST entry for the workId that carries
 * one (GET journals the title; later steps don't repeat it).
 */
function journalFloor(entries, workId) {
  let bestIdx = -1;
  let bestStep = null;
  let title;
  for (const entry of entries || []) {
    if (!entry || entry.workId !== workId) continue;
    const idx = STEP_ORDER[entry.step];
    if (idx === undefined) continue;
    if (idx > bestIdx) {
      bestIdx = idx;
      bestStep = entry.step;
    }
    // Entries are in append order, so the last title seen is the newest.
    if (typeof entry.title === "string" && entry.title) {
      title = entry.title;
    }
  }
  if (bestStep === null) return null;
  return { step: bestStep, ...(title !== undefined ? { title } : {}) };
}

/**
 * Rewrite the journal WITHOUT entries for shipped work — `issue:N` where N is
 * in history.recentIssues, `release:V` where V is in history.recentReleases.
 *
 * Churn threshold: only acts when the journal has >= 50 total lines OR >= 10
 * prunable lines; below that the file is left byte-identical. Rewrite is
 * atomic (tmp + rename, tmp cleaned up on failure). Unparseable lines are
 * preserved as-is (the reader skips them; pruning must not destroy data it
 * cannot understand).
 *
 * The CALLER is responsible for holding the state lock (the reconciler runs
 * this inside its locked pass). Returns the number of lines pruned (0 on any
 * failure — degrade silently).
 */
function pruneJournal(tikiPath, state) {
  const journalFile = path.join(tikiPath, JOURNAL_FILE);
  let raw;
  try {
    raw = fs.readFileSync(journalFile, "utf-8");
  } catch {
    return 0;
  }

  const history = (state && state.history) || {};
  const shippedIssues = new Set(
    (Array.isArray(history.recentIssues) ? history.recentIssues : [])
      .filter((r) => r && r.number !== undefined)
      .map((r) => String(r.number))
  );
  const shippedReleases = new Set(
    (Array.isArray(history.recentReleases) ? history.recentReleases : [])
      .filter((r) => r && r.version !== undefined)
      .map((r) => String(r.version))
  );

  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  const kept = [];
  let pruned = 0;
  for (const line of lines) {
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      /* unparseable — keep verbatim */
    }
    const workId = entry && typeof entry === "object" ? entry.workId : undefined;
    let prunable = false;
    if (typeof workId === "string") {
      if (workId.startsWith("issue:")) {
        prunable = shippedIssues.has(workId.slice("issue:".length));
      } else if (workId.startsWith("release:")) {
        prunable = shippedReleases.has(workId.slice("release:".length));
      }
    }
    if (prunable) {
      pruned++;
    } else {
      kept.push(line);
    }
  }

  // Churn threshold: don't rewrite a small, mostly-live journal.
  if (pruned === 0 || (lines.length < 50 && pruned < 10)) {
    return 0;
  }

  const tmp = journalFile + ".tmp";
  try {
    fs.writeFileSync(tmp, kept.length > 0 ? kept.join("\n") + "\n" : "", "utf-8");
    fs.renameSync(tmp, journalFile);
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return 0;
  }
  return pruned;
}

// ---------------------------------------------------------------------------
// Subcommand: journal
//
// IMPORTANT: this handler must NEVER exit non-zero. It is invoked as the
// first action of every workflow command; if a malformed flag or a read-only
// disk could fail the whole command, the journal would make tracking LESS
// reliable instead of more. All failures warn on stderr and exit 0.
// ---------------------------------------------------------------------------

function journalWarn(msg) {
  process.stderr.write(`state.mjs: journal warning (ignored, exit 0): ${msg}\n`);
}

function handleJournal(args) {
  try {
    const workId = args._[1];
    if (!workId || typeof workId !== "string") {
      journalWarn("missing <work-id> argument (e.g. 'issue:42' or 'release:v1.2')");
      return;
    }
    if (!workId.startsWith("issue:") || workId === "issue:") {
      if (!workId.startsWith("release:") || workId === "release:") {
        journalWarn(`invalid work_id '${workId}': must start with 'issue:' or 'release:'`);
        return;
      }
    }

    const step = args.step;
    if (typeof step !== "string" || !VALID_STEPS.has(step)) {
      journalWarn(`invalid --step '${step}' (must be one of: ${[...VALID_STEPS].join(", ")})`);
      return;
    }

    const eventRaw = args.event;
    const event = typeof eventRaw === "string" && eventRaw ? eventRaw : "start";

    // Optional phase pair — both flags or neither.
    const phaseCurrent = args["phase-current"];
    const phaseTotal = args["phase-total"];
    let phase;
    if (phaseCurrent !== undefined || phaseTotal !== undefined) {
      if (phaseCurrent === undefined || phaseTotal === undefined) {
        journalWarn("--phase-current and --phase-total must be provided together");
        return;
      }
      const current = Number(phaseCurrent);
      const total = Number(phaseTotal);
      if (!Number.isFinite(current) || !Number.isFinite(total)) {
        journalWarn("--phase-current and --phase-total must be numbers");
        return;
      }
      phase = { current, total };
    }

    const titleRaw = args.title;
    const title = typeof titleRaw === "string" && titleRaw ? titleRaw : undefined;

    const tikiPath = resolveTikiPath(
      typeof args["tiki-path"] === "string" ? args["tiki-path"] : undefined
    );
    const entry = appendJournalEntry(tikiPath, { workId, step, event, phase, title });
    if (!entry) {
      journalWarn(`failed to append to ${path.join(tikiPath, JOURNAL_FILE)}`);
      return;
    }
    process.stdout.write(JSON.stringify(entry) + "\n");
  } catch (e) {
    journalWarn(e && e.message ? e.message : String(e));
  }
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
    case "journal":
      handleJournal(args);
      return;
    default:
      die(
        1,
        `unknown subcommand '${subcommand}' (expected one of: transition, get, remove, append-history, journal)`
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
// unaffected by these — they exist purely so tests and the state reconciler
// (reconcile-state.mjs, epic #244) can reuse the validated transition logic
// in-process instead of duplicating the legal-transition table a fourth time.
export {
  resolveTikiPath,
  readState,
  writeStateAtomic,
  withStateLock,
  applyTransition,
  isLegalTransition,
  STEP_ORDER,
  appendJournalEntry,
  readJournalEntries,
  journalFloor,
  pruneJournal,
};
