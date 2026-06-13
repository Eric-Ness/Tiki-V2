// Guards for the plugin/desktop distribution of the reconciler (#251 / epic #244).
//
// Two channels deliver the reconciler to installed projects:
//   - Plugin channel: packages/framework/.claude-plugin/plugin.json + hooks/hooks.json
//     reference scripts via ${CLAUDE_PLUGIN_ROOT}.
//   - Copy-install channel: install.js / desktop install_framework copy scripts to
//     <project>/.claude/tiki/scripts/ and write the hook to settings.json.
//
// These tests stand in for `claude plugin validate` (the CLI isn't available in CI):
// they assert the plugin manifest + hooks file are well-formed and reference a real
// script, and that the committed dogfood script copies match canonical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = join(__dirname, '..');
const ROOT = join(FRAMEWORK, '..', '..');

const norm = (s) => s.replace(/\r\n/g, '\n');

test('plugin.json is valid, named "tiki", and references hooks/hooks.json', () => {
  const plugin = JSON.parse(readFileSync(join(FRAMEWORK, '.claude-plugin', 'plugin.json'), 'utf8'));
  // Name must be "tiki" so commands namespace as /tiki:* when loaded as a plugin.
  assert.equal(plugin.name, 'tiki', 'plugin name must be "tiki" to preserve /tiki:* commands');
  assert.equal(plugin.hooks, './hooks/hooks.json', 'plugin must reference its hooks file');
});

test('hooks/hooks.json is well-formed with Stop + SubagentStop running the reconciler via ${CLAUDE_PLUGIN_ROOT}', () => {
  const file = join(FRAMEWORK, 'hooks', 'hooks.json');
  assert.ok(existsSync(file), 'packages/framework/hooks/hooks.json must exist');
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(cfg.hooks && typeof cfg.hooks === 'object', 'hooks.json must have a top-level "hooks" object');

  for (const event of ['Stop', 'SubagentStop']) {
    const groups = cfg.hooks[event];
    assert.ok(Array.isArray(groups) && groups.length > 0, `hooks.json must define ${event}`);
    const cmd = groups[0].hooks?.[0]?.command;
    assert.ok(typeof cmd === 'string', `${event} hook must have a command string`);
    assert.match(cmd, /reconcile-state\.mjs/, `${event} hook must run reconcile-state.mjs`);
    assert.match(cmd, /\$\{CLAUDE_PLUGIN_ROOT\}/, `${event} hook must resolve via \${CLAUDE_PLUGIN_ROOT}`);
  }

  // The referenced script must actually exist in the plugin.
  assert.ok(
    existsSync(join(FRAMEWORK, 'scripts', 'reconcile-state.mjs')),
    'hooks.json references scripts/reconcile-state.mjs which must exist',
  );
});

test('hooks/hooks.json defines a SessionStart hook running bootstrap-scripts.mjs via ${CLAUDE_PLUGIN_ROOT} (#268 Fix A)', () => {
  const cfg = JSON.parse(readFileSync(join(FRAMEWORK, 'hooks', 'hooks.json'), 'utf8'));
  const groups = cfg.hooks?.SessionStart;
  assert.ok(Array.isArray(groups) && groups.length > 0, 'hooks.json must define SessionStart');

  // Some group must run the bootstrap — that's what delivers .claude/tiki/scripts/
  // on plugin-only installs where command bodies can't expand ${CLAUDE_PLUGIN_ROOT}.
  const commands = groups.flatMap((g) => (Array.isArray(g.hooks) ? g.hooks : [])).map((h) => h?.command);
  const bootstrapCmd = commands.find((c) => typeof c === 'string' && /bootstrap-scripts\.mjs/.test(c));
  assert.ok(bootstrapCmd, 'SessionStart must run bootstrap-scripts.mjs');
  assert.match(bootstrapCmd, /\$\{CLAUDE_PLUGIN_ROOT\}/, 'SessionStart hook must resolve via ${CLAUDE_PLUGIN_ROOT}');

  assert.ok(
    existsSync(join(FRAMEWORK, 'scripts', 'bootstrap-scripts.mjs')),
    'hooks.json references scripts/bootstrap-scripts.mjs which must exist',
  );
});

test('committed dogfood scripts (.claude/tiki/scripts) match canonical (packages/framework/scripts)', () => {
  const canonicalDir = join(FRAMEWORK, 'scripts');
  const installedDir = join(ROOT, '.claude', 'tiki', 'scripts');
  assert.ok(
    existsSync(installedDir),
    `Missing installed scripts at ${installedDir}. Run \`node packages/framework/install.js\` from the repo root.`,
  );

  const canonical = readdirSync(canonicalDir).filter((f) => f.endsWith('.mjs')).sort();
  const installed = readdirSync(installedDir).filter((f) => f.endsWith('.mjs')).sort();
  assert.deepEqual(
    installed,
    canonical,
    'Installed scripts differ from canonical. Run `node packages/framework/install.js` to regenerate.',
  );

  for (const f of canonical) {
    const a = norm(readFileSync(join(canonicalDir, f), 'utf8'));
    const b = norm(readFileSync(join(installedDir, f), 'utf8'));
    assert.equal(b, a, `Script "${f}" drifted between canonical and .claude/tiki/scripts/. Re-run install.js.`);
  }
});

test('command files reference scripts at the installed .claude/tiki/scripts path (not the monorepo path)', () => {
  const commandsDir = join(FRAMEWORK, 'commands');
  for (const f of readdirSync(commandsDir).filter((f) => f.endsWith('.md'))) {
    const content = readFileSync(join(commandsDir, f), 'utf8');
    assert.ok(
      !content.includes('packages/framework/scripts/'),
      `${f} still references the monorepo-only path packages/framework/scripts/ — it won't resolve in installed projects. Use .claude/tiki/scripts/.`,
    );
  }
});
