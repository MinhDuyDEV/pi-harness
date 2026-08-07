#!/usr/bin/env node
/**
 * Release gate with two explicit dependency modes:
 *   local    — build/pack sibling checkouts; hermetic pre-publish CI.
 *   registry — require every exact suite pin to exist on npm; final owner gate.
 *
 * Add `--offline` to local mode to run every deterministic local gate without
 * the network-dependent dependency audit. Offline success is not an audit claim.
 *
 * Steps (stop on first failure):
 *   1. npm run check            — validate:skills, package:check, smoke:resources,
 *                                  typechecks, quality, full test suite
 *   2. verify:auto-safe         — Auto-safe E2E against a packed harness plus the
 *                                  sibling versions pinned in .pi/settings.json
 *   3. verify:phase5-packed     — the Phase 5 chain against those same pins
 *   4. npm audit                — security audit unless `--offline`
 *   5. validate:package-payload — deterministic packed-manifest contract
 *   6. smoke:packed             — clean-consumer native Pi resource load
 *
 * No recursion: package steps use `--ignore-scripts`, and this script never invokes
 * `npm publish`/`npm pack` without that flag, so `prepack`/`prepublishOnly`
 * cannot re-enter `check`. The full suite runs exactly once (inside step 1).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const E2E_OVERRIDE_KEYS = [
  "PI_CORE_SPEC",
  "PI_LEARNING_SPEC",
  "PI_SUBAGENTS_SPEC",
  "PI_TODO_SPEC",
  "PI_PHASE5_PACKAGE_SPECS",
];

function parseMode(argv) {
  const raw = argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length);
  if (raw !== "local" && raw !== "registry") {
    process.stderr.write("release:check: pass exactly --mode=local or --mode=registry\n");
    process.exit(2);
  }
  return raw;
}

/**
 * Release gates are hermetic with respect to the scripts' developer-only
 * bisect overrides. In particular, a registry gate must never inherit
 * PI_E2E_SIBLINGS=local and accidentally validate sibling checkouts after its
 * registry preflight.
 */
export function releaseEnvironment(mode, baseEnvironment = process.env) {
  const environment = { ...baseEnvironment };
  delete environment.PI_E2E_SIBLINGS;
  for (const key of E2E_OVERRIDE_KEYS) delete environment[key];
  environment.PI_E2E_SIBLINGS = mode;
  return environment;
}

export function releaseSteps(mode, { audit = true } = {}) {
  return [
    ...(mode === "registry"
      ? [{ name: "registry:preflight", cmd: "npm", args: ["run", "registry:preflight"] }]
      : []),
    { name: "check", cmd: "npm", args: ["run", "check"] },
    { name: "verify:auto-safe", cmd: "npm", args: ["run", "verify:auto-safe"] },
    { name: "verify:phase5-packed", cmd: "npm", args: ["run", "verify:phase5-packed"] },
    ...(audit ? [{ name: "audit", cmd: "npm", args: ["audit"] }] : []),
    { name: "pack:check", cmd: "npm", args: ["run", "pack:check"] },
    { name: "smoke:packed", cmd: "npm", args: ["run", "smoke:packed"] },
  ];
}

function main() {
  const argv = process.argv.slice(2);
  const mode = parseMode(argv);
  const offline = argv.includes("--offline");
  if (offline && mode !== "local") {
    process.stderr.write("release:check: --offline is only valid with --mode=local\n");
    process.exit(2);
  }
  const steps = releaseSteps(mode, { audit: !offline });

  let failed = null;
  const environment = releaseEnvironment(mode);
  for (const step of steps) {
    process.stderr.write(`\nrelease:check[${mode}] ► ${step.name}\n`);
    const result = spawnSync(step.cmd, step.args, {
      stdio: "inherit",
      shell: false,
      env: environment,
    });
    if (result.status !== 0) {
      failed = { name: step.name, status: result.status ?? 1 };
      break;
    }
  }

  if (failed) {
    process.stderr.write(`\nrelease:check: FAILED at "${failed.name}" (exit ${failed.status})\n`);
    process.exit(failed.status);
  }

  const auditClaim = offline ? "audit skipped (offline mode)" : "audit passed";
  process.stderr.write(
    `\nrelease:check[${mode}${offline ? ":offline" : ""}]: OK — full check, Auto-safe E2E, Phase 5 packed E2E, ${auditClaim}, and package validation passed\n`,
  );
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
