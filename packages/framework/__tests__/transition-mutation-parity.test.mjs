/**
 * Behavioral-parity guard for the state-transition mutation BODY (#232).
 *
 * The transition TABLE is already guarded by
 * packages/shared/src/__tests__/transitions-parity.test.ts. This guards the
 * APPLY logic around it — phase-clear-on-completion, parallelExecution-clear,
 * parentRelease preservation — which state.mjs and state_transition.rs
 * implement independently.
 *
 * This test and the Rust unit test `mutation_body_parity_fixtures` (in
 * apps/desktop/src-tauri/src/state_transition.rs) consume the SAME fixtures:
 * packages/shared/fixtures/transition-mutations.json. The Node side exercises
 * the real `state.mjs transition` CLI; the Rust side calls `apply_transition`
 * directly. If either impl drifts from the shared expected result, that side
 * fails — keeping the two mirrors in lockstep.
 *
 * node:test runner (zero devDeps — see CLAUDE.md on the Windows pnpm block).
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_SHIM = path.resolve(__dirname, "..", "scripts", "state.mjs");
const FIXTURES = path.resolve(__dirname, "..", "..", "shared", "fixtures", "transition-mutations.json");

const tmpDirs = [];
function makeTikiDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-parity-"));
  tmpDirs.push(root);
  const tiki = path.join(root, ".tiki");
  fs.mkdirSync(tiki, { recursive: true });
  return tiki;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function runShim(tikiDir, args) {
  return spawnSync(process.execPath, [STATE_SHIM, ...args, "--tiki-path", tikiDir], {
    encoding: "utf8",
  });
}

/** Drop the volatile lastActivity and any null/undefined keys (mirror of the
 *  Rust test's normalize_entry) so the two languages compare equal. */
function normalize(entry) {
  const copy = { ...entry };
  delete copy.lastActivity;
  for (const k of Object.keys(copy)) {
    if (copy[k] === null || copy[k] === undefined) delete copy[k];
  }
  return copy;
}

const fixtures = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));
assert.ok(Array.isArray(fixtures.cases) && fixtures.cases.length > 0, "fixtures must have cases");

for (const c of fixtures.cases) {
  test(`transition mutation parity: ${c.name}`, () => {
    const tiki = makeTikiDir();
    fs.writeFileSync(path.join(tiki, "state.json"), JSON.stringify(c.before, null, 2));

    const t = c.transition;
    const args = ["transition", c.workId, "--to-status", t.toStatus];
    if (t.toStep) args.push("--to-step", t.toStep);
    if (t.phase) {
      args.push(
        "--phase-current", String(t.phase.current),
        "--phase-total", String(t.phase.total),
        "--phase-status", t.phase.status,
      );
    }
    if (t.parentRelease) args.push("--parent-release", t.parentRelease);

    const res = runShim(tiki, args);
    assert.equal(res.status, 0, `state.mjs transition failed: ${res.stderr || res.stdout}`);

    const after = JSON.parse(fs.readFileSync(path.join(tiki, "state.json"), "utf8"));
    const entry = after.activeWork[c.workId];
    assert.ok(entry, `entry ${c.workId} missing after transition`);
    assert.deepEqual(
      normalize(entry),
      normalize(c.expectedEntry),
      `mutation-body parity drift in case '${c.name}'`,
    );
  });
}

test("append-history issue writes a CompletedIssueRecord-shaped entry", () => {
  const tiki = makeTikiDir();
  fs.writeFileSync(
    path.join(tiki, "state.json"),
    JSON.stringify({ schemaVersion: 1, activeWork: {} }, null, 2),
  );

  const res = runShim(tiki, [
    "append-history", "issue",
    "--number", "7",
    "--title", "Foo",
    "--completed-at", "2026-01-01T00:00:00.000Z",
  ]);
  assert.equal(res.status, 0, `append-history failed: ${res.stderr || res.stdout}`);

  const state = JSON.parse(fs.readFileSync(path.join(tiki, "state.json"), "utf8"));
  // Shape must match @tiki/shared CompletedIssueRecord: { number, title?, completedAt }.
  const expected = { number: 7, title: "Foo", completedAt: "2026-01-01T00:00:00.000Z" };
  assert.deepEqual(state.history.lastCompletedIssue, expected);
  assert.deepEqual(state.history.recentIssues[0], expected);
});
