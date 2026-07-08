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
  getQualityStatus,
  processContextMessages,
  registerCompressTool,
  trackToolCall,
  incrementTurn,
  makeDcpStateEntryPayload,
  restoreDcpStateFromSessionEntries,
} from "./compress.js";
import { getSessionBranchMessages } from "./branch-messages.js";
import { NudgeManager } from "./nudge.js";
import {
  buildContextMeterSnapshot,
  estimateOutboundContextTokens,
} from "./context-meter.js";
import {
  resolveAutoCompactThreshold,
} from "./pressure.js";
import { registerRecallTool } from "./recall.js";
import {
  getCompactionMetadata,
} from "./index-helpers.js";
import {
  handleSessionBeforeCompact,
  handleSessionBeforeTree,
} from "./index-compact-handler.js";
import {
  registerDcpCommand,
  registerDcpRecallCommand,
} from "./index-commands.js";

export default function dcpExtension(pi: ExtensionAPI): void {
  const config: DCPConfig = { ...DEFAULT_CONFIG };
  if (!config.enabled) return;

  const nudge = new NudgeManager(config);
  let autoCompactInvokePending = false;
  let initialized = false;

  function appendDcpStateEntry(ctx: ExtensionContext, reason: string): void {
    pi.appendEntry(
      "dcp_state",
      makeDcpStateEntryPayload(getDcpSessionId(ctx), reason),
    );
  }

  function ensureInitialized(ctx: ExtensionContext): void {
    if (!initialized) {
      const entries = ctx.sessionManager.getBranch() as readonly unknown[];
      restoreDcpStateFromSessionEntries(getDcpSessionId(ctx), entries);
    }
    if (initialized) return;

    registerCompressTool(pi, config);
    if (config.recall.enabled) registerRecallTool(pi);

    // Register commands
    registerDcpCommand(pi, ctx, config, nudge, {
      estimateOutboundContextTokens,
      buildContextMeterSnapshot,
    }, ensureInitialized);
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
          config.artifactTracking.maxFiles,
        );
      }
    } catch {
      // best-effort
    }
  });

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
        resolveAutoCompactThreshold(config.autoCompact, contextWindow);
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
        return await handleSessionBeforeCompact(pi, event, ctx, config, nudge);
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
      return await handleSessionBeforeTree(event, ctx, config);
    },
  );

  pi.on("session_tree", (_event, ctx: ExtensionContext) => {
    ensureInitialized(ctx);
    appendDcpStateEntry(ctx, "tree");
  });

  pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
    cleanupSession(getDcpSessionId(ctx));
  });
}
