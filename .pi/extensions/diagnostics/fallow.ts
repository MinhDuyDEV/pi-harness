import fs from "node:fs";
import path from "node:path";
import { buildBlock } from "./format.ts";
import {
  formatFallowCheckChanged,
  formatFallowDeadCode,
  formatFallowHealth,
} from "./fallow-format.ts";
import { pathWhich } from "./path.ts";
import { fallowTimeoutMs, runCli } from "./subprocess.ts";
import { truncateForAgent } from "./truncate.ts";
import type { DiagnosticBlockMeta, DiagnosticsScope, RunBlockResult } from "./types.ts";

export type FallowCommandKind = "check-changed" | "health" | "dead-code";

export interface FallowBuildOptions {
  changedSince: string;
}

export const FALLOW_UNAVAILABLE_MESSAGE =
  "Fallow CLI not available. Set FALLOW_BIN or install `fallow` (or use npx -y fallow).";

function addCommonArgs(args: string[]): void {
  args.push("--format", "json", "--quiet");
}

export function buildFallowArgs(command: FallowCommandKind, opts: FallowBuildOptions): string[] {
  const args: string[] = [];
  if (command === "check-changed") {
    addCommonArgs(args);
    args.push("--changed-since", opts.changedSince);
    return args;
  }
  if (command === "health") {
    args.push("health");
    addCommonArgs(args);
    args.push("--changed-since", opts.changedSince, "--score", "--hotspots", "--targets");
    return args;
  }
  args.push("dead-code");
  addCommonArgs(args);
  args.push("--changed-since", opts.changedSince);
  return args;
}

function shouldTryNpxFallback(r: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  enoent?: boolean;
}): boolean {
  if (r.enoent) return true;
  if (r.exitCode === 127) return true;
  if (r.exitCode === 1 && !r.stdout && !r.stderr) return true;
  return false;
}

async function execFallow(
  root: string,
  args: string[],
  signal: AbortSignal | undefined,
): Promise<{
  bin: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  elapsedMs: number;
}> {
  const configured = process.env.FALLOW_BIN;
  const timeoutMs = fallowTimeoutMs();

  const tryRun = async (bin: string, runArgs: string[]) => {
    const result = await runCli({ bin, args: runArgs, cwd: root, signal, timeoutMs });
    return {
      bin,
      args: runArgs,
      stdout: (result.stdout || "").trim(),
      stderr: (result.stderr || "").trim(),
      exitCode: result.exitCode,
      elapsedMs: result.elapsedMs,
      enoent: result.enoent,
    };
  };

  if (configured) {
    return tryRun(configured, args);
  }

  const local = pathWhich("fallow");
  if (local) {
    const r = await tryRun(local, args);
    if (!shouldTryNpxFallback(r)) return r;
  }

  const npx = pathWhich("npx");
  if (!npx) {
    return { bin: "fallow", args, stdout: "", stderr: "", exitCode: 127, elapsedMs: 0, enoent: true };
  }

  return tryRun(npx, ["--yes", "fallow", ...args]);
}

function formatStdout(command: FallowCommandKind, stdout: string): string {
  if (!stdout) return "";
  if (command === "check-changed") return formatFallowCheckChanged(stdout);
  if (command === "health") return formatFallowHealth(stdout);
  return formatFallowDeadCode(stdout);
}

type FallowCommandRun = {
  body: string;
  exitCode: number | null;
  elapsedMs: number;
  truncated?: boolean;
  fullOutputPath?: string;
  unavailable?: boolean;
};

async function runFallowCommand(
  root: string,
  command: FallowCommandKind,
  opts: FallowBuildOptions,
  signal: AbortSignal | undefined,
): Promise<FallowCommandRun> {
  const args = buildFallowArgs(command, opts);
  const exec = await execFallow(root, args, signal);
  if (!exec.stdout && exec.exitCode === 127) {
    return { body: "", exitCode: 127, elapsedMs: exec.elapsedMs, unavailable: true };
  }

  const formatted = formatStdout(command, exec.stdout);
  if (!formatted) {
    return { body: "", exitCode: exec.exitCode, elapsedMs: exec.elapsedMs };
  }

  const truncated = await truncateForAgent(formatted, `fallow-${command}`);
  return {
    body: truncated.content,
    exitCode: exec.exitCode,
    elapsedMs: exec.elapsedMs,
    truncated: truncated.truncated,
    fullOutputPath: truncated.fullOutputPath,
  };
}

export async function runFallowAnalysis(
  root: string,
  scope: DiagnosticsScope,
  changedSince: string,
  signal?: AbortSignal,
): Promise<RunBlockResult | null> {
  if (!fs.existsSync(path.join(root, "tsconfig.json"))) return null;

  const opts = { changedSince };
  const parts: string[] = [];
  let totalElapsed = 0;
  let exitCode: number | null = 0;
  let truncated: boolean | undefined;
  let fullOutputPath: string | undefined;

  let sawUnavailable = false;

  if (scope === "changed") {
    const r = await runFallowCommand(root, "check-changed", opts, signal);
    if (r.unavailable) sawUnavailable = true;
    else if (r.body) parts.push(r.body);
    totalElapsed += r.elapsedMs;
    exitCode = r.exitCode;
    truncated = r.truncated;
    fullOutputPath = r.fullOutputPath;
  } else {
    const health = await runFallowCommand(root, "health", opts, signal);
    if (health.unavailable) sawUnavailable = true;
    else if (health.body) parts.push(health.body);
    totalElapsed += health.elapsedMs;
    exitCode = health.exitCode;
    truncated = health.truncated;
    fullOutputPath = health.fullOutputPath;

    const dead = await runFallowCommand(root, "dead-code", opts, signal);
    if (dead.unavailable) sawUnavailable = true;
    else if (dead.body) parts.push(dead.body);
    totalElapsed += dead.elapsedMs;
    if (dead.exitCode != null && dead.exitCode !== 0) exitCode = dead.exitCode;
    truncated = truncated || dead.truncated;
    fullOutputPath = fullOutputPath || dead.fullOutputPath;
  }

  if (parts.length === 0 && sawUnavailable) {
    const text = buildBlock("Fallow (code quality)", [FALLOW_UNAVAILABLE_MESSAGE]);
    const meta: DiagnosticBlockMeta = {
      id: "fallow",
      exitCode: 127,
      ok: false,
      elapsedMs: totalElapsed,
    };
    return { text, meta };
  }

  if (parts.length === 0 && exitCode === 0) {
    const meta: DiagnosticBlockMeta = {
      id: "fallow",
      exitCode: 0,
      ok: true,
      elapsedMs: totalElapsed,
    };
    return { text: "", meta };
  }

  const inner = [
    ...parts,
    "",
    "  Tip: run `npx fallow` for the full suite.",
  ].join("\n");

  const text = buildBlock("Fallow (code quality)", inner.split("\n"));
  const hasFindings =
    /unused file|high-complexity|refactoring target|total_issues=[1-9]|verdict=fail/i.test(inner);
  const meta: DiagnosticBlockMeta = {
    id: "fallow",
    exitCode,
    ok: !hasFindings && (exitCode === 0 || exitCode === null),
    elapsedMs: totalElapsed,
    truncated,
    fullOutputPath,
  };

  return { text, meta };
}

/** Debounced auto-inject: single check-changed */
export async function runFallowCheckChangedAuto(
  root: string,
  changedSince: string,
  signal?: AbortSignal,
): Promise<RunBlockResult | null> {
  return runFallowAnalysis(root, "changed", changedSince, signal);
}