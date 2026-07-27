#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { assertPackageResourcesLoad } from "./lib/resource-smoke.mjs";

const repoRoot = process.cwd();
let consumerRoot;

function packLocalCore(destination) {
  const coreRoot = resolve(repoRoot, "..", "pi-core");
  assert.ok(
    existsSync(join(coreRoot, "package.json")),
    "PI_E2E_SIBLINGS=local requires a pi-core checkout next to this repo",
  );
  execFileSync("npm", ["run", "build", "--if-present"], {
    cwd: coreRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", destination],
    { cwd: coreRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim().split("\n").at(-1);
  assert.ok(tarball, "npm pack must return a tarball name for pi-core");
  return join(destination, tarball);
}

try {
  consumerRoot = mkdtempSync(join(tmpdir(), "pi-harness-packed-consumer-"));
  writeFileSync(
    join(consumerRoot, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
    "utf8",
  );

  const harnessTarball = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", consumerRoot],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim().split("\n").at(-1);
  assert.ok(harnessTarball, "npm pack must return the harness tarball name");

  const coreSpec = process.env.PI_E2E_SIBLINGS === "local"
    ? packLocalCore(consumerRoot)
    : process.env.PI_CORE_SPEC ?? "@minhduydev/pi-core@0.1.0";
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      coreSpec,
      join(consumerRoot, harnessTarball),
    ],
    { cwd: consumerRoot, stdio: "inherit" },
  );

  const packageRoot = join(consumerRoot, "node_modules", "@minhduydev", "pi-harness");
  for (const leak of [".pi/artifacts", ".pi/MEMORY.md", ".pi/npm"]) {
    if (existsSync(join(packageRoot, leak))) {
      throw new Error(`local runtime path leaked into packed package: ${leak}`);
    }
  }

  const settings = SettingsManager.inMemory({ packages: [packageRoot] });
  settings.setProjectTrusted(true);
  const loader = new DefaultResourceLoader({
    cwd: consumerRoot,
    agentDir: join(consumerRoot, ".pi"),
    settingsManager: settings,
  });
  await loader.reload();

  const summary = assertPackageResourcesLoad(loader, { packageRoot });
  console.error(`✓ packed package smoke: ${JSON.stringify(summary)}`);
} finally {
  if (consumerRoot) rmSync(consumerRoot, { recursive: true, force: true });
}
