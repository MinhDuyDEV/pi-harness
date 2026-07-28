#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWrite,
  planManagedFile,
  planManagedRegion,
  planStaleManagedDeletes,
  sha256,
} from "./lib/consumer-ownership.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON = readJson(join(PACKAGE_ROOT, "package.json"), "package manifest");
const SETTINGS_TEMPLATE = readJson(
  join(PACKAGE_ROOT, "templates", "consumer-settings.json"),
  "consumer settings template",
);
const POLICY_SOURCE = readFileSync(join(PACKAGE_ROOT, ".pi", "APPEND_SYSTEM.md"), "utf8").trimEnd();
const POLICY_START = "<!-- pi-harness managed policy:start -->";
const POLICY_END = "<!-- pi-harness managed policy:end -->";
const IGNORE_START = "# pi-harness managed runtime state:start";
const IGNORE_END = "# pi-harness managed runtime state:end";
const LOCK_PATH = ".pi/pi-harness.lock.json";
const LOCK_SCHEMA_VERSION = 1;
const CANONICAL_AGENTS = [
  "explore.md",
  "general.md",
  "implementer.md",
  "peer.md",
  "proof-auditor.md",
  "reviewer.md",
  "scout.md",
];
const RUNTIME_IGNORES = [
  ".pi/artifacts/",
  ".pi/git/",
  ".pi/npm/",
  ".pi/cache/",
  ".pi/checkpoints/",
  ".pi/dcp-state/",
  ".pi/harness-runs/",
  ".pi/sessions/",
  ".pi/tasks/",
  ".pi/extensions/node_modules/",
  ".pi/extensions/**/node_modules/",
  ".pi/skills/**/node_modules/",
  ".pi/skills/opensrc/.repos/",
  ".pi/task-registry.json",
  ".pi/task-session-history.json",
  ".pi/.terminal-sessions/",
  ".pi/task-context-packs/",
  ".pi/task-evidence/",
  ".pi/quality-ratchet/",
  ".pi/usage/",
  ".pi/context-usage.jsonl",
  ".pi/ralph-loop.local.md",
  ".pi/.agent-safety-audit.jsonl",
  ".pi/MEMORY.md",
  ".pi/memory/project/user.md",
  ".pi/herdr/",
  ".pi/tmp/",
  ".pi/DECISIONS.md",
  ".pi/git-commit/",
  ".pi/decision-log.jsonl",
  ".pi/trust.json",
  ".pi/auth.json",
  ".pi/models.json",
  ".pi/mcp.json",
  ".pi/mcp-cache.json",
  ".pi/mcp-npx-cache.json",
  ".pi/bash-mode-history",
  ".pi/pi-crash.log",
  ".pi/*.bak",
  ".pi/*.backup",
  ".pi/*.orig",
];

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${description} at ${path}: ${error.message}`);
  }
}

function parseArgs(argv) {
  let dryRun = false;
  let target;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: pi-harness-init [--dry-run] [target-directory]");
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (target) {
      throw new Error(`Unexpected second target directory: ${arg}`);
    } else target = arg;
  }
  return { dryRun, targetRoot: resolve(target ?? process.cwd()) };
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function validateTargetDirectory(targetRoot) {
  const stat = lstatOrNull(targetRoot);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`target must be an existing, non-symlink directory: ${targetRoot}`);
  }
}

function validateManagedPath(targetRoot, consumerPath) {
  const parts = consumerPath.split("/");
  if (consumerPath.startsWith("/") || parts.some((part) => part === "" || part === "..")) {
    throw new Error(`invalid managed path: ${consumerPath}`);
  }
  let current = targetRoot;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatOrNull(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) throw new Error(`managed path contains a symbolic link: ${consumerPath}`);
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new Error(`managed path ancestor is not a directory: ${consumerPath}`);
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeDefaults(defaults, existing) {
  if (!isObject(defaults) || !isObject(existing)) return existing === undefined ? defaults : existing;
  const result = { ...defaults };
  for (const [key, value] of Object.entries(existing)) {
    result[key] = key in defaults ? mergeDefaults(defaults[key], value) : value;
  }
  return result;
}

function packageName(specifier) {
  if (typeof specifier !== "string") return null;
  const value = specifier.startsWith("npm:") ? specifier.slice(4) : specifier;
  if (value.startsWith("@")) {
    const versionAt = value.lastIndexOf("@");
    return versionAt > value.indexOf("/") ? value.slice(0, versionAt) : value;
  }
  const versionAt = value.lastIndexOf("@");
  return versionAt > 0 ? value.slice(0, versionAt) : value;
}

function isManagedPackageSpecifier(specifier, managedName) {
  if (packageName(specifier) === managedName) return true;
  if (typeof specifier !== "string") return false;
  const repositoryName = managedName.startsWith("@") ? managedName.slice(1) : managedName;
  const escapedName = repositoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[:/])${escapedName}(?:\\.git)?(?:[?#]|$)`, "i").test(specifier);
}

function managedPackageSpecs() {
  const companions = SETTINGS_TEMPLATE.packages;
  if (!Array.isArray(companions) || companions.some((entry) => typeof entry !== "string")) {
    throw new Error("Consumer settings template packages must be an array of package specifiers");
  }
  const specs = [`npm:${PACKAGE_JSON.name}@${PACKAGE_JSON.version}`, ...companions];
  for (const specifier of specs) {
    if (!/^npm:@[^/]+\/[^@]+@\d+\.\d+\.\d+$/.test(specifier)) {
      throw new Error(`Harness package is not pinned to an exact version: ${specifier}`);
    }
  }
  return specs;
}

function mergeSettings(existing) {
  const managedPackages = managedPackageSpecs();
  const managedNames = managedPackages.map(packageName).filter(Boolean);
  const currentPackages = Array.isArray(existing.packages) ? existing.packages : [];
  const consumerPackages = currentPackages.filter(
    (specifier) => !managedNames.some((name) => isManagedPackageSpecifier(specifier, name)),
  );
  const merged = mergeDefaults(SETTINGS_TEMPLATE, existing);
  merged.packages = [...managedPackages, ...consumerPackages];
  // Known Full gates are harness-owned. Preserve only consumer extensions that
  // are not part of the portable contract; stale standard/disabled values must
  // not silently turn a Full bootstrap back into a partial one.
  const consumerHarness = isObject(existing["pi-harness"]) ? existing["pi-harness"] : {};
  const fullHarness = structuredClone(SETTINGS_TEMPLATE["pi-harness"]);
  if (isObject(consumerHarness.extensions)) {
    fullHarness.extensions = { ...consumerHarness.extensions, ...fullHarness.extensions };
  }
  merged["pi-harness"] = { ...consumerHarness, ...fullHarness, profile: "full" };
  return merged;
}

function listFiles(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(path);
      else throw new Error(`Managed resource must be a regular file: ${path}`);
    }
  };
  visit(root);
  return result;
}

function managedResources() {
  const resources = new Map();
  const add = (consumerPath, sourcePath) => {
    resources.set(consumerPath, readFileSync(sourcePath, "utf8"));
  };
  add(".pi/ANTI_PATTERNS.md", join(PACKAGE_ROOT, ".pi", "ANTI_PATTERNS.md"));
  resources.set(".pi/artifacts/.gitignore", "*\n");
  for (const file of CANONICAL_AGENTS) {
    add(`.pi/agents/${file}`, join(PACKAGE_ROOT, ".pi", "agents", file));
  }
  const templatesRoot = join(PACKAGE_ROOT, ".pi", "templates");
  for (const path of listFiles(templatesRoot)) {
    add(`.pi/templates/${relative(templatesRoot, path).replaceAll("\\", "/")}`, path);
  }
  return resources;
}

function parseLock(targetRoot, conflicts) {
  const path = join(targetRoot, LOCK_PATH);
  if (!existsSync(path)) return null;
  try {
    const lock = JSON.parse(readFileSync(path, "utf8"));
    if (lock.schemaVersion !== LOCK_SCHEMA_VERSION || !isObject(lock.files)) {
      conflicts.push(`${LOCK_PATH}: unsupported or invalid lock schema`);
      return null;
    }
    return lock;
  } catch (error) {
    conflicts.push(`${LOCK_PATH}: cannot parse ownership record (${error.message})`);
    return null;
  }
}

function planSettings(plans, conflicts, targetRoot) {
  const consumerPath = ".pi/settings.json";
  const path = join(targetRoot, consumerPath);
  let existing = {};
  if (existsSync(path)) {
    if (!lstatSync(path).isFile()) {
      conflicts.push(`${consumerPath}: expected a regular file`);
      return;
    }
    try {
      existing = JSON.parse(readFileSync(path, "utf8"));
      if (!isObject(existing)) throw new Error("top-level value must be an object");
      if (
        existing.packages !== undefined &&
        (!Array.isArray(existing.packages) || existing.packages.some((entry) => typeof entry !== "string"))
      ) {
        throw new Error("packages must be an array of package specifier strings when present");
      }
    } catch (error) {
      conflicts.push(`${consumerPath}: cannot safely merge settings (${error.message})`);
      return;
    }
  }
  const desired = `${JSON.stringify(mergeSettings(existing), null, 2)}\n`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current !== desired) {
    plans.push({ consumerPath, path, content: desired, operation: current === null ? "create" : "update" });
  }
}

function desiredLock(resources, policyBody, ignoreBody) {
  const files = {};
  for (const [consumerPath, content] of [...resources.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    files[consumerPath] = { sha256: sha256(content) };
  }
  files[".pi/APPEND_SYSTEM.md#managed-policy"] = { sha256: sha256(policyBody) };
  files[".gitignore#pi-harness-runtime"] = { sha256: sha256(ignoreBody) };
  return {
    schemaVersion: LOCK_SCHEMA_VERSION,
    harness: { name: PACKAGE_JSON.name, version: PACKAGE_JSON.version },
    packages: managedPackageSpecs(),
    files,
  };
}

function buildPlan(targetRoot) {
  validateTargetDirectory(targetRoot);
  for (const managedPath of [".pi", ".pi/settings.json", LOCK_PATH, ".gitignore"]) {
    validateManagedPath(targetRoot, managedPath);
  }
  const plans = [];
  const conflicts = [];
  const lock = parseLock(targetRoot, conflicts);
  const resources = managedResources();
  const ignoreBody = RUNTIME_IGNORES.join("\n");

  planSettings(plans, conflicts, targetRoot);
  for (const [consumerPath, desired] of resources) {
    planManagedFile(plans, conflicts, lock, targetRoot, consumerPath, desired);
  }
  planManagedRegion({
    plans, conflicts, lock, targetRoot,
    consumerPath: ".pi/APPEND_SYSTEM.md",
    lockKey: ".pi/APPEND_SYSTEM.md#managed-policy",
    startMarker: POLICY_START,
    endMarker: POLICY_END,
    desiredBody: POLICY_SOURCE,
  });
  planManagedRegion({
    plans, conflicts, lock, targetRoot,
    consumerPath: ".gitignore",
    lockKey: ".gitignore#pi-harness-runtime",
    startMarker: IGNORE_START,
    endMarker: IGNORE_END,
    desiredBody: ignoreBody,
  });
  planStaleManagedDeletes(plans, conflicts, lock, targetRoot, new Set(resources.keys()));

  const runtimeDirectory = join(targetRoot, ".pi", "artifacts");
  if (!existsSync(runtimeDirectory)) {
    plans.push({ consumerPath: ".pi/artifacts/", path: runtimeDirectory, operation: "create-directory" });
  } else if (!lstatSync(runtimeDirectory).isDirectory()) {
    conflicts.push(".pi/artifacts/: runtime state path must be a directory");
  }

  const nextLock = `${JSON.stringify(desiredLock(resources, POLICY_SOURCE, ignoreBody), null, 2)}\n`;
  const lockFile = join(targetRoot, LOCK_PATH);
  const currentLock = existsSync(lockFile) ? readFileSync(lockFile, "utf8") : null;
  if (currentLock !== nextLock) {
    plans.push({
      consumerPath: LOCK_PATH,
      path: lockFile,
      content: nextLock,
      operation: currentLock === null ? "create" : "update",
    });
  }
  return { plans, conflicts };
}

function applyPlans(plans, dryRun) {
  for (const plan of plans) {
    if (dryRun) console.log(`[dry-run] would ${plan.operation} ${plan.consumerPath}`);
    else if (plan.operation === "delete") {
      rmSync(plan.path);
      console.log(`Deleted obsolete managed file ${plan.consumerPath}`);
    } else if (plan.operation === "create-directory") {
      mkdirSync(plan.path, { recursive: true });
      console.log(`Created runtime directory ${plan.consumerPath}`);
    } else {
      atomicWrite(plan.path, plan.content);
      console.log(`${plan.operation === "create" ? "Created" : "Updated"} ${plan.consumerPath}`);
    }
  }
}

function run() {
  const { dryRun, targetRoot } = parseArgs(process.argv.slice(2));
  const { plans, conflicts } = buildPlan(targetRoot);
  for (const plan of plans) {
    validateManagedPath(targetRoot, plan.consumerPath.endsWith("/") ? plan.consumerPath.slice(0, -1) : plan.consumerPath);
  }
  if (conflicts.length > 0) {
    for (const conflict of conflicts) console.error(`Conflict: ${conflict}`);
    console.error("No files were changed. Restore the recorded baseline, delete the conflicting managed file to recreate it, or merge the new harness content manually.");
    process.exitCode = 2;
  } else if (plans.length === 0) {
    console.log(`pi-harness ${PACKAGE_JSON.version}: ${targetRoot} is already current.`);
  } else {
    applyPlans(plans, dryRun);
    if (!dryRun) {
      console.log(`\nFull pi-harness ${PACKAGE_JSON.version} bootstrap is ready.`);
      console.log("Start Pi in this repository. Run Pi /init separately when you want Pi to generate or refresh project context.");
      console.log("Full provider adapters are enabled without selecting credentials; missing optional tools are reported by /integration, not installed by init.");
    }
  }
}

try {
  run();
} catch (error) {
  console.error(`pi-harness-init: ${error.message}`);
  process.exitCode = 1;
}
