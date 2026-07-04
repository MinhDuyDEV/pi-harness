import { buildBlock } from "./format.ts";
import { pathWhich } from "./path.ts";
import { defaultTimeoutMs, runCli } from "./subprocess.ts";
import { truncateForAgent } from "./truncate.ts";
import type { RunBlockResult } from "./types.ts";

function formatAislopJson(raw: string): string {
  try {
    const data = raw.startsWith("{") ? JSON.parse(raw) : null;
    if (!data) return "";
    if (!data.scoreable) return "";

    const lines: string[] = [];
    const color = data.score >= 80 ? "OK" : data.score >= 50 ? "WARN" : "FAIL";
    lines.push(`Slop score: ${data.score}/100 (${color})`);

    const summary = data.summary || {};
    const errCount = summary.errors || 0;
    const warnCount = summary.warnings || 0;
    if (errCount > 0 || warnCount > 0) {
      const parts: string[] = [];
      if (errCount > 0) parts.push(`${errCount} errors`);
      if (warnCount > 0) parts.push(`${warnCount} warnings`);
      lines.push(`Findings: ${parts.join(", ")}`);
    }

    const diagnostics = data.diagnostics || [];
    const byEngine = new Map<string, typeof diagnostics>();
    for (const d of diagnostics) {
      const engine = d.engine || "unknown";
      if (!byEngine.has(engine)) byEngine.set(engine, []);
      byEngine.get(engine)!.push(d);
    }

    for (const [engine, diags] of byEngine) {
      const label = (data.engineDefinitions?.[engine]?.label || engine).padEnd(14);
      lines.push(`  ${label}  ${diags.length} finding(s)`);
      for (const d of diags.slice(0, 5)) {
        const tag = d.severity === "error" ? "[ERR]" : d.severity === "warning" ? "[WARN]" : "[INFO]";
        const loc = d.filePath ? `${d.filePath}${d.line ? `:${d.line}` : ""}` : "";
        lines.push(`    ${tag} ${(d.message || "").slice(0, 100)}${loc ? ` (${loc})` : ""}`);
      }
      if (diags.length > 5) lines.push(`    ... and ${diags.length - 5} more`);
    }

    if (lines.length <= 1) return "No slop issues found";
    return lines.join("\n");
  } catch {
    return "";
  }
}

export async function runAislopAnalysis(
  root: string,
  signal?: AbortSignal,
): Promise<RunBlockResult | null> {
  const aislopBin = pathWhich("aislop");
  const npx = pathWhich("npx");
  if (!aislopBin && !npx) return null;

  const useNpx = !aislopBin;
  const bin = useNpx ? npx! : aislopBin!;
  const args = useNpx ? ["--yes", "aislop@latest", "scan", "--json"] : ["scan", "--json"];

  const result = await runCli({
    bin,
    args,
    cwd: root,
    signal,
    timeoutMs: defaultTimeoutMs(),
  });

  const raw = (result.stdout || "").trim();
  if (!raw && result.enoent) return null;

  const formatted = formatAislopJson(raw);
  if (!formatted) {
    return {
      text: "",
      meta: {
        id: "aislop",
        exitCode: result.exitCode,
        ok: true,
        elapsedMs: result.elapsedMs,
      },
    };
  }

  const truncated = await truncateForAgent(formatted, "aislop");
  const text = buildBlock("aislop (AI slop)", truncated.content.split("\n"));
  const ok = formatted.includes("No slop") || result.exitCode === 0;

  return {
    text,
    meta: {
      id: "aislop",
      exitCode: result.exitCode,
      ok,
      elapsedMs: result.elapsedMs,
      truncated: truncated.truncated,
      fullOutputPath: truncated.fullOutputPath,
    },
  };
}