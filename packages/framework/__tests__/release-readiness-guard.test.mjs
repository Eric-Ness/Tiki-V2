import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Encodes the "don't silently drop the release gate" bug class (#265), mirroring
// command-transition-coverage.test.mjs. If the check-release-readiness.mjs call is
// ever removed from a release surface, this fails loudly instead of letting an
// un-gated release ship.
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..", ".."); // packages/framework/__tests__ -> repo root
const GATE = "check-release-readiness.mjs";

const surfaces = [
  ["canonical release.md", resolve(root, "packages/framework/commands/release.md")],
  ["mirrored release.md", resolve(root, ".claude/commands/tiki/release.md")],
  ["release.yml CI workflow", resolve(root, ".github/workflows/release.yml")],
];

for (const [label, path] of surfaces) {
  test(`${label} invokes the release-readiness gate`, () => {
    const content = readFileSync(path, "utf-8");
    assert.ok(
      content.includes(GATE),
      `${label} (${path}) must invoke ${GATE} — the release-readiness gate was removed (#265). ` +
        `Without it a release can be tagged/built with issues that never went through the workflow.`
    );
  });
}

test("the gate script itself exists", () => {
  const content = readFileSync(resolve(root, "scripts/check-release-readiness.mjs"), "utf-8");
  assert.ok(content.includes("checkReleaseReadiness"), "scripts/check-release-readiness.mjs must export checkReleaseReadiness");
});
