/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Archived-release load guard (issue #258, follow-up to #255).
 *
 * Shipped releases live in `.tiki/releases/archive/` and are only returned by the
 * `load_tiki_releases` Tauri command when the caller passes `includeArchived:
 * true`. The Rust side then stamps the location-derived `archived` flag that the
 * sidebar collapses to a `completed` badge (the JSON's own `status` is unreliable —
 * the ship teardown moves a file to archive/ without flipping `status`).
 *
 * #255 fixed the sidebar MOUNT loader to pass the flag, but the watcher-driven
 * reload in `useTikiFileSync` (a full `setReleases()` replace fired on every
 * `releaseChanged` event) still omitted it — so shipped releases vanished or
 * showed a stale `active` badge until a manual refresh remounted the sidebar.
 *
 * Root cause = "two loaders drifted; one forgot the flag." This guard makes that
 * a structural invariant: EVERY `load_tiki_releases` call site in the frontend
 * must pass `includeArchived: true`. (All current consumers — sidebar, watcher
 * reload, dependency graph — want the full historical view; there is no remaining
 * caller that intentionally hides archived releases. If one is ever added, scope
 * it explicitly rather than relaxing this guard.)
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// __tests__ -> utils -> src
const srcDir = path.resolve(here, '..', '..');

const COMMAND = 'load_tiki_releases';
// Match the command ONLY as a single/double-quoted string literal (an actual
// `invoke("load_tiki_releases", …)` call), never a backtick doc-comment mention.
const CALL_RE = /["']load_tiki_releases["']/g;
const ARCHIVE_FLAG_RE = /includeArchived\s*:\s*true/;

/** 1-based line number of a character offset. */
function lineOf(source: string, idx: number): number {
  return source.slice(0, idx).split('\n').length;
}

/**
 * From an opening `{` at `openIdx`, return the balanced `{...}` substring, or null
 * if unbalanced. Naive brace counting — fine for the small, string/brace-free args
 * objects passed to `invoke` here.
 */
function captureBalanced(source: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Returns the 1-based line numbers of `load_tiki_releases` invoke calls whose args
 * object does NOT pass `includeArchived: true`.
 */
export function findReleaseLoadsMissingArchiveFlag(source: string): number[] {
  const violations: number[] = [];
  for (const m of source.matchAll(new RegExp(CALL_RE.source, 'g'))) {
    const idx = m.index ?? 0;
    // The args object is the first `{` after the quoted command name.
    const braceStart = source.indexOf('{', idx + m[0].length);
    if (braceStart === -1) {
      violations.push(lineOf(source, idx)); // call with no args object at all
      continue;
    }
    const block = captureBalanced(source, braceStart);
    if (block === null || !ARCHIVE_FLAG_RE.test(block)) {
      violations.push(lineOf(source, idx));
    }
  }
  return violations;
}

/** Recursively collect *.ts / *.tsx under `dir`, excluding tests and decls. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...collectSourceFiles(abs));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(abs);
    }
  }
  return out;
}

describe('archived-release load guard (#258 regression)', () => {
  it('every load_tiki_releases call site passes includeArchived: true', () => {
    const violations: string[] = [];
    let callSites = 0;
    for (const abs of collectSourceFiles(srcDir)) {
      const source = readFileSync(abs, 'utf8');
      if (!source.includes(COMMAND)) continue;
      const rel = path.relative(srcDir, abs).replace(/\\/g, '/');
      const missing = findReleaseLoadsMissingArchiveFlag(source);
      callSites += (source.match(new RegExp(CALL_RE.source, 'g')) ?? []).length;
      for (const lineNo of missing) violations.push(`${rel}:${lineNo}`);
    }

    // Sanity: the scan actually found the known call sites (sidebar mount, watcher
    // reload, dependency graph). If this drops to 0 the guard has gone blind.
    expect(callSites).toBeGreaterThanOrEqual(3);

    expect(
      violations,
      `load_tiki_releases call site(s) missing includeArchived:true — shipped ` +
        `(archived) releases will be dropped or shown with a stale 'active' badge ` +
        `(#258). Pass { ..., includeArchived: true }:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('detector flags a call missing the flag', () => {
    const bad = 'const r = await invoke("load_tiki_releases", { tikiPath });';
    expect(findReleaseLoadsMissingArchiveFlag(bad)).toEqual([1]);
  });

  it('detector accepts a call passing the flag (single-line and multi-line)', () => {
    const okInline =
      'await invoke("load_tiki_releases", { tikiPath, includeArchived: true });';
    expect(findReleaseLoadsMissingArchiveFlag(okInline)).toEqual([]);

    const okMultiline = [
      'await invoke<TikiRelease[]>("load_tiki_releases", {',
      '  tikiPath: projectTikiPath,',
      '  includeArchived: true,',
      '});',
    ].join('\n');
    expect(findReleaseLoadsMissingArchiveFlag(okMultiline)).toEqual([]);
  });
});
