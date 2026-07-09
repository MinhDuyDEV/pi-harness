import type {
  AssistantMessage,
  Message,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { ToolOp } from "./compress-types.js";
import type { DCPConfig } from "./config.js";
import { applyCompressStrip } from "./compress-strip.js";
import { applyDedup, applyPurgeErrors } from "./compress-dedup.js";
import { pruneToolResults } from "./compress-prune.js";
import { checkCompressionRegression } from "./compress-metrics.js";

export function estimateTokens(msg: Message): number {
  return Math.ceil(JSON.stringify(msg).length / 3.5);
}

function isCompressibleMessage(msg: Message): boolean {
  return msg.role !== "assistant" && msg.role !== "user";
}

export function partitionCompressibleMessages(
  messages: Message[],
): {
  compressibleMessages: Message[];
  preserveMessages: Message[];
} {
  return {
    compressibleMessages: messages.filter((msg) => isCompressibleMessage(msg)),
    preserveMessages: messages.filter((msg) => !isCompressibleMessage(msg)),
  };
}

function estimateToolArgsTokens(args: unknown): number {
  return Math.ceil(JSON.stringify(args).length / 4);
}

export function stripToolArgs(tc: ToolCall, marker: string): number {
  const before = estimateToolArgsTokens(tc.arguments);
  tc.arguments = { __dcp: marker };
  return before;
}

export function extractToolOps(messages: Message[]): ToolOp[] {
  const ops: ToolOp[] = [];
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg.role === "assistant") {
      const asst = msg as AssistantMessage;
      if (!Array.isArray(asst.content)) continue;
      for (let ci = 0; ci < asst.content.length; ci++) {
        const part = asst.content[ci];
        if (part.type === "toolCall") {
          const tc = part as ToolCall;
          ops.push({
            messageIndex: mi,
            contentIndex: ci,
            type: "call",
            toolName: tc.name,
            toolCallId: tc.id,
            isError: false,
          });
        }
      }
      continue;
    }
    if (msg.role === "toolResult") {
      const tr = msg as ToolResultMessage;
      ops.push({
        messageIndex: mi,
        contentIndex: -1,
        type: "result",
        toolName: tr.toolName,
        toolCallId: tr.toolCallId,
        isError: tr.isError ?? false,
      });
    }
  }
  return ops;
}

export function processContextMessages(
  messages: Message[],
  sessionId: string,
  config: DCPConfig,
): Message[] {
  checkCompressionRegression(messages, sessionId, config);
  return runContextStrategies(messages, sessionId, config).messages;
}

export function runContextStrategies(
  messages: Message[],
  sessionId: string,
  config: DCPConfig,
): {
  messages: Message[];
  prunedTokens: number;
  prunedCount: number;
} {
  const working = messages.map((msg) => structuredClone(msg));

  const {
    messages: afterStrip,
    prunedTokens: stripTokens,
    prunedCount: stripCount,
  } = applyCompressStrip(working, sessionId, config);
  const { prunedTokens: dedupTokens, prunedCount: dedupCount } = applyDedup(
    afterStrip,
    config,
  );
  const { prunedTokens: purgeTokens, prunedCount: purgeCount } = applyPurgeErrors(
    afterStrip,
    config,
  );
  const { prunedTokens: pruneTokens, prunedCount: pruneCount } = pruneToolResults(
    afterStrip,
    config,
  );

  return {
    messages: afterStrip,
    prunedTokens: stripTokens + dedupTokens + purgeTokens + pruneTokens,
    prunedCount: stripCount + dedupCount + purgeCount + pruneCount,
  };
}

export function computeRunPruneStats(
  messages: Message[],
  sessionId: string,
  config: DCPConfig,
): { tokens: number; count: number } {
  const { prunedTokens, prunedCount } = runContextStrategies(
    messages,
    sessionId,
    config,
  );
  return { tokens: prunedTokens, count: prunedCount };
}

export function estimateOutboundContextTokens(
  messages: readonly Message[],
  sessionId: string,
  config: DCPConfig,
): number {
  const pruned = processContextMessages([...messages], sessionId, config);
  return pruned.reduce((sum, msg) => sum + estimateTokens(msg), 0);
}

export function estimateTokensAfterCompress(
  contextTokensBefore: number | null | undefined,
  removedEstimate: number,
  summaryTokens: number,
): number | undefined {
  if (contextTokensBefore == null || contextTokensBefore <= 0) return undefined;
  return Math.max(
    0,
    Math.round(contextTokensBefore - removedEstimate + summaryTokens),
  );
}

export function enrichCompactionResult<
  T extends {
    summary: string;
    tokensBefore: number;
    estimatedTokensAfter?: number;
  },
>(
  result: T,
  preparation: {
    tokensBefore: number;
    messagesToSummarize: readonly Message[];
  },
): T {
  const removedEstimate = preparation.messagesToSummarize.reduce(
    (sum, msg) => sum + estimateTokens(msg),
    0,
  );
  const summaryTokens = Math.ceil(result.summary.length / 4);
  const estimated = estimateTokensAfterCompress(
    preparation.tokensBefore,
    removedEstimate,
    summaryTokens,
  );
  if (estimated != null) {
    result.estimatedTokensAfter = estimated;
  }
  return result;
}
