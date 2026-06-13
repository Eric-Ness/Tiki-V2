#!/usr/bin/env node
/**
 * Tiki AUDIT-artifact writer.
 *
 * AUDIT is the one pipeline step that produces no durable on-disk signal of its
 * own: `coverageMatrix` is written by PLAN, and audit.md only READS the plan.
 * That left the state reconciler (issue #245 / epic #244) unable to distinguish
 * AUDIT from PLAN. This script writes the missing artifact — `audited: true` +
 * `auditedAt` — onto `.tiki/plans/issue-<n>.json`, so the reconciler can derive
 * the AUDIT step from disk even when the imperative state.mjs transition was
 * dropped.
 *
 * Usage:
 *   node mark-audited.mjs <issue-number> [--tiki-path <path>] [--dry-run]
 *
 * Run by /tiki:audit on PASS (see audit.md <state-management>). Idempotent:
 * re-running just refreshes auditedAt. Node built-ins only (mirrors state.mjs).
 *
 * Exit codes: 0 success · 1 bad args / missing plan · 2 I/O error.
 */

import path from "node:path";
import process from "node:process";
import { resolveTikiPath } from "./state.mjs";
import { applyAudited } from "./plan.mjs";

function die(code, msg) {
  process.stderr.write(`mark-audited.mjs: ${msg}\n`);
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args._[0];
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) {
    die(1, `missing/invalid <issue-number> (got '${raw}')`);
  }

  // Delegate the actual artifact write to the shared plan.mjs logic — single
  // source for `audited`/`auditedAt` (#275 phase 2). audit.md still invokes
  // this script until phase 3 repoints it to `plan.mjs audited`; the CLI
  // behavior, exit codes, and one-line JSON output stay identical.
  const tikiPath = resolveTikiPath(args["tiki-path"]);
  const result = applyAudited(tikiPath, number, { dryRun: args["dry-run"] === true });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

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
