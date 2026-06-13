import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReleaseReadiness } from "../../../scripts/check-release-readiness.mjs";

const VERSION = "9.9.9";

// Build a temp repo root containing the 5 version files + a `.tiki` with a fully
// shipped release. `opts` lets each test break exactly one invariant.
function buildTempRelease(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "tiki-relgate-"));
  const tiki = join(root, ".tiki");
  mkdirSync(join(tiki, "releases", "archive"), { recursive: true });
  mkdirSync(join(tiki, "plans", "archive"), { recursive: true });
  mkdirSync(join(root, "apps", "desktop", "src-tauri"), { recursive: true });
  mkdirSync(join(root, "packages", "framework", ".claude-plugin"), { recursive: true });

  // Version files (mirrors version-bump.mjs's 5 targets).
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: opts.rootVersion ?? VERSION }));
  writeFileSync(join(root, "apps/desktop/src-tauri/tauri.conf.json"), JSON.stringify({ version: VERSION }));
  writeFileSync(join(root, "apps/desktop/src-tauri/Cargo.toml"), `[package]\nversion = "${VERSION}"\n`);
  writeFileSync(join(root, "packages/framework/.claude-plugin/plugin.json"), JSON.stringify({ name: "tiki", version: VERSION }));
  writeFileSync(join(tiki, ".framework-version"), opts.frameworkVersion ?? VERSION);

  // Release def + changelog. `opts.archived` writes the def into releases/archive/
  // (location = the sole "archived" truth); `opts.defStatus` overrides its status field.
  if (opts.def !== false) {
    const defDir = opts.archived ? join(tiki, "releases", "archive") : join(tiki, "releases");
    writeFileSync(
      join(defDir, `v${VERSION}.json`),
      JSON.stringify({ version: `v${VERSION}`, status: opts.defStatus ?? "shipped", issues: [{ number: 1, title: "a" }, { number: 2, title: "b" }] })
    );
  }
  if (opts.changelog !== false) {
    writeFileSync(join(tiki, "releases", `v${VERSION}-changelog.md`), "# v9.9.9");
  }

  // Archived audited plans. `opts.criteria1`/`opts.criteria2` attach a successCriteria[]
  // to the issue's plan (for the #281 unverified-visual-SC surfacing tests).
  const mkplan = (n, audited, criteria) =>
    writeFileSync(
      join(tiki, "plans", "archive", `issue-${n}.json`),
      JSON.stringify({ issue: { number: n }, audited, phases: [], ...(criteria ? { successCriteria: criteria } : {}) })
    );
  if (opts.plan1 !== false) mkplan(1, opts.audited1 ?? true, opts.criteria1);
  if (opts.plan2 !== false) mkplan(2, opts.audited2 ?? true, opts.criteria2);

  // state.json history.
  const recent = opts.recentIssues ?? [{ number: 1, completedAt: "x" }, { number: 2, completedAt: "x" }];
  writeFileSync(join(tiki, "state.json"), JSON.stringify({ schemaVersion: 1, activeWork: {}, history: { recentIssues: recent } }));

  return { root, tiki };
}

function withTempRelease(opts, fn) {
  const { root, tiki } = buildTempRelease(opts);
  return checkReleaseReadiness(tiki, VERSION).finally(() => rmSync(root, { recursive: true, force: true })).then(fn);
}

test("complete release passes (ok, no failures)", () =>
  withTempRelease({}, (r) => {
    assert.equal(r.ok, true, "unexpected failures: " + r.failures.join("; "));
    assert.equal(r.failures.length, 0);
  }));

test("missing audited flag fails for the offending issue", () =>
  withTempRelease({ audited2: false }, (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.includes("#2") && f.toLowerCase().includes("audit")), r.failures.join("; "));
  }));

test("issue absent from history fails", () =>
  withTempRelease({ recentIssues: [{ number: 1, completedAt: "x" }] }, (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.includes("#2") && f.includes("recentIssues")), r.failures.join("; "));
  }));

test("version mismatch fails naming the file", () =>
  withTempRelease({ rootVersion: "0.0.1" }, (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.includes("version mismatch") && f.includes("package.json")), r.failures.join("; "));
  }));

test("missing changelog fails", () =>
  withTempRelease({ changelog: false }, (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.includes("changelog")), r.failures.join("; "));
  }));

test("missing plan fails for the offending issue", () =>
  withTempRelease({ plan2: false }, (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.includes("#2") && f.includes("plan")), r.failures.join("; "));
  }));

test("missing release def fails fast", () =>
  withTempRelease({ def: false }, (r) => {
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => f.includes("release def not found")), r.failures.join("; "));
  }));

// #276: an archived def (location = truth) whose status field is stale-"active"
// gets a SOFT warning — it must not flip the overall gate, only inform.
test("archived def with stale status warns softly (gate still passes)", () =>
  withTempRelease({ archived: true, defStatus: "active" }, (r) => {
    assert.equal(r.ok, true, "should still pass (soft warn only): " + r.failures.join("; "));
    assert.equal(r.failures.length, 0);
    assert.ok(
      r.warnings.some((w) => w.includes('status is "active"') && w.toLowerCase().includes("expected")),
      r.warnings.join("; ")
    );
  }));

// An archived def already at status:"shipped" produces NO such warning.
test("archived def with shipped status produces no stale-status warning", () =>
  withTempRelease({ archived: true, defStatus: "shipped" }, (r) => {
    assert.equal(r.ok, true, "unexpected failures: " + r.failures.join("; "));
    assert.ok(
      !r.warnings.some((w) => w.includes("expected") && w.includes("shipped")),
      "no stale-status warning expected: " + r.warnings.join("; ")
    );
  }));

// #281: an unverified VISUAL success criterion in a release issue's plan gets a SOFT
// warning that names the issue + id + description — and the gate must STILL PASS (it's
// an informational nudge, never a blocker).
test("unverified visual SC surfaces a soft warning (gate still passes)", () =>
  withTempRelease(
    { criteria1: [{ id: "SC2", description: "the panel renders correctly", verified: false }] },
    (r) => {
      assert.equal(r.ok, true, "should still pass (soft warn only): " + r.failures.join("; "));
      assert.equal(r.failures.length, 0);
      assert.ok(
        r.warnings.some(
          (w) => w.includes("#1 SC2") && w.includes("the panel renders correctly") && w.includes("unverified")
        ),
        r.warnings.join("; ")
      );
    }
  ));

// A visual SC matched only by category (not description) is also surfaced.
test("unverified SC matched by visual category surfaces a soft warning", () =>
  withTempRelease(
    { criteria2: [{ id: "SC5", category: "Manual", description: "user confirms the flow end to end", verified: false }] },
    (r) => {
      assert.equal(r.ok, true, "should still pass: " + r.failures.join("; "));
      assert.ok(
        r.warnings.some((w) => w.includes("#2 SC5") && w.includes("unverified")),
        r.warnings.join("; ")
      );
    }
  ));

// Verified SCs and non-visual unverified SCs produce NO such warning.
test("verified or non-visual unverified SCs produce no visual warning", () =>
  withTempRelease(
    {
      criteria1: [{ id: "SC1", description: "the panel renders correctly", verified: true }],
      criteria2: [{ id: "SC2", description: "reconciler advances state from the plan artifact", verified: false }],
    },
    (r) => {
      assert.equal(r.ok, true, "unexpected failures: " + r.failures.join("; "));
      assert.ok(
        !r.warnings.some((w) => w.includes("unverified")),
        "no visual-unverified warning expected: " + r.warnings.join("; ")
      );
    }
  ));
