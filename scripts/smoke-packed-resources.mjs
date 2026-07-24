#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { normalizePackPath } from "./lib/package-payload.mjs";
import { assertPackageResourcesLoad } from "./lib/resource-smoke.mjs";

const repoRoot = process.cwd();
let packageRoot;
let consumerRoot;

try {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    cwd: repoRoot,
  });
  const files = JSON.parse(output)[0]?.files?.map((file) => file.path) ?? [];
  if (files.length === 0) throw new Error("npm pack returned no files");

  packageRoot = mkdtempSync(join(tmpdir(), "pikit-packed-package-"));
  for (const path of files) {
    const relativePath = normalizePackPath(path);
    const destination = join(packageRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repoRoot, relativePath), destination);
  }

  for (const leak of [".pi/artifacts", ".pi/MEMORY.md", ".pi/npm"]) {
    if (existsSync(join(packageRoot, leak))) {
      throw new Error(`local runtime path leaked into packed package: ${leak}`);
    }
  }

  consumerRoot = mkdtempSync(join(tmpdir(), "pikit-packed-consumer-"));
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
  if (packageRoot) rmSync(packageRoot, { recursive: true, force: true });
}
