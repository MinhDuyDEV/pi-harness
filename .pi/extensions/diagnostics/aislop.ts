import { buildBlock } from "./format.ts";
import { formatAislopJson } from "./aislop-format.ts";
import { pathWhich } from "./path.ts";
import { defaultTimeoutMs, runCli } from "./subprocess.ts";
import { truncateForAgent } from "./truncate.ts";
import type { RunBlockResult } from "./types.ts";

export async function runAislopAnalysis(root: string, signal?: AbortSignal): Promise<RunBlockResult | null> {
  const aislopBin = pathWhich("aislop");
  if (!aislopBin) return null;
  const result = await runCli({
    bin: aislopBin,
    args: ["scan", "--json"],
    cwd: root,
    signal,
    timeoutMs: defaultTimeoutMs(),
  });
  const raw = (result.stdout || "").trim();
  if (!raw && result.enoent) return null;
  const formatted = formatAislopJson(raw);
  if (!formatted) return emptyResult(result);
  const truncated = await truncateForAgent(formatted, "aislop");
  return {
    text: buildBlock("aislop (AI slop)", truncated.content.split("\n")),
    meta: {
      id: "aislop",
      exitCode: result.exitCode,
      ok: formatted.includes("No slop") || result.exitCode === 0,
      elapsedMs: result.elapsedMs,
      truncated: truncated.truncated,
      fullOutputPath: truncated.fullOutputPath,
    },
  };
}

function emptyResult(result: { exitCode: number | null; elapsedMs: number }): RunBlockResult {
  return { text: "", meta: { id: "aislop", exitCode: result.exitCode, ok: true, elapsedMs: result.elapsedMs } };
}
