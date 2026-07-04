import { execFile } from "node:child_process";
import type { CliRunResult } from "./types.ts";

export interface RunCliOptions {
  bin: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxBuffer?: number;
}

export function defaultTimeoutMs(): number {
  return parseInt(process.env.PI_DIAGNOSTICS_TIMEOUT_MS || "30000", 10);
}

export function fallowTimeoutMs(): number {
  return parseInt(process.env.PI_DIAGNOSTICS_TIMEOUT_MS || "60000", 10);
}

export function runCli(options: RunCliOptions): Promise<CliRunResult> {
  const { bin, args, cwd, signal, timeoutMs, maxBuffer = 2 * 1024 * 1024 } = options;
  const started = Date.now();

  return new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer,
        env: { ...process.env, PATH: process.env.PATH || "" },
      },
      (error, stdout, stderr) => {
        const elapsedMs = Date.now() - started;
        const enoent = error && (error as NodeJS.ErrnoException).code === "ENOENT";
        const exitCode = error
          ? error.code != null
            ? Number(error.code)
            : 1
          : 0;
        resolve({
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode,
          elapsedMs,
          killed: error?.killed === true,
          enoent: enoent === true,
        });
      },
    );

    const onAbort = () => {
      if (!child.killed) child.kill("SIGTERM");
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}