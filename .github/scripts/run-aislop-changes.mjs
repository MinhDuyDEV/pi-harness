#!/usr/bin/env node

import { loadConfig, scanCommand } from "aislop";

const explicitBase = process.env.AISLOP_BASE?.trim();
const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
if (isCi && !explicitBase) {
  console.error("AISLOP_BASE is required in CI so changed-file analysis cannot silently compare a clean checkout to HEAD.");
  process.exit(2);
}

const base = explicitBase || "HEAD";
const directory = process.cwd();
const config = loadConfig(directory);
const result = await scanCommand(directory, config, {
  changes: true,
  staged: false,
  base,
  verbose: false,
  json: false,
  showHeader: true,
  printBrand: true,
  command: "ci",
});
process.exit(result.exitCode);
