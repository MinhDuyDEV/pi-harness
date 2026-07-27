#!/usr/bin/env node
/**
 * Bootstrap a consumer repository with the minimal pi-harness settings.
 *
 * Usage:
 *   node scripts/init-consumer.mjs <target-repo> [--dry-run] [--no-agents]
 *
 * Behavior:
 *   - Validates templates/consumer-settings.json (must parse as JSON) before writing.
 *   - Copies the template to <target>/.pi/settings.json, or deep-merges only
 *     missing object keys / array entries into an existing valid JSON file.
 *     Existing consumer values are never overwritten.
 *   - Copies missing canonical task profiles to <target>/.pi/agents/ (never
 *     overwrites consumer-owned profiles; use --no-agents to opt out).
 *   - Creates <target>/.pi/artifacts/.gitignore containing "*" so runtime
 *     artifacts stay out of version control.
 *   - Prints next steps. Zero dependencies; writes are atomic (temp + rename).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(SCRIPT_DIR, "..", "templates", "consumer-settings.json");
const BUNDLED_AGENTS_DIR = resolve(SCRIPT_DIR, "..", ".pi", "agents");

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
  let installAgents = true;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--no-agents") installAgents = false;
    else if (arg.startsWith("--")) fail(`unknown flag: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    fail("usage: node scripts/init-consumer.mjs <target-repo> [--dry-run] [--no-agents]");
  }
  return { target: resolve(positional[0]), dryRun, installAgents };
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function npmPackageIdentity(value) {
  if (typeof value !== "string" || !value.startsWith("npm:")) return undefined;
  const spec = value.slice(4);
  const versionSeparator = spec.lastIndexOf("@");
  if (versionSeparator <= 0) return `npm:${spec}`;
  return `npm:${spec.slice(0, versionSeparator)}`;
}

function mergeMissing(template, current, prefix, additions, conflicts) {
  if (Array.isArray(template)) {
    if (!Array.isArray(current)) {
      conflicts.push(prefix);
      return current;
    }
    const merged = [...current];
    const absent = template.filter((candidate) => {
      if (merged.some((entry) => sameJsonValue(entry, candidate))) return false;
      if (prefix !== "packages") return true;
      const identity = npmPackageIdentity(candidate);
      if (!identity) return true;
      if (merged.some((entry) => npmPackageIdentity(entry) === identity)) {
        conflicts.push(`${prefix}[${identity}]`);
        return false;
      }
      return true;
    });
    if (absent.length > 0) {
      additions.push([`${prefix} (appended missing values)`, absent]);
      merged.push(...structuredClone(absent));
    }
    return merged;
  }
  if (isRecord(template)) {
    if (!isRecord(current)) {
      conflicts.push(prefix);
      return current;
    }
    const merged = { ...current };
    for (const [key, child] of Object.entries(template)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      if (!Object.hasOwn(current, key)) {
        additions.push([childPath, child]);
        merged[key] = structuredClone(child);
      } else {
        merged[key] = mergeMissing(child, current[key], childPath, additions, conflicts);
      }
    }
    return merged;
  }
  return current;
}

function mergeExistingSettings(existingRaw, template, settingsPath, dryRun) {
  let existing;
  try {
    existing = JSON.parse(existingRaw);
  } catch {
    console.log("  Existing settings file is not valid JSON; left untouched. Fix it, then compare");
    console.log(`  against the template: ${TEMPLATE_PATH}`);
    return;
  }
  if (!isRecord(existing)) {
    console.log("  Existing settings JSON is not an object; left untouched.");
    return;
  }
  const additions = [];
  const conflicts = [];
  const merged = mergeMissing(template, existing, "", additions, conflicts);
  if (additions.length === 0) {
    console.log(
      conflicts.length === 0
        ? `Skip (already contains every portable setting): ${settingsPath}`
        : `Skip (consumer-owned incompatible settings retained): ${settingsPath}`,
    );
    if (conflicts.length > 0) {
      console.log(`  Incompatible template paths: ${conflicts.join(", ")}`);
    }
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] would merge missing portable settings into ${settingsPath}`);
  } else {
    atomicWrite(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`Merged missing portable settings into ${settingsPath}`);
  }
  console.log("  Added settings paths:");
  for (const [path, value] of additions) {
    console.log(`    ${path} = ${JSON.stringify(value)}`);
  }
  if (conflicts.length > 0) {
    console.log(`  Consumer-owned incompatible paths retained: ${conflicts.join(", ")}`);
  }
}

function bundledAgentFiles() {
  if (!existsSync(BUNDLED_AGENTS_DIR)) return [];
  return readdirSync(BUNDLED_AGENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();
}

function installBundledAgents(target, dryRun) {
  const agentDir = join(target, ".pi", "agents");
  const files = bundledAgentFiles();
  if (files.length === 0) {
    console.log("  No bundled canonical agents found in the harness payload.");
    return;
  }
  for (const file of files) {
    const destination = join(agentDir, file);
    if (existsSync(destination)) {
      console.log(`Skip (exists, not overwriting): ${destination}`);
    } else if (dryRun) {
      console.log(`[dry-run] would write ${destination}`);
    } else {
      mkdirSync(agentDir, { recursive: true });
      atomicWrite(destination, readFileSync(join(BUNDLED_AGENTS_DIR, file), "utf8"));
      console.log(`Wrote ${destination}`);
    }
  }
}

function main() {
  const { target, dryRun, installAgents } = parseArgs(process.argv.slice(2));
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
    mergeExistingSettings(readFileSync(settingsPath, "utf8"), parsed, settingsPath, dryRun);
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

  // Pi's package manifest does not discover `.pi/agents`; pi-subagents
  // discovers project-local profiles. Copy only missing canonical profiles.
  if (installAgents) installBundledAgents(target, dryRun);

  // 4. Next steps
  console.log("");
  console.log("Next steps:");
  console.log("  1. cd into the target repo and install the harness:");
  console.log("       pi install npm:@minhduydev/pi-harness");
  console.log("  2. Start pi and run /init to generate the project context file.");
  console.log("  3. Canonical agents were added only when missing under .pi/agents/;");
  console.log("     use --no-agents if this repository owns its profiles.");
}

main();
