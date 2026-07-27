#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildQualityBaseline,
  compareQualityReport,
} from "./lib/quality-ratchet.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const baselinePath = resolve(projectRoot, "quality/aislop-debt-baseline.json");
const aislopCli = resolve(projectRoot, "node_modules/aislop/dist/cli.js");
const update = process.argv.includes("--update");

if (!existsSync(aislopCli)) {
  console.error(
    "quality:ratchet requires the pinned dev dependency `aislop`; " +
      "run the repository install before running project quality gates.",
  );
  process.exit(2);
}

const scan = spawnSync(process.execPath, [aislopCli, "ci", projectRoot], {
  cwd: projectRoot,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (scan.error) {
  throw scan.error;
}

let report;
try {
  report = JSON.parse(scan.stdout);
} catch {
  process.stderr.write(scan.stderr);
  throw new Error(
    `aislop did not emit a JSON report (exit ${scan.status ?? "unknown"})`,
  );
}

if (update) {
  const baseline = buildQualityBaseline(report);
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(
    `Updated full-project quality baseline: score ${baseline.minimumScore}, ` +
      `${baseline.totalFindings} finding(s).`,
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const comparison = compareQualityReport(report, baseline);
if (comparison.passed) {
  console.log(
    `Quality ratchet passed: score ${report.score}, ` +
      `${report.diagnostics.length} accepted finding(s), no project-wide regression.`,
  );
  process.exit(0);
}

if (comparison.regressions.length > 0) {
  console.error("Full-project quality debt regressed:");
  for (const regression of comparison.regressions) {
    console.error(`- ${regression}`);
  }
}
if (comparison.baselineUpdateRequired) {
  console.error("Full-project quality debt improved; lock in the lower baseline:");
  for (const improvement of comparison.improvements) {
    console.error(`- ${improvement}`);
  }
  console.error("Run `npm run quality:ratchet:update`, review the diff, and commit it.");
}
process.exit(1);
