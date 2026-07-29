#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

import { buildPerformanceBaseline } from "./lib/performance-baseline.mjs";

const ROOT = resolve(import.meta.dirname, "..");

function boundedInteger(raw, fallback, maximum) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function createLoader() {
  const settingsManager = SettingsManager.inMemory({ packages: [] });
  settingsManager.setProjectTrusted(true);
  return new DefaultResourceLoader({ cwd: ROOT, agentDir: "/tmp", settingsManager });
}

async function measureStartup(samples) {
  const durations = [];
  let loader;
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    loader = createLoader();
    await loader.reload();
    durations.push(performance.now() - started);
  }
  return { durations, loader };
}

async function contextParts(loader) {
  const policyPaths = [resolve(ROOT, "AGENTS.md"), resolve(ROOT, ".pi", "APPEND_SYSTEM.md")];
  const policies = await Promise.all(policyPaths.map((path) => readFile(path, "utf8")));
  const skillDescriptions = loader.getSkills().skills.map((skill) => skill.description ?? "");
  return [...policies, ...skillDescriptions];
}

async function measurePolling(iterations) {
  const target = resolve(ROOT, ".pi", "artifacts", "TODO.md");
  const durations = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await stat(target);
    durations.push(performance.now() - started);
  }
  return durations;
}

const startupSamples = boundedInteger(process.env.PI_HARNESS_BENCH_SAMPLES, 5, 50);
const pollingIterations = boundedInteger(process.env.PI_HARNESS_BENCH_POLL_ITERATIONS, 100, 10_000);
const { durations: startupDurationsMs, loader } = await measureStartup(startupSamples);
const resources = {
  extensions: loader.getExtensions().extensions.length,
  skills: loader.getSkills().skills.length,
  prompts: loader.getPrompts().prompts.length,
  themes: loader.getThemes().themes.length,
};
const report = buildPerformanceBaseline({
  startupDurationsMs,
  contextParts: await contextParts(loader),
  pollingDurationsMs: await measurePolling(pollingIterations),
  pollingIterations,
  resourceCounts: resources,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    startupSamples,
    pollingIterations,
  },
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
