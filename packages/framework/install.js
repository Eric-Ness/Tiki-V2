#!/usr/bin/env node

/**
 * Tiki Framework Installer
 * Copies Tiki commands to .claude/commands/tiki/ in the target project
 */

import { existsSync, mkdirSync, cpSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_DIR = join(__dirname, 'commands');
const TARGET_DIR = join(process.cwd(), '.claude', 'commands', 'tiki');

function install() {
  console.log('Installing Tiki commands...\n');

  // Check source exists
  if (!existsSync(SOURCE_DIR)) {
    console.error('Error: Source commands directory not found');
    process.exit(1);
  }

  // Create target directory
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true });
    console.log(`Created: ${TARGET_DIR}`);
  }

  // Copy commands
  const commands = readdirSync(SOURCE_DIR).filter(f => f.endsWith('.md'));

  for (const cmd of commands) {
    const source = join(SOURCE_DIR, cmd);
    const target = join(TARGET_DIR, cmd);
    cpSync(source, target);
    console.log(`  Installed: tiki:${cmd.replace('.md', '')}`);
  }

  console.log(`\nInstalled ${commands.length} commands.`);
  console.log('\nAvailable commands:');
  for (const cmd of commands) {
    console.log(`  /tiki:${cmd.replace('.md', '')}`);
  }
}

install();
