import { getSessionKey, type DurableSessionState } from "./storage.js";
import type { PersistentSessionSummary, SessionState } from "./compress-types.js";

function parseMetadataArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseMetadataString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function emptyPersistentSummary(): PersistentSessionSummary {
  return {
    files_read: [],
    files_modified: [],
    decisions: [],
    narrative_parts: [],
    next_steps: [],
    last_updated: 0,
    merged_block_ids: [],
    topic: "session",
  };
}

export function newSessionState(): SessionState {
  return {
    blocks: [],
    nextBlockId: 1,
    persistentSummary: emptyPersistentSummary(),
    artifactTracker: new Map(),
    qualityMetrics: {
      reReadsAfterCompress: 0,
      totalCompressions: 0,
      cleanCompressions: 0,
      regressionLog: [],
      avgProbeScore: 0,
      failedProbes: 0,
    },
    recentCompressFiles: null,
    currentTurn: 0,
    reReadSeenKeys: new Set(),
    quarantinedBlocks: [],
  };
}

export function sessionStateFromDurable(durable: DurableSessionState): SessionState {
  const state = newSessionState();
  state.blocks = durable.blocks.map((block, index) => ({
    blockId: Number(block.id.replace(/^b/, "")) || index + 1,
    topic: block.topic,
    summary: block.summary,
    startLabel: block.startMessageId ?? "durable",
    endLabel: block.endMessageId ?? "durable",
    summaryTokens: Math.ceil(block.summary.length / 4),
    createdAt: block.createdAt,
    metadata: {
      files_read: block.filesRead,
      files_modified: block.filesModified,
      decisions: block.decisions,
      next_steps: block.nextSteps,
      start_message_id: block.startMessageId,
      end_message_id: block.endMessageId,
      bead_id: block.beadId,
      source: block.source,
    },
        provenance: block.provenance,
        attestation: block.attestation,
      }));
      state.nextBlockId = Math.max(1, ...state.blocks.map((b) => b.blockId + 1));
  state.artifactTracker = new Map(durable.artifacts.map((a) => [a.path, a]));
  if (
    durable.persistentSummary &&
    typeof durable.persistentSummary === "object"
  ) {
    state.persistentSummary =
      durable.persistentSummary as PersistentSessionSummary;
  }
  state.qualityMetrics.totalCompressions = durable.compressEventCount;
  state.currentTurn = durable.lastCompressTurn;
  if (durable.quarantinedBlocks) {
    state.quarantinedBlocks = durable.quarantinedBlocks;
  }
  return state;
}

export function durableFromSessionState(
  sessionId: string,
  state: SessionState,
): DurableSessionState {
  return {
    version: 2,
    sessionId,
    sessionKey: getSessionKey(sessionId),
    blocks: state.blocks.map((block) => ({
      id: `b${block.blockId}`,
      topic: block.topic,
      summary: block.summary,
      filesRead: parseMetadataArray(block.metadata?.files_read),
      filesModified: parseMetadataArray(block.metadata?.files_modified),
      decisions: parseMetadataArray(block.metadata?.decisions),
      nextSteps: parseMetadataArray(block.metadata?.next_steps),
      createdAt: block.createdAt,
      startMessageId: parseMetadataString(block.metadata?.start_message_id),
      endMessageId: parseMetadataString(block.metadata?.end_message_id),
      beadId: parseMetadataString(block.metadata?.bead_id),
      source: parseMetadataString(block.metadata?.source),
          provenance: block.provenance,
          attestation: block.attestation,
        })),
        artifacts: Array.from(state.artifactTracker.entries()).map(
      ([path, artifact]) => ({ path, ...artifact }),
    ),
    persistentSummary: state.persistentSummary,
    processedMessageIds: [],
    lastDigest: undefined,
    compressEventCount: state.qualityMetrics.totalCompressions,
    lastCompressTurn: state.currentTurn,
    updatedAt: Date.now(),
    quarantinedBlocks:
      state.quarantinedBlocks.length > 0 ? state.quarantinedBlocks : undefined,
  };
}

    