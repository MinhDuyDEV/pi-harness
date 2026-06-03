/**
 * DCP Extension — Entry Point
 *
 * Thin wiring layer that connects the compress tool, nudge system,
 * artifact tracking, quality metrics, and context event handler
 * into Pi's extension API.
 *
 * P0-P3: Wires structured summaries, artifact tracking, regression detection,
 * block-aware nudges, and enhanced /dcp status.
 */

import type {
  BeforeAgentStartEvent,
  ContextEvent,
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  SessionBeforeCompactEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

import type { Message } from "@earendil-works/pi-ai";
import { DEFAULT_CONFIG, type DCPConfig } from "./config.js";
import {
  cleanupSession,
  getBlocks,
  getPersistentSummary,
  getQualityMetrics,
  getQualityStatus,
  getStats,
  processContextMessages,
  registerCompressTool,
  trackToolCall,
  incrementTurn,
  buildCompressedSummaryMessage,
  getArtifactTracker,
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
    registerCompressTool(pi, config);
    initialized = true;
  }

  // ── Event: input — track turns ──────────────────────────────────────
  pi.on("input", (event: InputEvent, ctx: ExtensionContext) => {
    // Skip mid-stream steers — only count idle prompts and follow-ups
    if (event.streamingBehavior === "steer") return;
    nudge.incTurn();
    // P2: Increment turn for regression detection
    incrementTurn(ctx.cwd);
  });

  // ── Event: tool_result — detect compress + track artifacts ──────────
  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    try {
      if (event.toolName === "compress") {
        nudge.recordCompress();
      }
      // P1: Track all relevant tool calls for artifact tracking
      if (config.artifactTracking.enabled && event.toolName && event.args) {
        trackToolCall(ctx.cwd, event.toolName, event.args, config.artifactTracking.maxFiles);
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
      // P3: Update nudge block context before checking
      const sessionId = ctx.cwd;
      const blocks = getBlocks(sessionId);
      const qualityStatus = getQualityStatus(sessionId);
      nudge.updateBlockContext(blocks.length, qualityStatus);

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
      const sessionId = ctx.cwd;
      const pruned = processContextMessages(event.messages as Message[], sessionId, config);
      return { messages: pruned };
    } catch {
      // best-effort — return unmodified on error
    }
  });

  // ── Event: session_before_compact — enrich with DCP blocks ──────────
  pi.on("session_before_compact", async (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => {
    try {
      ensureInitialized(ctx);
      const sessionId = ctx.cwd;
      const blocks = getBlocks(sessionId);
      const preparation = event.preparation;
      if (!preparation || blocks.length === 0) return;

      const model = ctx.model;
      if (!model) return;

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) return;

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

      // P0: Use persistent summary for enrichment instead of raw blocks
      const ps = getPersistentSummary(sessionId);
      const enrichment = buildCompressedSummaryMessage(ps);

      result.summary += `\n\n## DCP Persistent Summary\n\n${enrichment}`;

      return { compaction: result };
    } catch {
      // Fall through to pi's native compaction
    }
  });

  // ── Event: session_shutdown — clean up state ────────────────────────
  pi.on("session_shutdown", () => {
    cleanupSession(process.cwd());
  });

  // ── Command: /dcp — enhanced status display ─────────────────────────
  pi.registerCommand("dcp", {
    description: "DCP status — compression blocks, artifact tracking, quality metrics, and nudges",
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
      ];

      // P1: Quality metrics
      if (config.qualityMetrics.enabled) {
        const qm = stats.qualityMetrics;
        if (qm.totalCompressions > 0) {
          const reReadPct = Math.round((qm.reReadsAfterCompress / qm.totalCompressions) * 100);
          lines.push("### Quality Metrics");
          lines.push(`  Compressions: ${qm.totalCompressions}`);
          lines.push(`  Re-reads after compress: ${qm.reReadsAfterCompress} (${reReadPct}%)`);
          lines.push(`  Clean streak: ${qm.cleanCompressions}`);
          if (qm.regressionLog.length > 0) {
            lines.push("  Recent regressions:");
            const recent = qm.regressionLog.slice(-3);
            for (const r of recent) {
              lines.push(`    b${r.blockId} → ${r.file} (gap: ${r.turnGap} turns)`);
            }
          }
          lines.push("");
        }
      }

      // P1: Probe evaluation results
      if (config.probeEvaluation?.enabled && stats.qualityMetrics.lastProbeResults) {
        const pr = stats.qualityMetrics.lastProbeResults;
        lines.push("### Probe Evaluation (last compression)");
        for (const p of pr.probes) {
          const icon = p.pass ? "\uF00C" : "\uF071";
          lines.push(`  ${icon} ${p.name}: ${p.score}/100 — ${p.detail}`);
        }
        const overallIcon = pr.allPassed ? "\uF00C" : "\uF071";
        lines.push(`  ${overallIcon} Overall: ${pr.overallScore}/100`);
        if (stats.qualityMetrics.avgProbeScore > 0) {
          lines.push(`  Running average: ${Math.round(stats.qualityMetrics.avgProbeScore)}/100`);
        }
        if (stats.qualityMetrics.failedProbes > 0) {
          lines.push(`  Failed compressions: ${stats.qualityMetrics.failedProbes}`);
        }
        lines.push("");
      } else if (config.probeEvaluation?.enabled && stats.qualityMetrics.totalCompressions > 0) {
        // Show aggregate if no latest result
        if (stats.qualityMetrics.avgProbeScore > 0) {
          lines.push("### Probe Evaluation");
          lines.push(`  Running average: ${Math.round(stats.qualityMetrics.avgProbeScore)}/100`);
          if (stats.qualityMetrics.failedProbes > 0) {
            lines.push(`  Failed compressions: ${stats.qualityMetrics.failedProbes}`);
          }
          lines.push("");
        }
      }

      // P1: Artifact tracking
      if (config.artifactTracking.enabled) {
        const artifacts = getArtifactTracker(sessionId);
        const totalTracked = artifacts.files_read.length + artifacts.files_modified.length;
        if (totalTracked > 0) {
          lines.push("### Artifact Tracking");
          if (artifacts.files_read.length > 0) {
            lines.push(`  Files read (${artifacts.files_read.length}):`);
            for (const f of artifacts.files_read.slice(0, 10)) {
              lines.push(`    • ${f}`);
            }
            if (artifacts.files_read.length > 10) {
              lines.push(`    … and ${artifacts.files_read.length - 10} more`);
            }
          }
          if (artifacts.files_modified.length > 0) {
            lines.push(`  Files modified (${artifacts.files_modified.length}):`);
            for (const f of artifacts.files_modified.slice(0, 5)) {
              lines.push(`    • ${f}`);
            }
            if (artifacts.files_modified.length > 5) {
              lines.push(`    … and ${artifacts.files_modified.length - 5} more`);
            }
          }
          lines.push("");
        }
      }

      // P0: Persistent summary preview
      if (config.structuredSummary.enabled) {
        const ps = getPersistentSummary(sessionId);
        if (ps.merged_block_ids.length > 0) {
          lines.push("### Persistent Summary");
          lines.push(`  Merged blocks: ${ps.merged_block_ids.join(", ")}`);
          lines.push(`  Files tracked: ${ps.files_read.length} read, ${ps.files_modified.length} modified`);
          lines.push(`  Decisions: ${ps.decisions.length}`);
          lines.push(`  Narrative segments: ${ps.narrative_parts.length}`);
          lines.push(`  Last updated: ${new Date(ps.last_updated).toLocaleTimeString()}`);
          lines.push("");
        }
      }

      // Nudge state
      lines.push(nudgeState.pendingNudge
        ? `\uF071 Pending nudge: "${nudgeState.pendingNudge}"`
        : "No pending nudge");

      const output = lines.filter(Boolean).join("\n");
      if (ctx.hasUI) ctx.ui.notify(output);
      return output;
    },
  });
}
