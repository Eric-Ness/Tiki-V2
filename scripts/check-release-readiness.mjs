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

// Canonical "is this a visual/manual success criterion" heuristic (#281).
// MUST stay IDENTICAL (same category set + same term list) to the Rust mirror in
// apps/desktop/src-tauri (tiki_doctor). The single source of truth is
// `.tiki/research/visual-sc-surfacing.md` — update that doc and BOTH sites together.
// A criterion is treated as visual/manual iff its category is one of the set below,
// OR its description matches the stem alternation. Intentionally a heuristic: it flags
// genuine visual SCs and tolerates the rare over-flag (this is an informational
// checklist, never a blocker).
const VISUAL_CATEGORIES = new Set(["visual", "manual", "ux", "ui"]);
const VISUAL_DESC_RE =
  /\b(render|display|look|visual|blink|flicker|fram(e|ing)|snapp|animat|button|panel|badge|colou?r|icon|layout|screen|pixel|scroll|hover|theme|css|styl|tauri:dev|eyes)/i;
const isVisualCriterion = (sc) =>
  VISUAL_CATEGORIES.has(String(sc?.category || "").toLowerCase()) ||
  VISUAL_DESC_RE.test(String(sc?.description || ""));

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

  // Soft footgun-catch (#276): location is the sole truth for "archived", but the
  // JSON `status` field is kept and SHOULD agree (archived ⟹ "shipped"). When the
  // def resolves from the archive/ location yet its status is something else (the
  // v0.9.0 stale-"active" footgun), any status-field reader could be misled. Warn
  // (soft) — the gate stays read-only; the doctor's Normalize action does the fix.
  const fromArchive = /[\\/]archive[\\/]/.test(defPath);
  if (fromArchive && def.status != null && def.status !== "shipped") {
    warnings.push(
      `archived release def for ${version}: status is "${def.status}", expected "shipped" — ` +
        `run Normalize (Diagnostics) or it can mislead any status-field reader (location is the truth)`
    );
  }

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

      // Surface unverified visual/manual success criteria (#281) as SOFT warnings —
      // these can't be auto-verified (they need eyes in tauri:dev/installer), so EXECUTE
      // leaves them verified:false. Never a failure: this is an informational nudge that
      // the gate must not block on (#276 soft-warning convention). Heuristic above is the
      // canonical one shared with the Rust tiki_doctor mirror; see
      // `.tiki/research/visual-sc-surfacing.md`.
      if (plan && Array.isArray(plan.successCriteria)) {
        for (const sc of plan.successCriteria) {
          if (sc?.verified === false && isVisualCriterion(sc)) {
            warnings.push(
              `#${n} ${sc.id}: ${sc.description} — visual/manual criterion left unverified (confirm in tauri:dev/installer)`
            );
          }
        }
      }
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
