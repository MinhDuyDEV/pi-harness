#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const roots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [".pi/extensions"];
const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "coverage"]);

function collectTests(root) {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot)) {
    throw new Error(`Test root does not exist: ${root}`);
  }

  const tests = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.mjs"))) {
        tests.push(path);
      }
    }
  }

  visit(absoluteRoot);
  return tests.sort();
}

function containsBunImport(path) {
  return readFileSync(path, "utf8").includes('from "bun:test"') || readFileSync(path, "utf8").includes("from 'bun:test'");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) {
    console.error(`${command} could not be started: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const tests = roots.flatMap(collectTests);
if (tests.length === 0) {
  console.error(`No test files found under: ${roots.join(", ")}`);
  process.exit(1);
}

const bunTests = tests.filter(containsBunImport);
const nodeTests = tests.filter((path) => !containsBunImport(path));
let exitCode = 0;

if (nodeTests.length > 0) {
  console.log(`Running ${nodeTests.length} Node test file(s)`);
  exitCode = run(process.execPath, ["--import", "tsx", "--test", ...nodeTests]) || exitCode;
}

if (bunTests.length > 0) {
  // 27 files import from "bun:test". CI pins bun, but a contributor without
  // it used to get a hard failure from `npm run check` with no explanation
  // (audit H-H). Absent bun now SKIPS those files with an unmissable warning
  // — a skipped suite is visible, a spawn error pretending to be a test
  // failure is not. CI still runs them (bun is installed there).
  const bunAvailable = spawnSync("bun", ["--version"], { stdio: "ignore", shell: false }).status === 0;
  if (bunAvailable) {
    console.log(`Running ${bunTests.length} Bun test file(s)`);
    exitCode = run("bun", ["test", ...bunTests]) || exitCode;
  } else {
    console.warn(
      `\nWARNING: skipped ${bunTests.length} test file(s) that import "bun:test" — ` +
        `bun is not installed. Install bun (https://bun.sh) to run the full suite; ` +
        `CI always does.\n`,
    );
  }
}

process.exit(exitCode);
