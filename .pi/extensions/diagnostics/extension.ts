import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  activeRunnersForFile,
  autoFallowEnabled,
  fallowAvailable,
  isAutoDiagnosticPath,
  runAutoInject,
  shouldSkipAuto,
  touchDebounce,
} from "./auto-inject.ts";
import { diagnosticsParamsSchema, resolveParams } from "./params.ts";
import { runFullDiagnostics } from "./run.ts";
import { resolveDiagnosticsProjectRoot } from "./project-root.ts";
import { renderDiagnosticsCall, renderDiagnosticsResult } from "./tool-render.ts";
import { readExtensionGate } from "../lib/harness-settings.js";

const PROMPT_GUIDELINES = [
  "After TS/JS edits, rely on auto-injected language diagnostics when errors appear; call diagnostics with scope=changed before claiming work is done on TS/JS.",
  "Use languages=[typescript] or includeFallow/includeAislop false to avoid a full-repo sweep.",
  "Set file= when you only need compile/lint for one edited path; Fallow stays project-scoped.",
  "Do not run full diagnostics on every tiny edit if auto-inject already reported errors.",
];

export default function (pi: ExtensionAPI) {
  if (!readExtensionGate(undefined, "diagnostics", false)) return;
  pi.registerTool({
    name: "diagnostics",
    label: "Diagnostics",
    description:
      "Run code diagnostics on the current project. Auto-detects TypeScript, Rust, Go, and Python. For TS/JS, optionally runs Fallow (health/dead-code or check-changed) and aislop. Use parameters to scope runs.",
    promptSnippet:
      "Run project diagnostics (compile/lint, optional Fallow + aislop) with optional changed-scope and language filters.",
    promptGuidelines: PROMPT_GUIDELINES,
    parameters: diagnosticsParamsSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const resolved = resolveParams((params || {}) as Record<string, unknown>, ctx.cwd);
      const { text, details } = await runFullDiagnostics(ctx.cwd, resolved, signal);
      // The harness consumed everyone else's events but emitted none of its
      // own (audit roadmap 23). A diagnostics verdict is a signal other
      // extensions correlate with (safety, learning, checkpoints).
      try {
        pi.events?.emit?.("pi-harness:diagnostics:result:v1", {
          version: 1,
          cwd: ctx.cwd,
          details,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // The bus must never break the tool result.
      }
      return {
        content: [{ type: "text" as const, text }],
        details,
      };
    },
    renderCall(args, theme) {
      return renderDiagnosticsCall(args as Record<string, unknown>, theme);
    },
    renderResult(result, options, theme) {
      return renderDiagnosticsResult(result, options, theme);
    },
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const filePath = event.input?.path;
    if (!filePath || typeof filePath !== "string") return;
    if (shouldSkipAuto(filePath)) return;

    const runners = activeRunnersForFile(ctx.cwd, filePath);
    const autoFallowExt = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
    const autoFallow =
      autoFallowEnabled() &&
      fallowAvailable() &&
      isAutoDiagnosticPath(resolveDiagnosticsProjectRoot(ctx.cwd).projectRoot, ctx.cwd, filePath) &&
      autoFallowExt.has(path.extname(filePath).toLowerCase());
    if (!runners.length && !autoFallow) return;

    touchDebounce();

    const blocks = await runAutoInject(ctx.cwd, filePath, ctx.signal);
    const text = blocks
      .map((b) => b.text)
      .filter(Boolean)
      .join("\n\n");
    if (!text) return;

    const label = blocks.map((b) => b.meta.id).join(", ");
    pi.appendEntry("custom", {
      customType: "diagnostics",
      content: [{ type: "text", text: `Diagnostics (${label}):\n\n${text}` }],
      display: true,
      details: { auto: true, file: filePath, blocks: blocks.map((b) => b.meta) },
    });
  });
}
