#!/usr/bin/env node
// Release-readiness gate (#265). Blocks tagging a release whose issues did not
// actually go through the Tiki workflow. Pure inspection of committed artifacts —
// mutates nothing. Wired into release.md (pre-tag) and release.yml (pre-deploy
// gate); guarded by release-readiness-guard.test.mjs so the call can't be dropped.
//
// Usage: node scripts/check-release-readiness.mjs <version>   (exit 0 pass / 1 fail / 2 usage)
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const stripV = (v) => String(v).replace(/^v/, "");
const readJson = (p) => JSON.parse(readFileSync(p, "utf-8"));

/**
 * Check that release `version` is ready to tag.
 * @param {string} tikiPath absolute path to the project's `.tiki` directory
 * @param {string} version  release version (with or without leading 'v')
 * @returns {Promise<{ ok: boolean, failures: string[], warnings: string[] }>}
 */
export async function checkReleaseReadiness(tikiPath, version) {
  const root = dirname(tikiPath);
  const clean = stripV(version);
  const failures = [];
  const warnings = [];

  // 1. Release def — active or archive, with or without the 'v' prefix.
  const defCandidates = [
    resolve(tikiPath, "releases", `v${clean}.json`),
    resolve(tikiPath, "releases", `${clean}.json`),
    resolve(tikiPath, "releases", "archive", `v${clean}.json`),
    resolve(tikiPath, "releases", "archive", `${clean}.json`),
  ];
  const defPath = defCandidates.find((c) => existsSync(c));
  if (!defPath) {
    failures.push(`release def not found for ${version} (looked in releases/ and releases/archive/)`);
    return { ok: false, failures, warnings };
  }
  const def = readJson(defPath);
  const issues = (def.issues || [])
    .map((i) => (typeof i === "number" ? i : i?.number))
    .filter((n) => typeof n === "number");

  // state.json (for history membership + count).
  let state = null;
  try {
    state = readJson(resolve(tikiPath, "state.json"));
  } catch {
    failures.push("state.json missing or unparseable");
  }
  const recentIssues = new Set((state?.history?.recentIssues || []).map((r) => r.number));

  // 2 + 3. Per issue: archived/audited plan, and present in history.
  for (const n of issues) {
    const planArchived = resolve(tikiPath, "plans", "archive", `issue-${n}.json`);
    const planActive = resolve(tikiPath, "plans", `issue-${n}.json`);
    const planPath = existsSync(planArchived) ? planArchived : existsSync(planActive) ? planActive : null;
    if (!planPath) {
      failures.push(`issue #${n}: no plan file (expected plans/archive/issue-${n}.json)`);
    } else {
      let plan = null;
      try {
        plan = readJson(planPath);
      } catch {
        /* handled below */
      }
      if (!plan) failures.push(`issue #${n}: plan unreadable`);
      else if (plan.audited !== true) failures.push(`issue #${n}: plan not audited (audited !== true)`);
    }
    if (!recentIssues.has(n)) {
      failures.push(`issue #${n}: not in state.json history.recentIssues (did it ship?)`);
    }
  }

  // 4. Version parity across the 5 files version-bump.mjs writes.
  const versionFiles = [
    { path: resolve(root, "package.json"), get: (c) => JSON.parse(c).version },
    { path: resolve(root, "apps/desktop/src-tauri/tauri.conf.json"), get: (c) => JSON.parse(c).version },
    { path: resolve(root, "apps/desktop/src-tauri/Cargo.toml"), get: (c) => (c.match(/^version = "(.*)"/m) || [])[1] },
    { path: resolve(root, "packages/framework/.claude-plugin/plugin.json"), get: (c) => JSON.parse(c).version },
    { path: resolve(tikiPath, ".framework-version"), get: (c) => c.trim() },
  ];
  for (const f of versionFiles) {
    try {
      const v = stripV(f.get(readFileSync(f.path, "utf-8")) || "");
      if (v !== clean) failures.push(`version mismatch: ${f.path} is "${v || "(none)"}", expected "${clean}"`);
    } catch (e) {
      failures.push(`version file unreadable: ${f.path} (${e.message})`);
    }
  }

  // 5. Changelog present.
  const changelogCandidates = [
    resolve(tikiPath, "releases", `v${clean}-changelog.md`),
    resolve(tikiPath, "releases", `${clean}-changelog.md`),
    resolve(tikiPath, "releases", "archive", `v${clean}-changelog.md`),
    resolve(tikiPath, "releases", "archive", `${clean}-changelog.md`),
  ];
  if (!changelogCandidates.some((c) => existsSync(c))) {
    failures.push(`changelog not found (expected releases/v${clean}-changelog.md)`);
  }

  // 6. Reconcile drift — SOFT: a warning (not a failure) if reconcile is unavailable,
  // so the gate is robust outside the monorepo / in test fixtures.
  try {
    const mod = await import(
      pathToFileURL(resolve(root, "packages/framework/scripts/reconcile-state.mjs")).href
    );
    const result = mod.reconcile(tikiPath, { dryRun: true });
    if (result && Array.isArray(result.changes) && result.changes.length > 0) {
      failures.push(`reconcile drift: ${result.changes.length} active issue(s) have recorded≠derived state`);
    }
  } catch (e) {
    warnings.push(`reconcile drift check skipped: ${e.message}`);
  }

  return { ok: failures.length === 0, failures, warnings };
}

// CLI entry point.
const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: node scripts/check-release-readiness.mjs <version>");
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tikiPath = resolve(root, ".tiki");
  checkReleaseReadiness(tikiPath, version)
    .then(({ ok, failures, warnings }) => {
      for (const w of warnings) console.warn(`WARN: ${w}`);
      if (ok) {
        console.log(`✓ Release readiness OK for ${version}.`);
        process.exit(0);
      }
      console.error(`✗ Release readiness FAILED for ${version}:`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    })
    .catch((e) => {
      console.error(`check-release-readiness error: ${e.message}`);
      process.exit(2);
    });
}
