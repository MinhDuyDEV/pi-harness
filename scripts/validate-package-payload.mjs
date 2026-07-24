#!/usr/bin/env node
/**
 * CLI: validate the packed payload contract for this package.
 *
 * Runs `npm pack --dry-run --json --ignore-scripts` (no tarball written, no
 * network, no lifecycle scripts) and asserts the manifest satisfies
 * defaultPayloadContract from scripts/lib/package-payload.mjs. Exits non-zero
 * with a listed report on any violation.
 *
 * Composed into `release:check` and CI; not a duplicate of the test-time
 * integration check — this is the gate that fails a release/publish.
 */
import { execFileSync } from "node:child_process";
import {
  validatePackagePayload,
  defaultPayloadContract,
} from "./lib/package-payload.mjs";

function fail(message) {
  console.error(`validate-package-payload: ${message}`);
  process.exit(1);
}

let manifest;
try {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  manifest = JSON.parse(out);
} catch (error) {
  fail(`npm pack failed: ${error instanceof Error ? error.message : String(error)}`);
}

const files = manifest?.[0]?.files;
if (!Array.isArray(files) || files.length === 0) {
  fail("npm pack returned no files");
}

const paths = files.map((f) => f.path);
const { errors } = validatePackagePayload(paths, defaultPayloadContract);

if (errors.length > 0) {
  console.error(`validate-package-payload: ${errors.length} violation(s) in packed payload:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.error(`validate-package-payload: OK (${paths.length} packed files passed contract)`);