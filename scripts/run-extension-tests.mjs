#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Run all extension tests.
 *
 * Discovers `*.test.ts` files under `.pi/extensions/` recursively
 * (excluding node_modules) and runs them in a single `tsx --test` call.
 * The list is dynamic — adding a new test file is enough, no script
 * edit required. Replaces a previous hand-maintained list of 16 paths
 * and 4 single-file runs (3 of which referenced missing files).
 */
function run(args) {
	const result = spawnSync("npx", ["tsx", ...args], { stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

function findTestFiles(dir) {
	const results = [];
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			results.push(...findTestFiles(fullPath));
		} else if (entry.endsWith(".test.ts") || entry.endsWith(".test.mjs")) {
			results.push(relative(ROOT, fullPath));
		}
	}
	return results;
}

const testFiles = findTestFiles(join(ROOT, ".pi", "extensions")).sort();

if (testFiles.length === 0) {
	console.error("No test files found under .pi/extensions/");
	process.exit(1);
}

run(["--test", ...testFiles]);

