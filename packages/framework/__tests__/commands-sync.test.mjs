// Parity guard for the workflow command files.
//
// The canonical source of the /tiki:* command files is packages/framework/commands/.
// The repo's dogfood copy at <root>/.claude/commands/tiki/ is a GENERATED artifact —
// it must be regenerated from canonical via `node packages/framework/install.js`
// (run from the repo root) whenever a command file changes. This test fails if the
// two ever drift, so the dogfood copy can't silently fall behind the published source
// (which is exactly what happened to release.md before #230).
//
// Comparison is line-ending-normalized: we care about content parity, not CRLF vs LF.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANONICAL_DIR = join(__dirname, '..', 'commands');
const ROOT = join(__dirname, '..', '..', '..');
const INSTALLED_DIR = join(ROOT, '.claude', 'commands', 'tiki');
// The only legitimate copies are canonical + the installed dogfood copy. A third tree
// under packages/framework/.claude/ was an orphaned, drifted ghost removed in #230.
const ORPHAN_DIR = join(__dirname, '..', '.claude');

const norm = (s) => s.replace(/\r\n/g, '\n');
const mdFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.md')).sort();

test('no orphaned third command tree under packages/framework/.claude', () => {
  assert.equal(
    existsSync(ORPHAN_DIR),
    false,
    `Orphaned command tree re-appeared at ${ORPHAN_DIR}. ` +
      `The only command copies are packages/framework/commands/ (canonical) and ` +
      `<root>/.claude/commands/tiki/ (generated).`,
  );
});

test('installed .claude/commands/tiki exists', () => {
  assert.ok(existsSync(INSTALLED_DIR), `Missing installed copy at ${INSTALLED_DIR}`);
});

test('installed command set matches canonical (no missing/extra files)', () => {
  const canonical = mdFiles(CANONICAL_DIR);
  const installed = mdFiles(INSTALLED_DIR);
  assert.deepEqual(
    installed,
    canonical,
    'Installed command files differ from canonical. ' +
      'Run `node packages/framework/install.js` from the repo root to regenerate.',
  );
});

test('each installed command is byte-for-content identical to canonical', () => {
  for (const f of mdFiles(CANONICAL_DIR)) {
    const canonical = norm(readFileSync(join(CANONICAL_DIR, f), 'utf8'));
    const installed = norm(readFileSync(join(INSTALLED_DIR, f), 'utf8'));
    assert.equal(
      installed,
      canonical,
      `Command "${f}" has drifted between packages/framework/commands/ and ` +
        `.claude/commands/tiki/. Run \`node packages/framework/install.js\` from the ` +
        `repo root to regenerate the dogfood copy from canonical.`,
    );
  }
});
