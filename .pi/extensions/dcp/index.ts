/**
 * DCP Extension — Entry Point
 *
 * Thin wiring layer that connects the compress tool, nudge system,
 * and context event handler into Pi's extension API.
 */

import type {
  BeforeAgentStartEvent,
  ContextEvent,
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG, type DCPConfig } from "./config.js";
import {
  cleanupSession,
  getBlocks,
  getStats,
  processContextMessages,
  registerCompressTool,
} from "./compress.js";
import { NudgeManager } from "./nudge.js";

export default function dcpExtension(pi: ExtensionAPI): void {
  // Merge with user config from settings if available (config is module-level)
  const config: DCPConfig = { ...DEFAULT_CONFIG };
  if (!config.enabled) return;

  // In-memory state
  const nudge = new NudgeManager(config);

  // Guard: track whether ensureInitialized has run
  let initialized = false;

  function ensureInitialized(ctx: ExtensionContext): void {
    if (initialized) return;
    // Register the compress tool lazily so it has ctx access
    registerCompressTool(pi, config);
    initialized = true;
  }

  // ── Event: input — track turns ──────────────────────────────────────
  pi.on("input", () => {
    nudge.incTurn();
  });

  // ── Event: tool_result — detect compress calls ──────────────────────
  pi.on("tool_result", (event: ToolResultEvent) => {
    try {
      if (event.toolName === "compress") {
        nudge.recordCompress();
      }
    } catch {
      // best-effort
    }
  });

  // ── Event: turn_end — check context usage ───────────────────────────
  pi.on("turn_end", (_event: unknown, ctx: ExtensionContext) => {
    try {
      ensureInitialized(ctx);
      nudge.checkContext(ctx);
    } catch {
      // best-effort
    }
  });

  // ── Event: before_agent_start — inject pending nudge ────────────────
  pi.on("before_agent_start", (_event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
    try {
      ensureInitialized(ctx);
      const nudgeMsg = nudge.consumeNudge();
      if (nudgeMsg) {
        return {
          message: {
            customType: "dcp-nudge",
            content: nudgeMsg,
            display: true,
          },
        };
      }
    } catch {
      // best-effort
    }
  });

  // ── Event: context — apply DCP strategies ───────────────────────────
  pi.on("context", (event: ContextEvent, ctx: ExtensionContext) => {
    try {
      ensureInitialized(ctx);
      const sessionId = ctx.cwd; // use cwd as session identifier
      const pruned = processContextMessages(event.messages as any, sessionId, config);
      return { messages: pruned };
    } catch {
      // best-effort — return unmodified on error
    }
  });

  // ── Event: session_before_compact — enrich with DCP blocks ──────────
  pi.on("session_before_compact", async (event: any, ctx: ExtensionContext) => {
    try {
      ensureInitialized(ctx);
      const sessionId = ctx.cwd;
      const blocks = getBlocks(sessionId);
      const preparation = event.preparation;
      if (!preparation || blocks.length === 0) return;

      // Enrich pi's native compaction by providing a CompactionResult
      // that includes DCP block summaries as context. This replaces pi's
      // own summarization with one that has DCP awareness.
      const model = ctx.model;
      if (!model) return;

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) return;

      // Build DCP-enriched compaction via pi's native compact function
      const { compact } = await import("@earendil-works/pi-coding-agent");
      const result = await compact(
        preparation,
        model,
        auth.apiKey,
        auth.headers,
        undefined,
        ctx.signal,
      );

      if (!result) return;

      // Append DCP block summaries to the compaction summary
      const enrichment = blocks.map(
        (b) => `[DCP b${b.blockId}: ${b.topic}]\n${b.summary}`,
      ).join("\n\n");

      result.summary += `\n\n## DCP Compression Blocks\n\n${enrichment}`;

      return { compaction: result };
    } catch {
      // Fall through to pi's native compaction
    }
  });

  // ── Event: session_shutdown — clean up state ────────────────────────
  pi.on("session_shutdown", () => {
    cleanupSession(process.cwd());
  });

  // ── Command: /dcp — status display ──────────────────────────────────
  pi.registerCommand("dcp", {
    description: "DCP status — compression blocks, context usage, and nudges",
    async handler(_args: string, ctx: ExtensionContext) {
      ensureInitialized(ctx);
      const sessionId = ctx.cwd;
      const blocks = getBlocks(sessionId);
      const stats = getStats(sessionId);
      const nudgeState = nudge.getState();

      const lines: string[] = [
        "## DCP Status",
        "",
        `Context: ${nudgeState.lastContextTokens !== null ? `${Math.round(nudgeState.lastContextTokens / 1000)}k tokens` : "no data"}` +
          (nudgeState.lastContextPercent !== null ? ` (${Math.round(nudgeState.lastContextPercent)}%)` : ""),
        "",
        "### Compression Blocks",
        blocks.length === 0
          ? "  None yet. Use `compress` when a phase is complete."
          : blocks.map((b) => `  b${b.blockId}: ${b.topic} (~${b.summaryTokens} tokens)`).join("\n"),
        "",
        `Total summary buffer: ~${stats.summaryTokens} tokens`,
        `Total stripped: ~${stats.totalStrippedTokens} tokens across ${stats.totalPrunedCount} items`,
        "",
        nudgeState.pendingNudge ? `⚠️ Pending nudge: "${nudgeState.pendingNudge}"` : "No pending nudge",
      ];

      const output = lines.filter(Boolean).join("\n");
      if (ctx.hasUI) ctx.ui.notify(output);
      return output;
    },
  });
}
