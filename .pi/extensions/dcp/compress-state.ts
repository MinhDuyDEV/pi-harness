import {
  getSessionKey,
  loadDurableSessionState,
  saveDurableSessionState,
  type DurableSessionState,
} from "./storage.js";
import type {
  CompressionBlock,
  DcpStateEntryPayload,
  DcpStateEntryPayloadV2,
  PersistentSessionSummary,
  SessionState,
} from "./compress-types.js";

// Session state management

const sessions = new Map<string, SessionState>();

function emptyPersistentSummary(): PersistentSessionSummary {
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

export function getDcpSessionId(ctx: {
  cwd: string;
  sessionManager: { getSessionFile: () => string | undefined };
}): string {
  return ctx.sessionManager.getSessionFile() ?? ctx.cwd;
}

function newSessionState(): SessionState {
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
  };
}

function sessionStateFromDurable(durable: DurableSessionState): SessionState {
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
  }));
  state.nextBlockId = Math.max(
    1,
    ...state.blocks.map((b) => b.blockId + 1),
  );
  state.artifactTracker = new Map(
    durable.artifacts.map((a) => [a.path, a]),
  );
  if (
    durable.persistentSummary &&
    typeof durable.persistentSummary === "object"
  ) {
    state.persistentSummary =
      durable.persistentSummary as PersistentSessionSummary;
  }
  state.qualityMetrics.totalCompressions = durable.compressEventCount;
  state.currentTurn = durable.lastCompressTurn;
  return state;
}

function durableFromSessionState(
  sessionId: string,
  state: SessionState,
): DurableSessionState {
  return {
    version: 1,
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
  };
}

function persistState(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  saveDurableSessionState(durableFromSessionState(sessionId, state));
}

function parseMetadataArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string")
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function parseMetadataString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function getState(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    const durable = loadDurableSessionState(sessionId);
    s = durable ? sessionStateFromDurable(durable) : newSessionState();
    sessions.set(sessionId, s);
  }
  return s;
}

export function getPersistentSummary(
  sessionId: string,
): PersistentSessionSummary {
  return getState(sessionId).persistentSummary;
}

export function getQualityMetrics(sessionId: string) {
  return getState(sessionId).qualityMetrics;
}

export function getArtifactTracker(sessionId: string) {
  return getState(sessionId).artifactTracker;
}

export function makeDcpStateEntryPayload(
  sessionId: string,
  reason: string,
): DcpStateEntryPayloadV2 {
  return {
    version: 2 as const,
    sessionId,
    reason,
    snapshot: durableFromSessionState(sessionId, getState(sessionId)),
    createdAt: Date.now(),
  };
}

function restoreDcpStateSnapshot(
  sessionId: string,
  snapshot: DurableSessionState,
): void {
  const normalized: DurableSessionState = {
    ...snapshot,
    sessionId,
    sessionKey: getSessionKey(sessionId),
  };
  sessions.set(sessionId, sessionStateFromDurable(normalized));
  saveDurableSessionState(normalized);
}

/**
 * Result of scanning session entries for a restorable DCP state.
 */
interface RestoreCandidate {
  timestamp: number;
  snapshot: DurableSessionState;
  version: number;
}

/**
 * Validate a candidate snapshot object.
 */
function isValidSnapshot(snapshot: unknown): snapshot is DurableSessionState {
  return (
    typeof snapshot === "object" &&
    snapshot !== null &&
    typeof (snapshot as DurableSessionState).version === "number" &&
    Array.isArray((snapshot as DurableSessionState).blocks)
  );
}

/**
 * Find the best restorable DCP state entry for the given session.
 *
 * Branch-safe strategy:
 * 1. Prefer V2+ entries whose `sessionId` matches the current session.
 * 2. Fall back to the latest V1 entry (pre-branch-safe migration path).
 * 3. Accept V2+ entries with a non-matching sessionId only if no match exists.
 */
export function restoreDcpStateFromSessionEntries(
  sessionId: string,
  entries: readonly unknown[],
): boolean {
  let exactMatch: RestoreCandidate | undefined;
  let anyMatch: RestoreCandidate | undefined;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const details =
      obj.details && typeof obj.details === "object"
        ? (obj.details as Record<string, unknown>)
        : undefined;
    const dcpDetails =
      details?.dcp && typeof details.dcp === "object"
        ? (details.dcp as Record<string, unknown>)
        : undefined;
    const data =
      obj.data && typeof obj.data === "object"
        ? (obj.data as Record<string, unknown>)
        : undefined;
    const payload = obj.customType === "dcp_state" ? data : undefined;
    const snapshot = (payload?.snapshot ?? dcpDetails?.snapshot) as
      | unknown
      | undefined;
    if (!snapshot || !isValidSnapshot(snapshot)) continue;

    const timestamp = typeof obj.timestamp === "number" ? obj.timestamp : 0;
    const payloadVersion =
      typeof payload?.version === "number" ? payload.version : 1;

    // Branch-safe: prefer entries with matching sessionId
    if (payloadVersion >= 2 && typeof payload?.sessionId === "string") {
      if (payload.sessionId === sessionId) {
        if (!exactMatch || timestamp >= exactMatch.timestamp)
          exactMatch = { timestamp, snapshot, version: payloadVersion };
      } else {
        if (!anyMatch || timestamp >= anyMatch.timestamp)
          anyMatch = { timestamp, snapshot, version: payloadVersion };
      }
    } else {
      // V1 entries: no sessionId, use as fallback
      if (!anyMatch || timestamp >= anyMatch.timestamp)
        anyMatch = { timestamp, snapshot, version: 1 };
    }
  }

  // Prefer exact match, then any match
  const best = exactMatch ?? anyMatch;
  if (!best) return false;

  restoreDcpStateSnapshot(sessionId, best.snapshot);
  return true;
}

export function cleanupSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function incrementTurn(sessionId: string): void {
  getState(sessionId).currentTurn++;
}

export function addBlock(
  sessionId: string,
  topic: string,
  summary: string,
  startLabel: string,
  endLabel: string,
  metadata?: Record<string, unknown>,
): CompressionBlock {
  const state = getState(sessionId);
  const block: CompressionBlock = {
    blockId: state.nextBlockId++,
    topic,
    summary,
    startLabel,
    endLabel,
    summaryTokens: Math.ceil(summary.length / 4),
    createdAt: Date.now(),
    metadata,
  };
  state.blocks.push(block);
  persistState(sessionId);
  return block;
}

export function getBlocks(sessionId: string): readonly CompressionBlock[] {
  return getState(sessionId).blocks;
}

export function getStats(sessionId: string) {
  const s = getState(sessionId);
  return {
    blockCount: s.blocks.length,
    summaryTokens: s.blocks.reduce((sum, b) => sum + b.summaryTokens, 0),
    qualityMetrics: s.qualityMetrics,
  };
}
