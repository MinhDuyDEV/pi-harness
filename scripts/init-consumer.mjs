#!/usr/bin/env node
/**
 * Bootstrap a consumer repository with the minimal pi-harness settings.
 *
 * Usage:
 *   node scripts/init-consumer.mjs <target-repo> [--dry-run]
 *
 * Behavior:
 *   - Validates templates/consumer-settings.json (must parse as JSON) before writing.
 *   - Copies the template to <target>/.pi/settings.json. Never overwrites an
 *     existing settings file — instead prints the top-level keys the existing
 *     file is missing, as a suggested manual merge.
 *   - Creates <target>/.pi/artifacts/.gitignore containing "*" so runtime
 *     artifacts stay out of version control.
 *   - Prints next steps. Zero dependencies; writes are atomic (temp + rename).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const TEMPLATE_PATH = resolve(SCRIPT_DIR, "..", "templates", "consumer-settings.json");

function fail(message) {
  console.error(`init-consumer: ${message}`);
  process.exit(1);
}

function atomicWrite(path, content) {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, content, { encoding: "utf8", mode: 0o644 });
  renameSync(temp, path);
}

function parseArgs(argv) {
  const positional = [];
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--")) fail(`unknown flag: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    fail("usage: node scripts/init-consumer.mjs <target-repo> [--dry-run]");
  }
  return { target: resolve(positional[0]), dryRun };
}

function loadTemplate() {
  if (!existsSync(TEMPLATE_PATH)) fail(`template not found: ${TEMPLATE_PATH}`);
  const raw = readFileSync(TEMPLATE_PATH, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`template is not valid JSON (${TEMPLATE_PATH}): ${error.message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail(`template must be a JSON object: ${TEMPLATE_PATH}`);
  }
  return { raw, parsed };
}

function suggestMerge(existingRaw, template) {
  let existing;
  try {
    existing = JSON.parse(existingRaw);
  } catch {
    console.log("  Existing settings file is not valid JSON; fix it manually, then compare");
    console.log(`  against the template: ${TEMPLATE_PATH}`);
    return;
  }
  const missing = Object.keys(template).filter((key) => !(key in existing));
  if (missing.length === 0) {
    console.log("  Existing settings already define every top-level template key. Nothing to add.");
    return;
  }
  console.log("  Suggested additions (top-level keys missing from your settings):");
  for (const key of missing) {
    console.log(`    "${key}": ${JSON.stringify(template[key], null, 2).replace(/\n/g, "\n    ")}`);
  }
}

function main() {
  const { target, dryRun } = parseArgs(process.argv.slice(2));
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    fail(`target repo is not a directory: ${target}`);
  }

  const { raw, parsed } = loadTemplate();
  const piDir = join(target, ".pi");
  const settingsPath = join(piDir, "settings.json");
  const artifactsDir = join(piDir, "artifacts");
  const gitignorePath = join(artifactsDir, ".gitignore");
  const prefix = dryRun ? "[dry-run] would" : "";

  // 1. Settings
  if (existsSync(settingsPath)) {
    console.log(`Skip (exists, not overwriting): ${settingsPath}`);
    suggestMerge(readFileSync(settingsPath, "utf8"), parsed);
  } else if (dryRun) {
    console.log(`${prefix} write ${settingsPath}`);
  } else {
    mkdirSync(piDir, { recursive: true });
    atomicWrite(settingsPath, raw);
    console.log(`Wrote ${settingsPath}`);
  }

  // 2. Artifacts gitignore
  if (existsSync(gitignorePath)) {
    console.log(`Skip (exists): ${gitignorePath}`);
  } else if (dryRun) {
    console.log(`${prefix} write ${gitignorePath}`);
  } else {
    mkdirSync(artifactsDir, { recursive: true });
    atomicWrite(gitignorePath, "*\n");
    console.log(`Wrote ${gitignorePath}`);
  }

  // 3. Next steps
  console.log("");
  console.log("Next steps:");
  console.log("  1. cd into the target repo and install the harness:");
  console.log("       pi install npm:@minhduydev/pi-harness");
  console.log("  2. Start pi and run /init to generate the project context file.");
  console.log("  3. Pick the agents you want from the harness (see .pi/agents/ in the package)");
  console.log("     and copy or reference only the ones this repo needs.");
}

main();
