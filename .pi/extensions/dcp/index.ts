/**
 * DCP Extension — Entry Point
 *
 * Thin wiring layer that connects the compress tool, nudge system,
 * artifact tracking, quality metrics, and context event handler
 * into Pi's extension API.
 */

import {
  type BeforeAgentStartEvent,
  type ContextEvent,
  type ExtensionAPI,
  type ExtensionContext,
  type InputEvent,
  type SessionCompactEvent,
  type SessionBeforeCompactEvent,
  type SessionBeforeTreeEvent,
  type SessionTreeEvent,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

import type { Message } from "@earendil-works/pi-ai";
import { DEFAULT_CONFIG, type DCPConfig } from "./config.js";
import {
  parseDcpUsageReference,
  type DcpUsageReference,
} from "./knowledge-port.js";
import {
  cleanupSession,
  getBlocks,
  getDcpSessionId,
  getProvenanceCounts,
  getQualityStatus,
  processContextMessages,
  registerCompressTool,
  trackToolCall,
  incrementTurn,
  makeDcpStateEntryPayload,
  restoreDcpStateFromSessionEntries,
  validateBlocksProvenance,
} from "./compress.js";
import { getSessionBranchMessages } from "./branch-messages.js";
import { getArtifactTracker } from "./compress-metrics.js";
import { NudgeManager } from "./nudge.js";
import {
  buildContextMeterSnapshot,
  estimateOutboundContextTokens,
} from "./context-meter.js";
import { registerRecallTool } from "./recall.js";
import {
  getCompactionMetadata,
  extractCompactionOutcome,
} from "./index-helpers.js";
import {
  handleSessionBeforeCompact,
  handleSessionBeforeTree,
} from "./index-compact-handler.js";
import {
  registerDcpCommand,
  registerDcpRecallCommand,
} from "./index-commands.js";
import {
  buildCompactionCompletedEvent,
  buildNudgeEvaluatedEvent,
  buildLifecycleForkEvent,
  buildNullTokensEvent,
  type DCPTelemetryEvent,
} from "./telemetry.js";

export default function dcpExtension(pi: ExtensionAPI): void {
  const config: DCPConfig = { ...DEFAULT_CONFIG };
  if (!config.enabled) return;

  const nudge = new NudgeManager(config);
  const usageReceipts = new Map<string, DcpUsageReference>();
  let initialized = false;

  if (pi.events) {
    pi.events.on("pi-learning:v1:usage-receipts-issued", (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const receipts = (payload as { receipts?: unknown }).receipts;
      if (!Array.isArray(receipts)) return;
      for (const value of receipts) {
        const receipt = parseDcpUsageReference(value);
        if (receipt) usageReceipts.set(receipt.usageId, receipt);
      }
    });
  }

  const resolveUsageIds = (ids: readonly string[]): DcpUsageReference[] =>
    ids.map((id) => {
      const receipt = usageReceipts.get(id);
      if (!receipt) throw new Error(`Unknown or expired usage receipt: ${id}`);
      return receipt;
    });

  /** Emit JSON-safe telemetry for extension and RPC consumers. */
  function emitTelemetry(evt: DCPTelemetryEvent): void {
    pi.events.emit("dcp:telemetry", evt);
  }

  function appendDcpStateEntry(ctx: ExtensionContext, reason: string): void {
    pi.appendEntry(
      "dcp_state",
      makeDcpStateEntryPayload(getDcpSessionId(ctx), reason),
    );
  }

  function ensureInitialized(ctx: ExtensionContext): void {
    if (!initialized) {
      const entries = ctx.sessionManager.getBranch();
      restoreDcpStateFromSessionEntries(getDcpSessionId(ctx), entries);
      // Validate provenance for all restored blocks against current branch
      const quarantinedCount = validateBlocksProvenance(
        getDcpSessionId(ctx),
        ctx.sessionManager,
      );
      if (quarantinedCount > 0) {
        const counts = getProvenanceCounts(getDcpSessionId(ctx));
        console.warn(
          `[dcp] Quarantined ${quarantinedCount} block(s) due to provenance mismatch. Active: ${counts.validated} validated, ${counts.legacyUnverified} legacy_unverified. Quarantined total: ${counts.quarantined}`,
        );
      }
    }
    if (initialized) return;

    registerCompressTool(pi, config, undefined, resolveUsageIds);
    if (config.recall.enabled) registerRecallTool(pi);

    // Register commands
    registerDcpCommand(
      pi,
      ctx,
      config,
      nudge,
      {
        estimateOutboundContextTokens,
        buildContextMeterSnapshot,
      },
      ensureInitialized,
    );
    registerDcpRecallCommand(pi, ctx, config, ensureInitialized);

    initialized = true;
  }

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ensureInitialized(ctx);
  });

  pi.on("input", (event: InputEvent, ctx: ExtensionContext) => {
    if (event.streamingBehavior === "steer") return;
    nudge.incTurn();
    incrementTurn(getDcpSessionId(ctx));
  });

  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    try {
      if (event.toolName === "compress") {
        nudge.recordCompress();
      }
      if (config.artifactTracking.enabled && event.toolName && event.input) {
        trackToolCall(
          getDcpSessionId(ctx),
          event.toolName,
          event.input,
          config,
        );
      }
    } catch {
      // best-effort
    }
  });

  /**
   * turn_end handler.
   *
   * When Pi reports `usage?.tokens === null` after compaction,
   * percentage-based diagnostics are suppressed: the meter returns null for
   * `branchPercent` and `deltaTokens`, and the nudge is skipped entirely.
   */
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

      // Explicit null-tokens guard: suppress all percentage diagnostics
      if (!usage?.tokens) {
        emitTelemetry(buildNullTokensEvent(outboundTokens));
        return;
      }

      const meter = buildContextMeterSnapshot(
        usage.tokens,
        outboundTokens,
        contextWindow,
      );
      const nudgeEmitted = nudge.checkContext(ctx, meter) !== null;

      emitTelemetry(
        buildNudgeEvaluatedEvent(
          meter.branchTokens,
          meter.branchPercent,
          nudgeEmitted,
        ),
      );
    } catch {
      // best-effort
    }
  });

  pi.on(
    "before_agent_start",
    (_event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
      try {
        ensureInitialized(ctx);
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

  pi.on("context", async (event: ContextEvent, ctx: ExtensionContext) => {
    try {
      ensureInitialized(ctx);
      const sessionId = getDcpSessionId(ctx);
      const pruned = await processContextMessages(
        event.messages as Message[],
        sessionId,
        config,
      );
      return { messages: pruned };
    } catch {
      // best-effort
    }
  });

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
        return await handleSessionBeforeCompact(pi, event, ctx, config);
      } catch {
        // Fall through to pi's native compaction
      }
    },
  );

  /**
   * session_compact handler.
   *
   * Records the authoritative completed-compaction outcome from the event,
   * not speculative estimates from `session_before_compact`. The event
   * carries the actual `compactionEntry`, `reason`, and `willRetry`.
   */
  pi.on("session_compact", (event: SessionCompactEvent, ctx: ExtensionContext) => {
    ensureInitialized(ctx);
    const sessionId = getDcpSessionId(ctx);
    const metadata = getCompactionMetadata(event);
    const blocks = getBlocks(sessionId);
    const artifacts = getArtifactTracker(sessionId);
    const artifactCount =
      artifacts.files_read.length + artifacts.files_modified.length;
    const outcome = extractCompactionOutcome(
      metadata,
      blocks.length,
      artifactCount,
      false,
    );

    nudge.recordCompress();
    appendDcpStateEntry(ctx, `compaction:${outcome.reason}`);
    emitTelemetry(buildCompactionCompletedEvent(outcome));
  });

  const onTreeEvent = pi.on as (
    eventName: string,
    handler: (event: SessionBeforeTreeEvent, ctx: ExtensionContext) => unknown,
  ) => void;
  onTreeEvent(
    "session_before_tree",
    async (event: SessionBeforeTreeEvent, ctx: ExtensionContext) => {
      ensureInitialized(ctx);
      return await handleSessionBeforeTree(event, ctx, config);
    },
  );

  /**
   * Rebuild DCP state after navigation within the current session tree.
   * Leaf IDs identify entries, while the session ID remains unchanged.
   */
  pi.on("session_tree", (_event: SessionTreeEvent, ctx: ExtensionContext) => {
    // Leaf IDs are entries within the current session, not session IDs.
    cleanupSession(getDcpSessionId(ctx));
    initialized = false;
    emitTelemetry(buildLifecycleForkEvent(true, true));
  });

  pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
    cleanupSession(getDcpSessionId(ctx));
  });


}
