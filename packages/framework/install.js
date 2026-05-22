#!/usr/bin/env node

/**
 * Tiki Framework Installer
 * Copies Tiki commands + scripts into a target project and registers the
 * reconciler hook, so the framework works outside the monorepo.
 *
 *   .claude/commands/tiki/*.md   ← slash commands
 *   .claude/tiki/scripts/*.mjs   ← state.mjs / reconcile-state.mjs / etc.
 *                                  (command bodies + the hook reference this path)
 *   .claude/settings.json        ← Stop/SubagentStop hook running the reconciler
 *
 * This is the "desktop / dogfood copy-install" channel. The other channel is the
 * Claude Code plugin (packages/framework/.claude-plugin + hooks/hooks.json), which
 * reaches the scripts via ${CLAUDE_PLUGIN_ROOT}. Either way the reconciler runs.
 */

import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMMANDS_SOURCE = join(__dirname, 'commands');
const SCRIPTS_SOURCE = join(__dirname, 'scripts');
const COMMANDS_TARGET = join(process.cwd(), '.claude', 'commands', 'tiki');
const SCRIPTS_TARGET = join(process.cwd(), '.claude', 'tiki', 'scripts');
const SETTINGS_FILE = join(process.cwd(), '.claude', 'settings.json');
const TIKI_DIR = join(process.cwd(), '.tiki');
const VERSION_FILE = join(TIKI_DIR, '.framework-version');
const PLUGIN_JSON = join(__dirname, '.claude-plugin', 'plugin.json');

// The reconciler hook command. Project-relative so it resolves from the project
// root in any installed project (the desktop launches its terminal there).
const RECONCILE_CMD = 'node .claude/tiki/scripts/reconcile-state.mjs --quiet';
const HOOK_EVENTS = ['Stop', 'SubagentStop'];

/**
 * Ensure the reconciler Stop/SubagentStop hooks exist in settings.json without
 * clobbering other settings or other hooks. Idempotent AND migration-aware: any
 * prior hook entry whose command mentions reconcile-state.mjs (e.g. an older
 * path) is removed before the canonical entry is re-added.
 */
function ensureReconcilerHook() {
  let settings = {};
  if (existsSync(SETTINGS_FILE)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    } catch {
      settings = {}; // unparseable — start fresh rather than fail the install
    }
  }
  if (typeof settings !== 'object' || settings === null) settings = {};
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const cleaned = groups.filter((group) => {
      const inner = group && Array.isArray(group.hooks) ? group.hooks : [];
      return !inner.some(
        (h) => h && typeof h.command === 'string' && h.command.includes('reconcile-state.mjs'),
      );
    });
    cleaned.push({ hooks: [{ type: 'command', command: RECONCILE_CMD }] });
    settings.hooks[event] = cleaned;
  }

  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
}

function copyDir(source, target, ext, label) {
  if (!existsSync(source)) {
    console.error(`Error: source directory not found: ${source}`);
    process.exit(1);
  }
  mkdirSync(target, { recursive: true });
  const files = readdirSync(source).filter((f) => f.endsWith(ext));
  for (const f of files) {
    cpSync(join(source, f), join(target, f));
  }
  console.log(`  Installed ${files.length} ${label} → ${target}`);
  return files.length;
}

function install() {
  console.log('Installing Tiki framework...\n');

  const commandCount = copyDir(COMMANDS_SOURCE, COMMANDS_TARGET, '.md', 'commands');
  copyDir(SCRIPTS_SOURCE, SCRIPTS_TARGET, '.mjs', 'scripts');

  // Register the reconciler hook (the enforcement that keeps pipeline state
  // correct even when an imperative transition is dropped — epic #244).
  ensureReconcilerHook();
  console.log(`  Registered reconciler hook (Stop + SubagentStop) in ${SETTINGS_FILE}`);

  // Stamp the installed framework version so consumers (desktop app,
  // /tiki:version) can detect when commands are out of date.
  if (existsSync(PLUGIN_JSON)) {
    const { version } = JSON.parse(readFileSync(PLUGIN_JSON, 'utf8'));
    if (!existsSync(TIKI_DIR)) {
      mkdirSync(TIKI_DIR, { recursive: true });
    }
    writeFileSync(VERSION_FILE, version);
    console.log(`  Stamped: .tiki/.framework-version (${version})`);
  }

  console.log(`\nInstalled ${commandCount} commands.`);
  console.log('\nAvailable commands:');
  for (const cmd of readdirSync(COMMANDS_SOURCE).filter((f) => f.endsWith('.md'))) {
    console.log(`  /tiki:${cmd.replace('.md', '')}`);
  }
}

install();
