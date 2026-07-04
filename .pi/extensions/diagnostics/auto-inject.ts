import path from "node:path";
import { defaultChangedSince } from "./params.ts";
import { EXT_TO_RUNNERS, runLanguages, type DiagnosticRunner } from "./lang-runners.ts";
import { runFallowCheckChangedAuto } from "./fallow.ts";
import { resolveDiagnosticsProjectRoot } from "./project-root.ts";
import type { RunBlockResult } from "./types.ts";

export const CONFIG_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".prettierrc",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Pipfile",
]);

const TS_JS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

let lastRunTimestamp = 0;
export const DEBOUNCE_MS = 15_000;

export function shouldSkipAuto(filePath: string): boolean {
  if (process.env.PI_DISABLE_AUTO_DIAGNOSTICS === "true") return true;
  const basename = path.basename(filePath);
  if (CONFIG_FILES.has(basename)) return true;
  const now = Date.now();
  if (now - lastRunTimestamp < DEBOUNCE_MS) return true;
  return false;
}

export function touchDebounce(): void {
  lastRunTimestamp = Date.now();
}

export function activeRunnersForFile(cwd: string, filePath: string): DiagnosticRunner[] {
  const { projectRoot } = resolveDiagnosticsProjectRoot(cwd);
  const ext = path.extname(filePath).toLowerCase();
  const matching = EXT_TO_RUNNERS.get(ext);
  if (!matching?.length) return [];
  return matching.filter((r) => r.detect(projectRoot));
}

export async function runAutoInject(
  cwd: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<RunBlockResult[]> {
  const { projectRoot } = resolveDiagnosticsProjectRoot(cwd);
  const blocks: RunBlockResult[] = [];

  const langResults = await runLanguages(projectRoot, { file: filePath, signal });
  blocks.push(...langResults.filter((b) => b.text));

  if (process.env.PI_DIAGNOSTICS_AUTO_FALLOW === "true") {
    const ext = path.extname(filePath).toLowerCase();
    if (TS_JS_EXT.has(ext)) {
      const fallow = await runFallowCheckChangedAuto(projectRoot, defaultChangedSince(), signal);
      if (fallow?.text) blocks.push(fallow);
    }
  }

  return blocks;
}