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

import {
  convertToLlm,
  serializeConversation,
  type BeforeAgentStartEvent,
  type ContextEvent,
  type ExtensionAPI,
  type ExtensionContext,
  type InputEvent,
  type SessionBeforeCompactEvent,
  type SessionBeforeTreeEvent,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

import type { Message } from "@earendil-works/pi-ai";
import { DEFAULT_CONFIG, type DCPConfig } from "./config.js";
import {
  cleanupSession,
  getBlocks,
  getDcpSessionId,
  getPersistentSummary,
  getQualityMetrics,
  getQualityStatus,
  getStats,
  processContextMessages,
  registerCompressTool,
  trackToolCall,
  incrementTurn,
  buildCompressedSummaryMessage,
  enrichCompactionResult,
  computeRunPruneStats,
  getArtifactTracker,
  makeDcpStateEntryPayload,
  restoreDcpStateFromSessionEntries,
} from "./compress.js";

import {
  buildDeterministicSummary,
  type CompactionReason,
} from "./deterministic.js";
import { getSessionBranchMessages } from "./branch-messages.js";
import { NudgeManager } from "./nudge.js";
import {
  buildContextMeterSnapshot,
  estimateOutboundContextTokens,
} from "./context-meter.js";
import {
  formatPressureSourceLabel,
  resolveAutoCompactThreshold,
} from "./pressure.js";
import { registerRecallTool, searchDcpRecall } from "./recall.js";

interface DcpCompactionMetadata {
  reason: CompactionReason;
  willRetry?: boolean;
  customInstructions?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asMutableRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseCompactionReason(value: unknown): CompactionReason {
  return value === "manual" || value === "threshold" || value === "overflow"
    ? value
    : "unknown";
}

export default function dcpExtension(pi: ExtensionAPI): void {
  // Merge with user config from settings if available (config is module-level)
  const config: DCPConfig = { ...DEFAULT_CONFIG };
  if (!config.enabled) return;

  // In-memory state
  const nudge = new NudgeManager(config);
  let autoCompactInvokePending = false;
  // Guard: track whether ensureInitialized has run
  let initialized = false;

  function appendDcpStateEntry(ctx: ExtensionContext, reason: string): void {
    pi.appendEntry(
      "dcp_state",
      makeDcpStateEntryPayload(getDcpSessionId(ctx), reason),
    );
  }

  function serializeSessionEntries(entries: readonly unknown[]): string {
    return entries
      .map((entry, index) => {
        if (!entry || typeof entry !== "object")
          return `[Entry ${index}] ${String(entry)}`;
        const obj = entry as Record<string, unknown>;
        const type = String(obj.type ?? "entry");
        const payload = obj.summary ?? obj.content ?? obj.data ?? obj;
        return `[${type} ${String(obj.id ?? index)}]: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`;
      })
      .join("\n\n");
  }

  function getCompactionMetadata(event: unknown): DcpCompactionMetadata {
    const record = asRecord(event);
    return {
      reason: parseCompactionReason(record?.reason),
      willRetry:
        typeof record?.willRetry === "boolean" ? record.willRetry : undefined,
      customInstructions:
        typeof record?.customInstructions === "string"
          ? record.customInstructions
          : undefined,
    };
  }

  function getDeterministicTranscriptLimit(
    baseLimit: number,
    reason: CompactionReason,
  ): number {
    if (reason !== "overflow") return baseLimit;
    return Math.max(baseLimit, Math.ceil(baseLimit * 1.5));
  }

  function prependCompactionContext(
    summary: string,
    metadata: DcpCompactionMetadata,
  ): string {
    const lines = [`Compaction reason: ${metadata.reason}.`];
    if (typeof metadata.willRetry === "boolean") {
      lines.push(
        metadata.willRetry
          ? "Pi will retry the interrupted turn after compaction."
          : "Pi will not retry an interrupted turn after compaction.",
      );
    }
    if (metadata.reason === "overflow") {
      lines.push(
        "Overflow recovery: preserve the latest user intent and split-turn context needed for retry.",
      );
    }
    if (metadata.customInstructions) {
      lines.push(`Manual compact instructions: ${metadata.customInstructions}`);
    }
    return `${lines.join("\n")}\n\n${summary}`;
  }

  function addDcpCompactionDetails(
    result: { details?: unknown },
    sessionId: string,
    metadata: DcpCompactionMetadata,
  ): void {
    const details = asMutableRecord(result.details) ?? {};
    const dcp = asMutableRecord(details.dcp) ?? {};
    dcp.deterministic = false;
    dcp.reason = metadata.reason;
    if (typeof metadata.willRetry === "boolean") {
      dcp.willRetry = metadata.willRetry;
    }
    if (metadata.customInstructions) {
      dcp.customInstructions = metadata.customInstructions;
    }
    dcp.snapshot = makeDcpStateEntryPayload(sessionId, "compaction").snapshot;
    details.dcp = dcp;
    result.details = details;
  }

  function ensureInitialized(ctx: ExtensionContext): void {
    if (!initialized) {
      const entries = ctx.sessionManager.getBranch() as readonly unknown[];
      restoreDcpStateFromSessionEntries(getDcpSessionId(ctx), entries);
    }
    if (initialized) return;

    registerCompressTool(pi, config);
    if (config.recall.enabled) registerRecallTool(pi);
    initialized = true;
  }

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ensureInitialized(ctx);
  });

  // ── Event: input — track turns ──────────────────────────────────────

  pi.on("input", (event: InputEvent, ctx: ExtensionContext) => {
    // Skip mid-stream steers — only count idle prompts and follow-ups
    if (event.streamingBehavior === "steer") return;
    nudge.incTurn();
    // P2: Increment turn for regression detection
    incrementTurn(getDcpSessionId(ctx));
  });

  // ── Event: tool_result — detect compress + track artifacts ──────────
  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    try {
      if (event.toolName === "compress") {
        nudge.recordCompress();
      }
      // P1: Track all relevant tool calls for artifact tracking
      if (config.artifactTracking.enabled && event.toolName && event.input) {
        trackToolCall(
          getDcpSessionId(ctx),
          event.toolName,
          event.input,
          config.artifactTracking.maxFiles,
        );
      }
    } catch {
      // best-effort
    }
  });

  // ── Event: turn_end — context meter, nudges, optional native compact ─
  pi.on("turn_end", async (_event: unknown, ctx: ExtensionContext) => {
    try {
      ensureInitialized(ctx);
      const sessionId = getDcpSessionId(ctx);
      const branchMessages = getSessionBranchMessages(ctx);
      const usage = ctx.getContextUsage();
      const contextWindow = ctx.model?.contextWindow ?? 200_000;
      const outboundTokens = estimateOutboundContextTokens(
        branchMessages,
        sessionId,
        config,
      );
      const meter = buildContextMeterSnapshot(
        usage?.tokens,
        outboundTokens,
        contextWindow,
      );


      const nudgeStateBefore = nudge.getState();
      nudge.checkContext(ctx, meter);
      const nudgeStateAfter = nudge.getState();

      if (config.debug) {
        const threshold = resolveAutoCompactThreshold(
          config.autoCompact,
          contextWindow,
        );
        console.log(
          `[dcp] turn_end: branch=${meter.branchTokens} outbound=${meter.outboundTokens} delta=${meter.deltaTokens ?? 0} pressure=${Math.round(nudgeStateAfter.lastPressurePercent ?? meter.branchPercent ?? 0)}% source=${formatPressureSourceLabel(nudgeStateAfter.lastPressureSource ?? config.autoCompact.pressureSource ?? "max")} threshold=${Math.round(threshold.percent)}% (${threshold.tokens} tokens) stripped=${meter.strippedByDcp}`,
        );
      }

      const crossedThreshold =
        config.autoCompact.invokeNativeCompact &&
        config.autoCompact.enabled &&
        !nudgeStateBefore.autoCompactTriggered &&
        nudgeStateAfter.autoCompactTriggered;

      if (crossedThreshold && !autoCompactInvokePending) {
        autoCompactInvokePending = true;
        try {
          await ctx.compact({ reason: "threshold" });
        } catch {
          // Pi may reject compact (in-flight turn, etc.)
        } finally {
          autoCompactInvokePending = false;
        }
      }
    } catch {
      // best-effort
    }
  });

  // ── Event: before_agent_start — inject pending nudge ────────────────
  pi.on(
    "before_agent_start",
    (_event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
      try {
        ensureInitialized(ctx);
        // P3: Update nudge block context before checking
        const sessionId = getDcpSessionId(ctx);
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
    },
  );

  // ── Event: context — apply DCP strategies ───────────────────────────
  pi.on("context", (event: ContextEvent, ctx: ExtensionContext) => {
    try {
      ensureInitialized(ctx);
      const sessionId = getDcpSessionId(ctx);
      const pruned = processContextMessages(
        event.messages as Message[],
        sessionId,
        config,
      );
      return { messages: pruned };
    } catch {
      // best-effort — return unmodified on error
    }
  });

  // ── Event: session_before_compact — deterministic DCP compaction ─────
  const onPiEvent = pi.on as (
    eventName: string,
    handler: (
      event: SessionBeforeCompactEvent,
      ctx: ExtensionContext,
    ) => unknown,
  ) => void;
  onPiEvent(
    "session_before_compact",
    async (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => {
      try {
        ensureInitialized(ctx);
        const sessionId = getDcpSessionId(ctx);
        const blocks = getBlocks(sessionId);
        const preparation = event.preparation;
        if (!preparation) return;

        const prepLike = preparation as unknown as {
          messagesToSummarize?: readonly Message[];
          turnPrefixMessages?: readonly Message[];
          messages?: readonly Message[];
          previousSummary?: string;
          fileOps?: { readFiles?: string[]; modifiedFiles?: string[] };
        };
        const messagesToSummarize = Array.isArray(prepLike.messagesToSummarize)
          ? prepLike.messagesToSummarize
          : Array.isArray(prepLike.messages)
            ? prepLike.messages
            : [];
        const turnPrefixMessages = Array.isArray(prepLike.turnPrefixMessages)
          ? prepLike.turnPrefixMessages
          : [];
        const messages = [...messagesToSummarize, ...turnPrefixMessages];
        const ps = getPersistentSummary(sessionId);
        const serializedConversation = serializeConversation(
          convertToLlm(messages),
        );
        const compactionMetadata = getCompactionMetadata(event);

        if (
          config.deterministicCompaction.enabled &&
          config.deterministicCompaction.overrideNative
        ) {
          const deterministic = buildDeterministicSummary({
            messages,
            serializedConversation,
            blocks,
            previousSummary: prepLike.previousSummary,
            persistentSummary: ps,
            maxTranscriptLines: getDeterministicTranscriptLimit(
              config.deterministicCompaction.maxTranscriptLines,
              compactionMetadata.reason,
            ),
            maxSectionItems: config.deterministicCompaction.maxSectionItems,
            compactionReason: compactionMetadata.reason,
            willRetry: compactionMetadata.willRetry,
            customInstructions: compactionMetadata.customInstructions,
          });

          const result = enrichCompactionResult(
            {
              summary: `${deterministic.summary}\n\n## DCP Persistent Summary\n\n${buildCompressedSummaryMessage(ps)}`,
              firstKeptEntryId: preparation.firstKeptEntryId,
              tokensBefore: preparation.tokensBefore,
              estimatedTokensAfter: deterministic.estimatedTokensAfter,
              details: {
                dcp: {
                  deterministic: true,
                  reason: compactionMetadata.reason,
                  willRetry: compactionMetadata.willRetry,
                  customInstructions:
                    compactionMetadata.customInstructions || undefined,
                  blockCount: blocks.length,
                  lineCount: deterministic.lineCount,
                  snapshot: makeDcpStateEntryPayload(sessionId, "compaction")
                    .snapshot,
                },
                readFiles: prepLike.fileOps?.readFiles ?? [],
                modifiedFiles: prepLike.fileOps?.modifiedFiles ?? [],
              },
            },
            preparation as unknown as Parameters<
              typeof enrichCompactionResult
            >[1],
          );
          return { compaction: result };
        }

        if (!config.semanticEnrichment.enabled || blocks.length === 0) return;

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
          event.signal,
        );

        if (!result) return;
        result.summary = `${prependCompactionContext(result.summary, compactionMetadata)}\n\n## DCP Persistent Summary\n\n${buildCompressedSummaryMessage(ps)}`;
        addDcpCompactionDetails(result, sessionId, compactionMetadata);
        return {
          compaction: enrichCompactionResult(
            result,
            preparation as unknown as Parameters<
              typeof enrichCompactionResult
            >[1],
          ),
        };
      } catch {
        // Fall through to pi's native compaction
      }
    },
  );

  pi.on("session_compact", (event, ctx: ExtensionContext) => {
    ensureInitialized(ctx);
    const metadata = getCompactionMetadata(event);
    nudge.recordCompress();
    appendDcpStateEntry(ctx, `compaction:${metadata.reason}`);
  });

  const onTreeEvent = pi.on as (
    eventName: string,
    handler: (event: SessionBeforeTreeEvent, ctx: ExtensionContext) => unknown,
  ) => void;
  onTreeEvent(
    "session_before_tree",
    async (event: SessionBeforeTreeEvent, ctx: ExtensionContext) => {
      ensureInitialized(ctx);
      const prep = event.preparation as unknown as {
        userWantsSummary?: boolean;
        entriesToSummarize?: readonly unknown[];
        targetId?: string;
        oldLeafId?: string;
        commonAncestorId?: string;
      };
      if (!prep.userWantsSummary) return;
      const sessionId = getDcpSessionId(ctx);
      const entriesToSummarize = Array.isArray(prep.entriesToSummarize)
        ? prep.entriesToSummarize
        : [];
      const deterministic = buildDeterministicSummary({
        messages: [],
        serializedConversation: serializeSessionEntries(entriesToSummarize),
        previousSummary: `Branch navigation: ${prep.oldLeafId ?? "unknown"} -> ${prep.targetId ?? "unknown"}; common ancestor ${prep.commonAncestorId ?? "unknown"}.`,
        blocks: getBlocks(sessionId),
        persistentSummary: getPersistentSummary(sessionId),
        maxTranscriptLines: config.deterministicCompaction.maxTranscriptLines,
        maxSectionItems: config.deterministicCompaction.maxSectionItems,
      });
      return {
        summary: {
          summary: deterministic.summary,
          details: {
            dcp: {
              deterministic: true,
              branchSummary: true,
              entryCount: entriesToSummarize.length,
              snapshot: makeDcpStateEntryPayload(sessionId, "tree").snapshot,
            },
          },
        },
      };
    },
  );

  pi.on("session_tree", (_event, ctx: ExtensionContext) => {
    ensureInitialized(ctx);
    appendDcpStateEntry(ctx, "tree");
  });

  // ── Event: session_shutdown — clean up state ────────────────────────
  pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
    cleanupSession(getDcpSessionId(ctx));
  });

  // ── Command: /dcp — enhanced status display ─────────────────────────
  pi.registerCommand("dcp", {
    description:
      "DCP status — compression blocks, artifact tracking, quality metrics, and nudges",
    async handler(_args: string, ctx: ExtensionContext) {
      ensureInitialized(ctx);
      const sessionId = getDcpSessionId(ctx);
      const usage = ctx.getContextUsage();
      const contextWindow = ctx.model?.contextWindow ?? 200_000;
      const outboundTokens = estimateOutboundContextTokens(
        getSessionBranchMessages(ctx),
        sessionId,
        config,
      );
      const meter = buildContextMeterSnapshot(
        usage?.tokens,
        outboundTokens,
        contextWindow,
      );
      nudge.refreshContextMeter(ctx, meter);

      const blocks = getBlocks(sessionId);
      const stats = getStats(sessionId);
      const nudgeState = nudge.getState();

      const lines: string[] = [
        "## DCP Status",
        "",
        `Context: ${nudgeState.lastContextTokens !== null ? `${Math.round(nudgeState.lastContextTokens / 1000)}k branch` : "no data"}` +
          (nudgeState.lastContextPercent !== null
            ? ` (${Math.round(nudgeState.lastContextPercent)}%)`
            : "") +
          (nudgeState.lastMeter
            ? nudgeState.lastMeter.outboundTokens > 0
              ? ` | outbound ${Math.round(nudgeState.lastMeter.outboundTokens / 1000)}k` +
                (nudgeState.lastMeter.strippedByDcp
                  ? ` (Δ${Math.round((nudgeState.lastMeter.deltaTokens ?? 0) / 1000)}k)`
                  : "")
              : " | outbound n/a (run after an agent turn for pruned estimate)"
            : "") +
          (nudgeState.lastPressurePercent != null
            ? ` | pressure ${Math.round(nudgeState.lastPressurePercent)}% (${formatPressureSourceLabel(nudgeState.lastPressureSource ?? "max")})`
            : ""),
        "",
        "### Compression Blocks",
        blocks.length === 0
          ? "  None yet. Use `compress` when a phase is complete."
          : blocks
              .map(
                (b) =>
                  `  b${b.blockId}: ${b.topic} (~${b.summaryTokens} tokens)`,
              )
              .join("\n"),
        "",
        `Total summary buffer: ~${stats.summaryTokens} tokens`,
        (() => {
          const run = computeRunPruneStats(
            getSessionBranchMessages(ctx),
            sessionId,
            config,
          );
          return `This run: ~${run.tokens} tokens stripped across ${run.count} prune ops (resets on Pi restart; recomputed from current branch)`;
        })(),
        "",
      ];

      // P1: Quality metrics
      if (config.qualityMetrics.enabled) {
        const qm = stats.qualityMetrics;
        if (qm.totalCompressions > 0) {
          lines.push("### Quality Metrics");
          lines.push(`  Compressions: ${qm.totalCompressions}`);
          lines.push(
            `  Re-read events (deduped read/hashline_read of compressed files): ${qm.reReadsAfterCompress}`,
          );
          if (qm.totalCompressions > 0 && qm.reReadsAfterCompress > 0) {
            lines.push(
              `  Avg re-read events per compression: ${(qm.reReadsAfterCompress / qm.totalCompressions).toFixed(1)}`,
            );
          }
          lines.push(`  Clean streak: ${qm.cleanCompressions}`);
          if (qm.regressionLog.length > 0) {
            lines.push("  Recent regressions:");
            const recent = qm.regressionLog.slice(-3);
            for (const r of recent) {
              lines.push(
                `    b${r.blockId} → ${r.file} (gap: ${r.turnGap} turns)`,
              );
            }
          }
          lines.push("");
        }
      }

      // P1: Probe evaluation results
      if (
        config.probeEvaluation?.enabled &&
        stats.qualityMetrics.lastProbeResults
      ) {
        const pr = stats.qualityMetrics.lastProbeResults;
        lines.push("### Probe Evaluation (last compression)");
        for (const p of pr.probes) {
          const icon = p.pass ? "\uF00C" : "\uF071";
          lines.push(`  ${icon} ${p.name}: ${p.score}/100 — ${p.detail}`);
        }
        const overallIcon = pr.allPassed ? "\uF00C" : "\uF071";
        lines.push(`  ${overallIcon} Overall: ${pr.overallScore}/100`);
        if (stats.qualityMetrics.avgProbeScore > 0) {
          lines.push(
            `  Running average: ${Math.round(stats.qualityMetrics.avgProbeScore)}/100`,
          );
        }
        if (stats.qualityMetrics.failedProbes > 0) {
          lines.push(
            `  Failed compressions: ${stats.qualityMetrics.failedProbes}`,
          );
        }
        lines.push("");
      } else if (
        config.probeEvaluation?.enabled &&
        stats.qualityMetrics.totalCompressions > 0
      ) {
        // Show aggregate if no latest result
        if (stats.qualityMetrics.avgProbeScore > 0) {
          lines.push("### Probe Evaluation");
          lines.push(
            `  Running average: ${Math.round(stats.qualityMetrics.avgProbeScore)}/100`,
          );
          if (stats.qualityMetrics.failedProbes > 0) {
            lines.push(
              `  Failed compressions: ${stats.qualityMetrics.failedProbes}`,
            );
          }
          lines.push("");
        }
      }

      // P1: Artifact tracking
      if (config.artifactTracking.enabled) {
        const artifacts = getArtifactTracker(sessionId);
        const totalTracked =
          artifacts.files_read.length + artifacts.files_modified.length;
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
            lines.push(
              `  Files modified (${artifacts.files_modified.length}):`,
            );
            for (const f of artifacts.files_modified.slice(0, 5)) {
              lines.push(`    • ${f}`);
            }
            if (artifacts.files_modified.length > 5) {
              lines.push(
                `    … and ${artifacts.files_modified.length - 5} more`,
              );
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
          lines.push(
            `  Files tracked: ${ps.files_read.length} read, ${ps.files_modified.length} modified`,
          );
          lines.push(`  Decisions: ${ps.decisions.length}`);
          lines.push(`  Narrative segments: ${ps.narrative_parts.length}`);
          lines.push(
            `  Last updated: ${new Date(ps.last_updated).toLocaleTimeString()}`,
          );
          lines.push("");
        }
      }

      // Nudge state
      lines.push(
        nudgeState.pendingNudge
          ? `\uF071 Pending nudge: "${nudgeState.pendingNudge}"`
          : "No pending nudge",
      );

      const output = lines.filter(Boolean).join("\n");
      if (ctx.hasUI) ctx.ui.notify(output);
    },
  });

  pi.registerCommand("dcp-recall", {
    description:
      "Search durable DCP blocks and raw Pi session JSONL. Usage: /dcp-recall <query> [scope:all] [page:N] [expand:N,N]",
    async handler(args: string, ctx: ExtensionContext) {
      ensureInitialized(ctx);
      const scope = /\bscope:all\b/i.test(args) ? "all" : "active";
      const pageMatch = args.match(/\bpage:(\d+)\b/i);
      const expandMatch = args.match(/\bexpand:([\d,\s]+)\b/i);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      const expand = expandMatch
        ? expandMatch[1]
            .split(/[,\s]+/)
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item))
        : undefined;
      const query = args
        .replace(/\bscope:all\b/gi, "")
        .replace(/\bpage:\d+\b/gi, "")
        .replace(/\bexpand:[\d,\s]+\b/gi, "")
        .trim();
      const result = searchDcpRecall({
        sessionId: getDcpSessionId(ctx),
        sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
        query,
        expand,
        page,
        scope,
      });
      if (ctx.hasUI) ctx.ui.notify(result.rendered);
    },
  });
}
