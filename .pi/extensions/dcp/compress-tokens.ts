import type { Message } from "@earendil-works/pi-ai";
import type { DCPConfig } from "./config.js";
import { applyCompressStrip } from "./compress-strip.js";
import { applyDedup, applyPurgeErrors } from "./compress-dedup.js";
import { pruneToolResults } from "./compress-prune.js";
import { checkCompressionRegression } from "./compress-metrics.js";
import {
  estimateTokens,
  extractToolOps,
} from "./compress-token-utils.js";
    import { computeProtectionPolicy } from "./protection.js";
    import type { ProtectionProvenance } from "./compress-types.js";

export {
  estimateTokens,
  extractToolOps,
  stripToolArgs,
} from "./compress-token-utils.js";

function isCompressibleMessage(msg: Message): boolean {
  return msg.role !== "assistant" && msg.role !== "user";
}

    export function processContextMessages(
      messages: Message[],
      sessionId: string,
      config: DCPConfig,
    ): Message[] {
      checkCompressionRegression(messages, sessionId, config);
      const result = runContextStrategies(messages, sessionId, config);
      return result.messages;
    }

export function runContextStrategies(
  messages: Message[],
  sessionId: string,
  config: DCPConfig,
): {
  messages: Message[];
  prunedTokens: number;
  prunedCount: number;
  provenance: ProtectionProvenance;
} {
  const working = messages.map((msg) => structuredClone(msg));

  // Compute the shared protection policy once per strategy run
  const protection = computeProtectionPolicy(working, config);

  const {
    messages: afterStrip,
    prunedTokens: stripTokens,
    prunedCount: stripCount,
  } = applyCompressStrip(working, sessionId, config, protection);
  const { prunedTokens: dedupTokens, prunedCount: dedupCount } = applyDedup(
    afterStrip,
    config,
    protection,
  );
  const { prunedTokens: purgeTokens, prunedCount: purgeCount } = applyPurgeErrors(
    afterStrip,
    config,
    protection,
  );
  const { prunedTokens: pruneTokens, prunedCount: pruneCount } = pruneToolResults(
    afterStrip,
    config,
    protection,
  );

  return {
    messages: afterStrip,
    prunedTokens: stripTokens + dedupTokens + purgeTokens + pruneTokens,
    prunedCount: stripCount + dedupCount + purgeCount + pruneCount,
    provenance: protection.provenance,
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
