import { runAislopAnalysis } from "./aislop.ts";
import { FALLOW_UNAVAILABLE_MESSAGE, runFallowAnalysis } from "./fallow.ts";
import { detectLanguages, LANG_DIAGNOSTICS, runLanguages } from "./lang-runners.ts";
import { hasTsProject, resolveDiagnosticsProjectRoot } from "./project-root.ts";
import type { DiagnosticBlockMeta, DiagnosticsDetails, ResolvedDiagnosticsParams } from "./types.ts";

export interface FullDiagnosticsResult {
  text: string;
  details: DiagnosticsDetails;
}

export async function runFullDiagnostics(
  cwd: string,
  params: ResolvedDiagnosticsParams,
  signal?: AbortSignal,
): Promise<FullDiagnosticsResult> {
  const { projectRoot, sessionCwd, walkedUp } = resolveDiagnosticsProjectRoot(cwd);
  const detectedLanguages = detectLanguages(projectRoot);
  const blocks: { text: string; meta: DiagnosticBlockMeta }[] = [];

  const langResults = await runLanguages(projectRoot, {
    languages: params.languages,
    file: params.file,
    signal,
  });
  blocks.push(...langResults);

  if (params.includeFallow) {
    const fallow = await runFallowAnalysis(projectRoot, params.scope, params.changedSince, signal);
    if (fallow) blocks.push(fallow);
  }

  if (params.includeAislop) {
    const aislop = await runAislopAnalysis(projectRoot, signal);
    if (aislop) blocks.push(aislop);
  }

  const textBlocks = blocks.map((b) => b.text).filter(Boolean);
  const detailsBase = {
    cwd: sessionCwd,
    projectRoot,
    walkedUp,
    scope: params.scope,
    blocks: blocks.map((b) => b.meta),
    detectedLanguages,
  };

  if (textBlocks.length === 0) {
    const detected = LANG_DIAGNOSTICS.filter((r) => r.detect(projectRoot));
    const parts: string[] = [];
    if (walkedUp) {
      parts.push(`Project root: ${projectRoot} (session cwd: ${sessionCwd})`);
    }
    if (detected.length === 0) {
      parts.push(
        "No supported project detected. Diagnostics support: TypeScript (tsconfig.json), Rust (Cargo.toml), Go (go.mod), Python (pyproject.toml / setup.py). Set PI_DIAGNOSTICS_ROOT to override.",
      );
    } else {
      parts.push(
        "All diagnostics passed cleanly:\n" + detected.map((r) => `  - ${r.label}: no errors`).join("\n"),
      );
    }
    if (params.includeFallow && hasTsProject(projectRoot) && !blocks.some((b) => b.meta.id === "fallow")) {
      parts.push(`Fallow (code quality): ${FALLOW_UNAVAILABLE_MESSAGE}`);
    }

    return { text: parts.join("\n\n"), details: detailsBase };
  }

  const header = walkedUp ? `Project root: ${projectRoot} (session cwd: ${sessionCwd})\n\n` : "";
  return {
    text: header + textBlocks.join("\n\n"),
    details: detailsBase,
  };
}