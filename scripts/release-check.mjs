#!/usr/bin/env node
/**
 * Release gate: one coherent path combining the full local check, the security
 * audit, and actual package validation.
 *
 * Steps (stop on first failure):
 *   1. npm run check            — validate:skills, package:check, smoke:resources,
 *                                  typechecks, quality, full test suite
 *   2. verify:auto-safe         — Auto-safe E2E against a packed harness plus the
 *                                  sibling versions pinned in .pi/settings.json
 *   3. verify:phase5-packed     — the Phase 5 chain against those same pins
 *   4. npm audit                — security audit (all deps, not --omit=dev)
 *   5. validate:package-payload — deterministic packed-manifest contract
 *                                  (npm pack --dry-run --json --ignore-scripts)
 *   6. smoke:packed             — clean-consumer native Pi resource load from an
 *                                  installed tarball with its required runtime peer
 *
 * No recursion: package steps use `--ignore-scripts`, and this script never invokes
 * `npm publish`/`npm pack` without that flag, so `prepack`/`prepublishOnly`
 * cannot re-enter `check`. The full suite runs exactly once (inside step 1).
 */
import { spawnSync } from "node:child_process";

const steps = [
  { name: "check", cmd: "npm", args: ["run", "check"] },
  { name: "verify:auto-safe", cmd: "npm", args: ["run", "verify:auto-safe"] },
  // The only gate that reads the real pins end-to-end. It was defined in
  // package.json but wired into nothing, so it never ran.
  { name: "verify:phase5-packed", cmd: "npm", args: ["run", "verify:phase5-packed"] },
  { name: "audit", cmd: "npm", args: ["audit"] },
  { name: "pack:check", cmd: "npm", args: ["run", "pack:check"] },
  { name: "smoke:packed", cmd: "npm", args: ["run", "smoke:packed"] },
];

let failed = null;
for (const step of steps) {
  process.stderr.write(`\nrelease:check ► ${step.name}\n`);
  const result = spawnSync(step.cmd, step.args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    failed = { name: step.name, status: result.status ?? 1 };
    break;
  }
}

if (failed) {
  process.stderr.write(`\nrelease:check: FAILED at "${failed.name}" (exit ${failed.status})\n`);
  process.exit(failed.status);
}

process.stderr.write(
  `\nrelease:check: OK — full check, Auto-safe E2E, Phase 5 packed E2E, audit, and package validation passed\n`,
);
process.exit(0);
