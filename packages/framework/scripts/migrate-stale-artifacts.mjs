#!/usr/bin/env node
/**
 * One-time artifact migration (#300): bring pre-#211/#276 artifact locations
 * in line with the "location is truth" invariants that were only ever
 * enforced going forward.
 *
 * What it does (idempotent; every action is skipped when already done):
 *
 *   1. BACKUP  — copies state.json and writes a manifest of every executed
 *      move to `.tiki/backups/migration-<ts>/` BEFORE touching anything.
 *      No backup dir is created when there is nothing to do (or on --dry-run).
 *
 *   2. PLANS   — archives every `.tiki/plans/issue-N.json` whose issue is
 *      finished, i.e. N appears in a `history.recentReleases` issue list OR
 *      in `history.recentIssues` OR in the closed-issue set (one batched
 *      `gh issue list --state closed` call — never per-issue calls — or the
 *      `--closed-issues-file` override). Plans for issues still active in
 *      `activeWork` are never touched. `phases[].status` is normalized on
 *      migrate: any status not in {completed, skipped} becomes `completed`
 *      (matches what ship would have written; the archived plan is what
 *      `deriveCriteriaChecklist` renders). Success criteria are left as-is
 *      (the pending-verification cutoff is a follow-up issue).
 *
 *   3. RELEASE DEFS — moves stranded `.tiki/releases/vX.json` defs whose
 *      `status` is completed/shipped into `releases/archive/`, normalizing
 *      `status` to `"shipped"` (mirrors the desktop's
 *      `normalize_archived_releases`). Active defs, and defs for a release
 *      currently executing in `activeWork`, are never touched.
 *
 *   4. GHOST DEFS — reconstructs archived defs for releases that shipped but
 *      have no def in EITHER location:
 *        a. from `history.recentReleases` records (version / issues /
 *           completedAt / tag are all there; issue titles come from the
 *           closed-issue set), and
 *        b. from orphan `releases/<v>-changelog.md` files for versions absent
 *           from history too (e.g. v0.7.4): the issue list is recovered from
 *           the changelog's `/issues/N` links and `createdAt` from the git
 *           tag date (falling back to the changelog file's mtime).
 *      Reconstructed defs match the archived shape (version / status:shipped /
 *      issues[{number,title}] / createdAt / shipped:true / tag) plus a
 *      `reconstructed: true` provenance marker.
 *
 *   5. ORPHAN CHANGELOGS — `<v>-changelog.md` files in active `releases/`
 *      whose defs are archived are DELIBERATELY KEPT IN PLACE: the desktop's
 *      `read_release_changelog` reads them from the active dir, so
 *      co-archiving would break the release-notes panel. Documented here as
 *      the decision required by #300 item 4.
 *
 * state.json itself is NEVER mutated — the reconciler machinery owns it.
 *
 * Usage:
 *   node migrate-stale-artifacts.mjs [--dry-run] [--tiki-path <path>]
 *        [--closed-issues-file <path>]
 *
 *   --dry-run             list every planned move/write; touch nothing.
 *   --tiki-path <path>    override .tiki location (defaults to the same
 *                         resolution state.mjs uses at runtime).
 *   --closed-issues-file  JSON array of issue numbers or {number,title}
 *                         objects to use INSTEAD of calling `gh` (tests /
 *                         offline). Without it, one batched
 *                         `gh issue list --state closed` call is made; if
 *                         that fails the script continues with the
 *                         history-based guards only (plans not covered by
 *                         history are skipped, never guessed).
 *
 * Exit codes: 0 success (including no-op) · 1 bad args · 2 I/O error.
 * Node built-ins only, mirrors state.mjs conventions.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { resolveTikiPath } from "./state.mjs";

function die(code, msg) {
  process.stderr.write(`migrate-stale-artifacts.mjs: ${msg}\n`);
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/** Union of every issue number history considers finished. */
function historyIssueNumbers(state) {
  const set = new Set();
  const history = state.history || {};
  for (const rec of history.recentIssues || []) {
    const n = typeof rec === "number" ? rec : rec && rec.number;
    if (Number.isInteger(n)) set.add(n);
  }
  for (const rel of history.recentReleases || []) {
    for (const n of rel.issues || []) {
      if (Number.isInteger(n)) set.add(n);
    }
  }
  return set;
}

/**
 * Closed-issue set: `--closed-issues-file` override, else ONE batched
 * `gh issue list --state closed` call (never per-issue calls). Returns
 * { numbers: Set<number>, titles: Map<number,string>, source: string }.
 * On gh failure returns empty sets with source "unavailable" — callers fall
 * back to history-only guards (skip, never guess).
 */
function loadClosedIssues(args, repoCwd) {
  const numbers = new Set();
  const titles = new Map();
  if (args["closed-issues-file"]) {
    let list;
    try {
      list = readJson(args["closed-issues-file"]);
    } catch (e) {
      die(1, `cannot read --closed-issues-file: ${e.message}`);
    }
    if (!Array.isArray(list)) die(1, `--closed-issues-file must be a JSON array`);
    for (const entry of list) {
      const n = typeof entry === "number" ? entry : entry && entry.number;
      if (Number.isInteger(n)) {
        numbers.add(n);
        if (entry && typeof entry.title === "string") titles.set(n, entry.title);
      }
    }
    return { numbers, titles, source: "file" };
  }
  const res = spawnSync(
    "gh",
    ["issue", "list", "--state", "closed", "--limit", "1000", "--json", "number,title"],
    { encoding: "utf-8", cwd: repoCwd }
  );
  if (res.status !== 0 || res.error) {
    process.stderr.write(
      `migrate-stale-artifacts.mjs: WARN gh issue list failed (${
        res.error ? res.error.message : (res.stderr || "").trim()
      }); continuing with history-based guards only\n`
    );
    return { numbers, titles, source: "unavailable" };
  }
  try {
    for (const entry of JSON.parse(res.stdout)) {
      if (Number.isInteger(entry.number)) {
        numbers.add(entry.number);
        if (typeof entry.title === "string") titles.set(entry.number, entry.title);
      }
    }
  } catch (e) {
    die(2, `cannot parse gh issue list output: ${e.message}`);
  }
  return { numbers, titles, source: "gh" };
}

/** ISO date of a git tag's commit, or null. */
function gitTagDate(tag, repoCwd) {
  const res = spawnSync("git", ["log", "-1", "--format=%aI", tag], {
    encoding: "utf-8",
    cwd: repoCwd,
  });
  if (res.status !== 0 || res.error) return null;
  const out = res.stdout.trim();
  return out || null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: node migrate-stale-artifacts.mjs [--dry-run] [--tiki-path <path>] [--closed-issues-file <path>]\n"
    );
    process.exit(0);
  }
  const dryRun = Boolean(args["dry-run"]);
  const tikiPath = resolveTikiPath(args["tiki-path"]);
  if (!fs.existsSync(tikiPath)) die(1, `.tiki not found at ${tikiPath}`);
  const repoCwd = path.dirname(tikiPath);

  const stateFile = path.join(tikiPath, "state.json");
  let state = {};
  if (fs.existsSync(stateFile)) {
    try {
      state = readJson(stateFile);
    } catch (e) {
      die(2, `cannot parse state.json: ${e.message}`);
    }
  }
  const activeWork = state.activeWork || {};
  const historySet = historyIssueNumbers(state);
  const closed = loadClosedIssues(args, repoCwd);

  const plansDir = path.join(tikiPath, "plans");
  const plansArchiveDir = path.join(plansDir, "archive");
  const releasesDir = path.join(tikiPath, "releases");
  const releasesArchiveDir = path.join(releasesDir, "archive");

  /** @type {{action:string, from?:string, to?:string, detail?:string}[]} */
  const actions = [];
  const skips = [];

  // ---- 2. Stale plans ------------------------------------------------------
  const planMoves = [];
  if (fs.existsSync(plansDir)) {
    for (const name of fs.readdirSync(plansDir).sort()) {
      const m = /^issue-(\d+)\.json$/.exec(name);
      if (!m) continue;
      const n = Number(m[1]);
      const entry = activeWork[`issue:${n}`];
      if (entry && entry.status !== "completed") {
        skips.push(`plan issue-${n}: active in activeWork (${entry.status})`);
        continue;
      }
      const finished = historySet.has(n) || closed.numbers.has(n);
      if (!finished) {
        skips.push(`plan issue-${n}: not in history and not known closed`);
        continue;
      }
      planMoves.push({ n, name });
    }
  }

  // ---- 3. Stranded release defs -------------------------------------------
  const defMoves = [];
  if (fs.existsSync(releasesDir)) {
    for (const name of fs.readdirSync(releasesDir).sort()) {
      const m = /^(v[\w.-]+)\.json$/.exec(name);
      if (!m) continue;
      const version = m[1];
      let def;
      try {
        def = readJson(path.join(releasesDir, name));
      } catch (e) {
        skips.push(`release ${version}: unparseable (${e.message})`);
        continue;
      }
      const rel = activeWork[`release:${version}`];
      if (rel && rel.status !== "completed") {
        skips.push(`release ${version}: active in activeWork (${rel.status})`);
        continue;
      }
      if (def.status !== "completed" && def.status !== "shipped") {
        skips.push(`release ${version}: status '${def.status}' not completed/shipped`);
        continue;
      }
      defMoves.push({ version, name, def });
    }
  }

  // ---- 4. Ghost defs -------------------------------------------------------
  const hasDef = (version) =>
    fs.existsSync(path.join(releasesDir, `${version}.json`)) ||
    fs.existsSync(path.join(releasesArchiveDir, `${version}.json`)) ||
    defMoves.some((d) => d.version === version);
  const historyVersions = new Set(
    (state.history?.recentReleases || []).map((r) => r.version)
  );

  const ghostWrites = [];
  for (const rec of state.history?.recentReleases || []) {
    if (!rec.version || hasDef(rec.version)) continue;
    const issues = (rec.issues || []).map((n) => ({
      number: n,
      title: closed.titles.get(n) || `Issue #${n}`,
    }));
    const tag = rec.tag || rec.version;
    ghostWrites.push({
      version: rec.version,
      source: "history",
      def: {
        version: rec.version,
        status: "shipped",
        issues,
        createdAt: gitTagDate(tag, repoCwd) || rec.completedAt || new Date().toISOString(),
        completedAt: rec.completedAt,
        shipped: true,
        tag,
        reconstructed: true,
      },
    });
  }

  // 4b. Changelog-only ghosts (absent from history too, e.g. v0.7.4).
  if (fs.existsSync(releasesDir)) {
    for (const name of fs.readdirSync(releasesDir).sort()) {
      const m = /^(v[\w.-]+)-changelog\.md$/.exec(name);
      if (!m) continue;
      const version = m[1];
      if (historyVersions.has(version) || hasDef(version)) continue;
      if (ghostWrites.some((g) => g.version === version)) continue;
      const file = path.join(releasesDir, name);
      const body = fs.readFileSync(file, "utf-8");
      const nums = [...new Set(
        [...body.matchAll(/\/issues\/(\d+)/g)].map((mm) => Number(mm[1]))
      )].sort((a, b) => a - b);
      const createdAt =
        gitTagDate(version, repoCwd) || fs.statSync(file).mtime.toISOString();
      ghostWrites.push({
        version,
        source: "changelog",
        def: {
          version,
          status: "shipped",
          issues: nums.map((n) => ({
            number: n,
            title: closed.titles.get(n) || `Issue #${n}`,
          })),
          createdAt,
          completedAt: createdAt,
          shipped: true,
          tag: version,
          reconstructed: true,
        },
      });
    }
  }

  // ---- Plan / report -------------------------------------------------------
  for (const p of planMoves) {
    actions.push({
      action: "archive-plan",
      from: `plans/${p.name}`,
      to: `plans/archive/${p.name}`,
      detail: "normalize phases[].status -> completed",
    });
  }
  for (const d of defMoves) {
    actions.push({
      action: "archive-release-def",
      from: `releases/${d.name}`,
      to: `releases/archive/${d.name}`,
      detail: `status '${d.def.status}' -> 'shipped'`,
    });
  }
  for (const g of ghostWrites) {
    actions.push({
      action: "reconstruct-release-def",
      to: `releases/archive/${g.version}.json`,
      detail: `from ${g.source} (${g.def.issues.length} issues)`,
    });
  }

  const log = (s) => process.stdout.write(s + "\n");
  log(`migrate-stale-artifacts: tikiPath=${tikiPath}`);
  log(
    `closed-issue source: ${closed.source} (${closed.numbers.size} issues); history covers ${historySet.size} issues`
  );
  for (const a of actions) {
    log(
      `${dryRun ? "[dry-run] " : ""}${a.action}: ${a.from ? a.from + " -> " : ""}${a.to}${
        a.detail ? `  (${a.detail})` : ""
      }`
    );
  }
  for (const s of skips) log(`skip: ${s}`);

  if (actions.length === 0) {
    log("nothing to migrate — no-op.");
    return;
  }
  if (dryRun) {
    log(
      `dry-run: ${planMoves.length} plans, ${defMoves.length} release defs, ${ghostWrites.length} ghost reconstructions planned; nothing written.`
    );
    return;
  }

  // ---- 1. Backup (only when there is work to do) ---------------------------
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(tikiPath, "backups", `migration-${ts}`);
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(stateFile)) {
    fs.copyFileSync(stateFile, path.join(backupDir, "state.json"));
  }
  writeJsonAtomic(path.join(backupDir, "manifest.json"), {
    migratedAt: new Date().toISOString(),
    tikiPath,
    closedIssueSource: closed.source,
    actions,
    skips,
  });

  // ---- Execute -------------------------------------------------------------
  fs.mkdirSync(plansArchiveDir, { recursive: true });
  fs.mkdirSync(releasesArchiveDir, { recursive: true });

  for (const p of planMoves) {
    const from = path.join(plansDir, p.name);
    const to = path.join(plansArchiveDir, p.name);
    if (fs.existsSync(to)) {
      log(`WARN: ${p.name} already in archive; leaving active copy untouched`);
      continue;
    }
    const plan = readJson(from);
    for (const phase of plan.phases || []) {
      if (phase.status !== "completed" && phase.status !== "skipped") {
        phase.status = "completed";
      }
    }
    writeJsonAtomic(from, plan);
    fs.renameSync(from, to);
  }

  for (const d of defMoves) {
    const from = path.join(releasesDir, d.name);
    const to = path.join(releasesArchiveDir, d.name);
    if (fs.existsSync(to)) {
      log(`WARN: ${d.name} already in archive; leaving active copy untouched`);
      continue;
    }
    d.def.status = "shipped";
    writeJsonAtomic(from, d.def);
    fs.renameSync(from, to);
  }

  for (const g of ghostWrites) {
    writeJsonAtomic(path.join(releasesArchiveDir, `${g.version}.json`), g.def);
  }

  log(
    `done: ${planMoves.length} plans archived, ${defMoves.length} release defs archived, ${ghostWrites.length} ghost defs reconstructed. Backup: ${backupDir}`
  );
}

main();
