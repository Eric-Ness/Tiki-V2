#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const version = process.argv[2];
if (!version) {
  console.error("Usage: pnpm version-bump <version>");
  console.error("Example: pnpm version-bump 0.2.5");
  process.exit(1);
}

// Strip leading 'v' if present
const cleanVersion = version.replace(/^v/, "");

const files = [
  {
    path: resolve(root, "apps/desktop/src-tauri/tauri.conf.json"),
    update(content) {
      const json = JSON.parse(content);
      json.version = cleanVersion;
      return JSON.stringify(json, null, 2) + "\n";
    },
  },
  {
    path: resolve(root, "apps/desktop/src-tauri/Cargo.toml"),
    update(content) {
      return content.replace(
        /^version = ".*"/m,
        `version = "${cleanVersion}"`
      );
    },
  },
  {
    path: resolve(root, "packages/framework/.claude-plugin/plugin.json"),
    update(content) {
      const json = JSON.parse(content);
      json.version = cleanVersion;
      return JSON.stringify(json, null, 2) + "\n";
    },
  },
];

for (const file of files) {
  try {
    const content = readFileSync(file.path, "utf-8");
    const updated = file.update(content);
    writeFileSync(file.path, updated);
    console.log(`Updated: ${file.path}`);
  } catch (err) {
    console.error(`Failed to update ${file.path}: ${err.message}`);
  }
}

console.log(`\nVersion bumped to ${cleanVersion}`);
