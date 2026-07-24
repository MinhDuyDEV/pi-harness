#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { assertResourcesLoad } from "./lib/resource-smoke.mjs";

const agentDir = mkdtempSync(join(tmpdir(), "pi-harness-smoke-"));
try {
  const settings = SettingsManager.inMemory({ packages: [] });
  settings.setProjectTrusted(true);
  const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir, settingsManager: settings });
  await loader.reload();

  const summary = assertResourcesLoad(loader, { root: process.cwd() });
  console.log(`✓ ${summary}`);
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}

process.exit(0);
