/**
 * DCP Extension — Session Before Compact Handler
 *
 * Extracted from index.ts to keep the main entry point under 400 lines.
 * Handles deterministic compaction, semantic enrichment, and persistent summary
 * injection during native Pi compaction events.
 */

import {
  convertToLlm,
  serializeConversation,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import type { DCPConfig } from "./config.js";
import {
  getBlocks,
  getPersistentSummary,
  makeDcpStateEntryPayload,
  buildCompressedSummaryMessage,
  enrichCompactionResult,
} from "./compress.js";
import {
  buildDeterministicSummary,
} from "./deterministic.js";
import {
  getCompactionMetadata,
  getDeterministicTranscriptLimit,
  prependCompactionContext,
  addDcpCompactionDetails,
  serializeSessionEntries,
} from "./index-helpers.js";

export async function handleSessionBeforeCompact(
  pi: { appendEntry: (type: string, data: unknown) => void },
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
  config: DCPConfig,
  nudge: { recordCompress: () => void },
): Promise<{ compaction?: unknown } | undefined> {
  const sessionId = ctx.sessionManager.getSessionFile() ?? ctx.cwd;
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
  addDcpCompactionDetails(
    result,
    sessionId,
    compactionMetadata,
        makeDcpStateEntryPayload,
  );
  return {
    compaction: enrichCompactionResult(
      result,
      preparation as unknown as Parameters<
        typeof enrichCompactionResult
      >[1],
    ),
  };
}

export async function handleSessionBeforeTree(
  event: unknown,
  ctx: ExtensionContext,
  config: DCPConfig,
): Promise<{ summary?: unknown } | undefined> {
  const prep = (event as Record<string, unknown>).preparation as unknown as {
    userWantsSummary?: boolean;
    entriesToSummarize?: readonly unknown[];
    targetId?: string;
    oldLeafId?: string;
    commonAncestorId?: string;
  };
  if (!prep?.userWantsSummary) return;
  const sessionId = ctx.sessionManager.getSessionFile() ?? ctx.cwd;
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
}
