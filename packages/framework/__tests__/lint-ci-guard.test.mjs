import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Encodes the "lint must stay gated in CI" invariant (#282), mirroring
// release-readiness-guard.test.mjs. `pnpm lint` accumulated 36 errors before
// because it was never run in CI; now pr.yml runs it. If that step is ever
// removed, this fails loudly instead of letting lint rot again.
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..", ".."); // packages/framework/__tests__ -> repo root
const PR_WORKFLOW = resolve(root, ".github/workflows/pr.yml");
const LINT_CMD = "pnpm -C apps/desktop lint";

test("pr.yml runs the lint step (gates on eslint errors)", () => {
  const content = readFileSync(PR_WORKFLOW, "utf-8");
  assert.ok(
    content.includes(LINT_CMD),
    `pr.yml must contain a step running \`${LINT_CMD}\` — the lint CI gate was removed (#282). ` +
      `Without it, ESLint errors can re-accumulate unnoticed (lint isn't part of pnpm test/build).`
  );
});

test("the lint step does not force --max-warnings (warnings stay non-blocking, #282)", () => {
  const content = readFileSync(PR_WORKFLOW, "utf-8");
  // The deliberately warn-level rules (#282: react-compiler advisories,
  // exhaustive-deps, react-refresh) must NOT block CI. Gating is on errors only.
  const lintLine = content
    .split(/\r?\n/)
    .find((l) => l.includes(LINT_CMD));
  assert.ok(lintLine, "expected a line running the lint command");
  assert.ok(
    !/--max-warnings/.test(lintLine),
    "the lint CI step must not pass --max-warnings — warn-level rules (#282) are deliberate and non-blocking; gate on errors only."
  );
});
