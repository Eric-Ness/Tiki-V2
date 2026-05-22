/**
 * Regression assertion for issue #211: every pipeline command file in
 * packages/framework/commands/ must retain its expected `state.mjs transition`
 * invocations. If a future edit drops the transition call (the original bug
 * class — see .tiki/research/worktree-cwd-state-leakage.md §"Why direct
 * /tiki:yolo may also miss transitions"), this test fails with a message
 * naming the file and the missing step.
 *
 * The test walks each `node ... state.mjs transition ... --to-step <STEP>`
 * pairing rather than just grepping for the bare `--to-step` literal, so a
 * stranded mention in prose or a table cannot satisfy the assertion when the
 * corresponding live shim call has been removed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.resolve(__dirname, "..", "commands");

// Per-file required --to-step values. Adding a new pipeline step or command
// file is a one-line change here. Matches the contract in
// .tiki/plans/issue-211.json phase 3.
const EXPECTED_STEPS = {
  "get.md": ["GET"],
  "review.md": ["REVIEW"],
  "plan.md": ["PLAN"],
  "audit.md": ["AUDIT"],
  "execute.md": ["EXECUTE", "SHIP"],
  "ship.md": [],          // terminal: any transition counts, but no step is mandatory
  "yolo.md": ["GET", "REVIEW", "PLAN", "AUDIT", "EXECUTE", "SHIP"],
  "release.md": [],       // release-level: any transition counts
};

// Files where at least one `state.mjs transition` call (with any --to-step)
// must exist, even if no specific step is required.
const REQUIRES_ANY_TRANSITION = new Set(["ship.md", "release.md"]);

// Pair regex: 200-char window allows multi-line shell invocations with
// backslash continuations between `transition` and `--to-step`. Non-greedy
// so it doesn't run past a closing fence to a later invocation.
const PAIR_RE = /state\.mjs\s+transition[\s\S]{0,200}?--to-step\s+([A-Z]+)/g;

function extractPairedSteps(content) {
  const found = new Set();
  for (const match of content.matchAll(PAIR_RE)) {
    found.add(match[1]);
  }
  return found;
}

function countTransitionCalls(content) {
  return (content.match(/state\.mjs\s+transition/g) || []).length;
}

test("every command file retains its expected state.mjs transition --to-step pairings", () => {
  const failures = [];

  for (const [file, required] of Object.entries(EXPECTED_STEPS)) {
    const filePath = path.join(COMMANDS_DIR, file);
    if (!fs.existsSync(filePath)) {
      failures.push(`${file}: file does not exist at ${filePath}`);
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const transitionCalls = countTransitionCalls(content);
    const found = extractPairedSteps(content);

    if (REQUIRES_ANY_TRANSITION.has(file) && transitionCalls === 0) {
      failures.push(
        `${file}: expected at least one 'state.mjs transition' invocation, found 0`
      );
    }

    for (const step of required) {
      if (!found.has(step)) {
        failures.push(
          `${file}: missing 'state.mjs transition ... --to-step ${step}' pairing ` +
          `(found steps: [${[...found].sort().join(", ") || "none"}], ` +
          `transition calls: ${transitionCalls})`
        );
      }
    }
  }

  assert.equal(
    failures.length,
    0,
    `Pipeline transition coverage regressed:\n  - ${failures.join("\n  - ")}\n\n` +
    `Each command file MUST contain its 'state.mjs transition --to-step <STEP>' ` +
    `pairing so the desktop kanban board reflects pipeline progress (issue #211).`
  );
});

// Regression assertion for issue #247: yolo.md must NOT reintroduce the
// conditional "the skill will emit it, so the parent won't" dispatch trap. That
// branch (formerly "Pattern A / Pattern B") is exactly how intermediate
// transitions get dropped and the kanban freezes mid-pipeline. The contract is
// now unconditional: always emit the per-step transition from the parent.
test("yolo.md does not reintroduce the conditional-emit (Pattern A/B) trap", () => {
  const filePath = path.join(COMMANDS_DIR, "yolo.md");
  const content = fs.readFileSync(filePath, "utf-8");

  const forbidden = [
    /Pattern A/,
    /Pattern B/,
    /do NOT need to emit/i,
    /you do not have to emit/i,
  ];
  const offenders = forbidden.filter((re) => re.test(content)).map((re) => re.source);

  assert.equal(
    offenders.length,
    0,
    `yolo.md reintroduced conditional transition-emit language [${offenders.join(", ")}]. ` +
    `Transition emission must be UNCONDITIONAL — always emit the per-step shim call from ` +
    `the parent regardless of dispatch (Skill / Agent / Task / inline). Double-emit is a ` +
    `safe no-op; the conditional branch is what drops transitions (issue #247).`
  );

  // And positively assert the unconditional rule is present.
  assert.match(
    content,
    /unconditional|regardless of how you dispatch/i,
    `yolo.md must state the unconditional-emit rule (issue #247).`
  );
});

// Regression assertion for issue #219: the release teardown must append each
// child issue to history.recentIssues (`append-history issue`). Without it, the
// desktop Kanban "Completed" column — which reads only recentIssues — drops
// release-shipped issues even though they were closed. This guards against the
// step silently disappearing from release.md again.
test("release.md teardown appends child issues to history (append-history issue)", () => {
  const filePath = path.join(COMMANDS_DIR, "release.md");
  assert.ok(
    fs.existsSync(filePath),
    `release.md not found at ${filePath}`
  );
  const content = fs.readFileSync(filePath, "utf-8");
  assert.match(
    content,
    /state\.mjs\s+append-history\s+issue/,
    `release.md must invoke 'state.mjs append-history issue' in its teardown so ` +
    `release-shipped child issues land in history.recentIssues and stay visible ` +
    `in the desktop Kanban Completed column (issue #219).`
  );
});
