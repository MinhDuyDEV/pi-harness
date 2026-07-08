import type {
  AssistantMessage,
  Message,
  ToolCall,
} from "@earendil-works/pi-ai";
import {
  isCompactableTool,
  type ToolOp,
} from "./compress-types.js";
import type { DCPConfig } from "./config.js";
import { applyCompressStrip } from "./compress-strip.js";
import { applyDedup, applyPurgeErrors } from "./compress-dedup.js";
import { pruneToolResults } from "./compress-prune.js";
import { checkCompressionRegression } from "./compress-metrics.js";

// Token estimation and message filtering

export function estimateTokens(msg: Message): number {
  return Math.ceil(JSON.stringify(msg).length / 3.5);
}

function isCompressibleMessage(
  msg: Message,
  config: DCPConfig,
): boolean {
  if (config.structuredSummary.onlyCompressible) {
    if (msg.role === "assistant") return false;
    if (msg.role === "user") return false;
    if (msg.role === "bashExecution") return true;
    if (msg.role === "toolResult" && Array.isArray(msg.content)) {
      return msg.content.some(
        (c: unknown) =>
          typeof c === "object" &&
          c !== null &&
          "toolName" in c &&
          isCompactableTool((c as { toolName: string }).toolName),
      );
    }
    return false;
  }
  return msg.role !== "assistant" && msg.role !== "user";
}

export function partitionCompressibleMessages(
  messages: Message[],
  config: DCPConfig,
): {
  compressibleMessages: Message[];
  preserveMessages: Message[];
} {
  return {
    compressibleMessages: messages.filter((msg) =>
      isCompressibleMessage(msg, config),
    ),
    preserveMessages: messages.filter(
      (msg) => !isCompressibleMessage(msg, config),
    ),
  };
}

export function estimateOutboundContextTokens(
  messages: readonly Message[],
  config: DCPConfig,
  maxTokens: number,
): number {
  const compressible = messages.filter((msg) =>
    isCompressibleMessage(msg, config),
  );
  const preserve = messages.filter(
    (msg) => !isCompressibleMessage(msg, config),
  );

  let compressedTokenEstimate = 0;
  for (const _cMsg of compressible) {
    compressedTokenEstimate += config.compressedMessageTokenBudget;
  }
  const preserveTokens = preserve.reduce(
    (sum, msg) => sum + estimateTokens(msg),
    0,
  );
  return compressedTokenEstimate + preserveTokens;
}

export function estimateTokensAfterCompress(
  messages: readonly Message[],
  config: DCPConfig,
): number {
  const compressible = messages.filter((msg) =>
    isCompressibleMessage(msg, config),
  );
  const preserve = messages.filter(
    (msg) => !isCompressibleMessage(msg, config),
  );

  const compressedEstimate = config.compressedMessageTokenBudget;
  return (
    preserve.reduce((sum, msg) => sum + estimateTokens(msg), 0) +
    compressible.length * compressedEstimate
  );
}

export function enrichCompactionResult<T>(
  messages: readonly T[],
  config: DCPConfig,
): {
  originalTokens: number;
  remainingTokens: number;
  savedTokens: number;
  compressible: number;
  preserved: number;
} {
  const total = messages.reduce(
    (sum, msg) => sum + estimateTokens(msg as unknown as Message),
    0,
  );
  const msgs = messages as unknown as Message[];
  const compressible = msgs.filter((msg) =>
    isCompressibleMessage(msg, config),
  );
  const preserved = msgs.filter(
    (msg) => !isCompressibleMessage(msg, config),
  );

  const compressedEstimate = config.compressedMessageTokenBudget;
  const remaining =
    preserved.reduce((sum, msg) => sum + estimateTokens(msg), 0) +
    compressible.length * compressedEstimate;

  return {
    originalTokens: total,
    remainingTokens: remaining,
    savedTokens: total - remaining,
    compressible: compressible.length,
    preserved: preserved.length,
  };
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
    }
    if (msg.role === "toolResult" && Array.isArray(msg.content)) {
      for (let ci = 0; ci < msg.content.length; ci++) {
        const c = msg.content[ci];
        if (c && typeof c === "object") {
          const block = c as {
            toolName?: string;
            toolCallId?: string;
            isError?: boolean;
          };
          ops.push({
            messageIndex: mi,
            contentIndex: ci,
            type: "result",
            toolName: block.toolName ?? "unknown",
            toolCallId: block.toolCallId ?? "",
            isError: block.isError ?? false,
          });
        }
      }
    }
  }
  return ops;
}

export function stripToolArgs(
  tc: ToolCall,
  marker: string,
): ToolCall {
  return {
    ...tc,
    args: marker,
  } as ToolCall;
}

// Context processing

export async function processContextMessages(
  messages: Message[],
  sessionId: string,
  config: DCPConfig,
): Promise<Message[]> {
  checkCompressionRegression(messages, sessionId, config);
  const result = await runContextStrategies(messages, sessionId, config);
  return result.messages ?? messages;
}

// Prune strategies

export async function runContextStrategies(
  messages: Message[],
  sessionId: string,
  config: DCPConfig,
): Promise<{
  messages: Message[];
  totalPruned: number;
}> {
  let totalPruned = 0;
  let working = messages;

  if (config.compressStrip?.enabled !== false) {
    const result = applyCompressStrip(working, sessionId, config);
    working = result.messages;
    totalPruned += result.prunedCount;
  }

  if (config.toolResultPruning?.enabled !== false) {
    const { prunedTokens: pruneTokens, prunedCount: pruneCount } =
      pruneToolResults(working, sessionId, config);
    working = pruneTokens;
    totalPruned += pruneCount;
  }

  if (config.dedupConfig?.enabled !== false) {
    const { prunedTokens: dedupTokens, prunedCount: dedupCount } = applyDedup(
      working,
      sessionId,
      config,
    );
    working = dedupTokens;
    totalPruned += dedupCount;
  }

  if (config.purgeErrorsConfig?.enabled !== false) {
    const { prunedTokens: purgeTokens, prunedCount: purgeCount } =
      applyPurgeErrors(working, sessionId, config);
    working = purgeTokens;
    totalPruned += purgeCount;
  }

  return { messages: working, totalPruned };
}

export async function computeRunPruneStats(
  messages: Message[],
  sessionId: string,
  config: DCPConfig,
): Promise<{
  totalTokens: number;
  estimatedAfter: number;
  pruned: number;
  strategies: string[];
}> {
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m),
    0,
  );
  const result = await runContextStrategies(messages, sessionId, config);
  const estimatedAfter = result.messages.reduce(
    (sum, m) => sum + estimateTokens(m),
    0,
  );
  return {
    totalTokens,
    estimatedAfter,
    pruned: result.totalPruned,
    strategies: Object.entries(config)
      .filter(([, v]) => v && typeof v === "object" && "enabled" in v)
      .map(([k]) => k),
  };
}
