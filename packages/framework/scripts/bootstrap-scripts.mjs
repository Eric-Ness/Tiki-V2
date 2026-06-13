#!/usr/bin/env node

/**
 * Tiki plugin-channel script bootstrap (SessionStart hook) — Fix A for #268.
 *
 * Command bodies hardcode `node .claude/tiki/scripts/state.mjs`, which exists on
 * copy-installs (install.js puts it there) but NOT on plugin-only installs:
 * `${CLAUDE_PLUGIN_ROOT}` expands only inside hook commands, never inside slash
 * command markdown bodies. This script closes that gap. It runs as a plugin
 * SessionStart hook (see hooks/hooks.json) and copies the plugin's scripts into
 * the project at the path the command bodies expect:
 *
 *   .claude/tiki/scripts/*.mjs   ← every sibling .mjs of this file (including itself)
 *   .claude/tiki/scripts/.version ← idempotency marker (plugin version)
 *
 * Hard constraints (a SessionStart hook fires in EVERY project the user opens,
 * Tiki or not):
 *   - NEVER create `.tiki/` as a side effect. `.tiki/.framework-version` is
 *     stamped only if `.tiki/` already exists. Creating `.claude/tiki/scripts/`
 *     is fine — that's the install target.
 *   - NEVER exit non-zero. A failing SessionStart hook breaks every session in
 *     every project. Any degraded condition (missing plugin.json, copy error)
 *     prints a warning to stderr and exits 0.
 *   - Silent no-op (no output at all) when `.version` already matches the
 *     plugin version, so healthy sessions see zero noise.
 *   - Does NOT touch `.claude/settings.json` — on the plugin channel the
 *     reconciler hook is already delivered via hooks/hooks.json.
 *
 * This is the plugin-channel counterpart of install.js (the desktop/dogfood
 * copy-install channel). Node built-ins only.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

function warn(msg) {
  process.stderr.write(`tiki bootstrap: ${msg}\n`);
}

function bootstrap() {
  // This file lives in the plugin's scripts/ dir (identical layout in the
  // monorepo: packages/framework/scripts/). Plugin root is its parent.
  const scriptsSource = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = dirname(scriptsSource);

  // Plugin version drives the idempotency marker. Tolerate absence/garbage —
  // we still deliver the scripts, just with a degraded marker value.
  let version = null;
  try {
    const pluginJson = join(pluginRoot, '.claude-plugin', 'plugin.json');
    version = JSON.parse(readFileSync(pluginJson, 'utf8')).version ?? null;
  } catch {
    /* fall through to the degraded warning below */
  }
  if (typeof version !== 'string' || version.length === 0) {
    warn('could not read plugin version from .claude-plugin/plugin.json — installing anyway');
    version = 'unknown';
  }

  const target = join(process.cwd(), '.claude', 'tiki', 'scripts');
  const marker = join(target, '.version');

  // Idempotency: skip silently (no output) when already installed at this version.
  if (existsSync(marker) && readFileSync(marker, 'utf8') === version) {
    return;
  }

  mkdirSync(target, { recursive: true });
  for (const f of readdirSync(scriptsSource).filter((f) => f.endsWith('.mjs'))) {
    copyFileSync(join(scriptsSource, f), join(target, f));
  }
  writeFileSync(marker, version);
  process.stdout.write(`tiki: installed framework scripts -> .claude/tiki/scripts/ (v${version})\n`);

  // Stamp the framework version for consumers (desktop app, /tiki:version) —
  // but ONLY if the project already has a .tiki/ dir. Never create .tiki/ here.
  const tikiDir = join(process.cwd(), '.tiki');
  if (existsSync(tikiDir)) {
    // No trailing newline — matches install.js.
    writeFileSync(join(tikiDir, '.framework-version'), version);
  }
}

try {
  bootstrap();
} catch (e) {
  // SessionStart must never fail the session — warn and exit 0.
  warn(`failed: ${e && e.message ? e.message : String(e)}`);
}
process.exitCode = 0;
