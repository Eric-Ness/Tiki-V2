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

// Coverage assertion for issue #272: every workflow command file must append
// the drop-proof intent journal line (`state.mjs journal <workId> --step <STEP>`)
// as its first state action. The journal is the reconciler's floor signal —
// if a future edit drops the journal call, dropped transitions become
// unrecoverable again (the original #244/#272 bug class). Mirrors the
// required-transition-pairs table above: per file, the expected workId prefix
// and the step token(s) that must appear paired with a `state.mjs journal`
// invocation.
const REQUIRED_JOURNAL = {
  "get.md": { workId: "issue:", steps: ["GET"] },
  "review.md": { workId: "issue:", steps: ["REVIEW"] },
  "plan.md": { workId: "issue:", steps: ["PLAN"] },
  "audit.md": { workId: "issue:", steps: ["AUDIT"] },
  "execute.md": { workId: "issue:", steps: ["EXECUTE"] },
  "ship.md": { workId: "issue:", steps: ["SHIP"] },
  "yolo.md": { workId: "issue:", steps: ["GET", "REVIEW", "PLAN", "AUDIT", "EXECUTE", "SHIP"] },
  "release.md": { workId: "release:", steps: ["EXECUTE", "SHIP"] },
};

// Pair regex mirroring PAIR_RE: walks each `state.mjs journal <workId> ...
// --step <STEP>` invocation (journal calls are single-line, but the windowed
// non-greedy form keeps it robust to wrapping) so a stranded prose mention of
// `--step` cannot satisfy the assertion.
const JOURNAL_PAIR_RE =
  /state\.mjs\s+journal\s+(issue:|release:)\S*[\s\S]{0,120}?--step\s+([A-Z]+)/g;

function extractJournalPairs(content) {
  const found = new Set();
  for (const match of content.matchAll(JOURNAL_PAIR_RE)) {
    found.add(`${match[1]}${match[2]}`);
  }
  return found;
}

test("every command file journals its pipeline steps (state.mjs journal, issue #272)", () => {
  const failures = [];

  for (const [file, { workId, steps }] of Object.entries(REQUIRED_JOURNAL)) {
    const filePath = path.join(COMMANDS_DIR, file);
    if (!fs.existsSync(filePath)) {
      failures.push(`${file}: file does not exist at ${filePath}`);
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const found = extractJournalPairs(content);

    for (const step of steps) {
      if (!found.has(`${workId}${step}`)) {
        failures.push(
          `${file}: missing 'state.mjs journal ${workId}{...} --step ${step}' invocation ` +
          `(found journal pairs: [${[...found].sort().join(", ") || "none"}])`
        );
      }
    }
  }

  assert.equal(
    failures.length,
    0,
    `Intent-journal coverage regressed:\n  - ${failures.join("\n  - ")}\n\n` +
    `Each command file MUST append its 'state.mjs journal <workId> --step <STEP>' ` +
    `line as the FIRST state action so the reconciler can reconstruct dropped ` +
    `pipeline steps from .tiki/journal.ndjson (issue #272).`
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

// Source-scan guard for issue #275: once every state.json / plan-file direct
// write has a dedicated shim subcommand (state.mjs parallel/heal-attempt/enrich/
// release-wave, plan.mjs phase/verify-criteria/audited), NO command file may
// keep an "acknowledged direct-JSON write" / "shim does not expose" escape
// hatch. This pins the deletion: a future edit can't quietly reintroduce a raw
// JSON mutation under cover of an acknowledgement paragraph.
//
// IMPORTANT: yolo.md's "Legacy: direct JSON" section is a PATH-RESOLUTION
// fallback (plugin-only installs where `.claude/tiki/scripts/` was never copied
// — issue #268), NOT a surface-gap acknowledgement. The regexes below target the
// acknowledgement phrasings ("...write acknowledged", "shim does not expose",
// "write <field> directly in (the) JSON") and deliberately do NOT match the bare
// words "direct JSON" or yolo's "fall back to the direct-JSON write", so that
// fallback stays untouched.
const FORBIDDEN_ACK_PHRASES = [
  /direct[- ]JSON write acknowledged/i,
  /direct[- ]JSON write is acknowledged/i,
  /shim does not expose/i,
  /write [^\n]*directly in (the )?JSON/i,
];

test("no command file keeps an acknowledged direct-JSON-write escape hatch (issue #275)", () => {
  const failures = [];

  const files = fs
    .readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(COMMANDS_DIR, file), "utf-8");
    for (const re of FORBIDDEN_ACK_PHRASES) {
      const match = content.match(re);
      if (match) {
        failures.push(`${file}: matched forbidden phrase /${re.source}/ → "${match[0]}"`);
      }
    }
  }

  assert.equal(
    failures.length,
    0,
    `Direct-JSON-write acknowledgement reintroduced:\n  - ${failures.join("\n  - ")}\n\n` +
    `Every state.json / plan-file mutation now has a dedicated shim subcommand ` +
    `(state.mjs parallel/heal-attempt/enrich/release-wave, plan.mjs phase/` +
    `verify-criteria/audited). Command files MUST call those instead of writing ` +
    `JSON directly (issue #275). yolo.md's plugin-only "Legacy: direct JSON" ` +
    `path-resolution fallback is exempt and is NOT matched by these regexes.`
  );
});
