    import { createHash } from "node:crypto";
    import {
      getSessionKey,
      loadDurableSessionState,
      saveDurableSessionState,
      type DurableSessionState,
    } from "./storage.js";
import type {
      CompressionBlock,
      DcpProvenanceV2,
      DcpStateEntryPayload,
      DcpStateEntryPayloadV2,
      DcpStateEntryPayloadV3,
      LegacyAttestationMetadata,
      PersistentSessionSummary,
      QuarantinedBlock,
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
    quarantinedBlocks: [],
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

function durableFromSessionState(
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

    export function persistState(sessionId: string): void {
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
): DcpStateEntryPayloadV3 {
  return {
    version: 3 as const,
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
 * Restore the newest snapshot belonging to this session. Legacy V1 entries
 * have no session identity and are considered only as a migration fallback.
 */
export function restoreDcpStateFromSessionEntries(
  sessionId: string,
  entries: readonly unknown[],
): boolean {
  let exactMatch: RestoreCandidate | undefined;
  let legacyMatch: RestoreCandidate | undefined;

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
    const snapshot = payload?.snapshot ?? dcpDetails?.snapshot;
    if (!snapshot || !isValidSnapshot(snapshot)) continue;

    const timestamp =
      typeof obj.timestamp === "number"
        ? obj.timestamp
        : typeof obj.timestamp === "string"
          ? Date.parse(obj.timestamp) || 0
          : 0;
    const payloadVersion =
      typeof payload?.version === "number" ? payload.version : 1;

    if (payloadVersion >= 2) {
      if (payload?.sessionId !== sessionId) continue;
      if (!exactMatch || timestamp >= exactMatch.timestamp) {
        exactMatch = { timestamp, snapshot, version: payloadVersion };
      }
      continue;
    }

    if (!legacyMatch || timestamp >= legacyMatch.timestamp) {
      legacyMatch = { timestamp, snapshot, version: 1 };
    }
  }

  const best = exactMatch ?? legacyMatch;
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
  provenance?: DcpProvenanceV2,
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
    provenance,
  };
  state.blocks.push(block);
  rebuildPersistentSummary(state);
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

/**
 * Minimum interface for session operations needed by provenance capture and validation.
 */
export interface ProvenanceSessionHandle {
  getSessionId(): string;
  getLeafId(): string | null;
  getBranch(fromId?: string): readonly { id: string }[];
}

/**
 * Capture provenance metadata at block creation time.
 */
export function captureProvenance(
  session: ProvenanceSessionHandle,
  blockCreatedAt: number,
  protectionProvenance?: {
    protectedTools: number;
    protectedFiles: number;
    protectedRecentTurns: number;
    protectedUserMessages: number;
  },
  summarySource?: string,
): DcpProvenanceV2 {
  const branch = session.getBranch();
  return {
    version: 2,
    sessionId: session.getSessionId(),
    leafId: session.getLeafId(),
    coveredEntryIds: branch.map((e) => e.id),
    createdAt: blockCreatedAt,
    protectionProvenance,
    summarySource,
  };
}

/**
 * Validate a block's provenance against the current session branch.
 * Returns { valid: true } if the block passes, or { valid: false, reason } if quarantined.
 */
export function validateBlockProvenance(
  provenance: DcpProvenanceV2,
  session: {
    getSessionId(): string;
    getBranch(fromId?: string): readonly { id: string }[];
  },
): { valid: true } | { valid: false; reason: string } {
  // 1. Session must match
  const currentSessionId = session.getSessionId();
  if (provenance.sessionId !== currentSessionId) {
    return {
      valid: false,
      reason: `Session mismatch: block session "${provenance.sessionId}" !== current "${currentSessionId}"`,
    };
  }

  // 2. Get the current active branch entry IDs (root → leaf)
  const branch = session.getBranch();
  const reachableIds = new Set(branch.map((e) => e.id));

  // 3. Every covered entry ID must be reachable in the current branch
  for (const id of provenance.coveredEntryIds) {
    if (!reachableIds.has(id)) {
      return {
        valid: false,
        reason: `Covered entry ${id} is not reachable in current branch (has ${reachableIds.size} entries)`,
      };
    }
  }

  // 4. The creation leaf must be reachable (null leaf on empty session is always valid)
  if (provenance.leafId !== null && !reachableIds.has(provenance.leafId)) {
    return {
      valid: false,
      reason: `Creation leaf ${provenance.leafId} is not reachable in current branch`,
    };
  }

  return { valid: true };
}

/**
 * Rebuild the persistent summary from active blocks only.
 * This ensures quarantined block content does not leak into the persistent
 * aggregate used for context injection.
 */
function rebuildPersistentSummary(state: SessionState): void {
  // Reset to empty
  state.persistentSummary = emptyPersistentSummary();
  const seenDecisions = new Set<string>();

  // Walk blocks in order (oldest first) to match the additive semantics
  for (const block of state.blocks) {
    const filesRead = (block.metadata?.files_read as string[]) ?? [];
    const filesModified = (block.metadata?.files_modified as string[]) ?? [];
    const decisions = (block.metadata?.decisions as string[]) ?? [];
    const nextSteps = (block.metadata?.next_steps as string[]) ?? [];

    // Prepend new unique reads/modifies
    const newReads = filesRead.filter(
      (f: string) => !state.persistentSummary.files_read.includes(f),
    );
    const newModifies = filesModified.filter(
      (f: string) => !state.persistentSummary.files_modified.includes(f),
    );
    if (newReads.length > 0)
      state.persistentSummary.files_read = [
        ...newReads,
        ...state.persistentSummary.files_read,
      ] as string[];
    if (newModifies.length > 0)
      state.persistentSummary.files_modified = [
        ...newModifies,
        ...state.persistentSummary.files_modified,
      ] as string[];

    for (const d of decisions) {
      if (!seenDecisions.has(d)) {
        seenDecisions.add(d);
        state.persistentSummary.decisions.push({
          text: d,
          block_id: block.blockId,
          timestamp: block.createdAt,
        });
      }
    }

    for (const ns of nextSteps) {
      state.persistentSummary.next_steps.push({
        text: ns,
        block_id: block.blockId,
        timestamp: block.createdAt,
      });
    }
    if (state.persistentSummary.next_steps.length > 20) {
      state.persistentSummary.next_steps =
        state.persistentSummary.next_steps.slice(-20);
    }
  }

  // Use the latest block's topic
  if (state.blocks.length > 0) {
    const last = state.blocks[state.blocks.length - 1];
    state.persistentSummary.topic = last.topic;
    state.persistentSummary.merged_block_ids = state.blocks.map(
      (b) => b.blockId,
    );
  }

  state.persistentSummary.last_updated = Date.now();
}

/**
 * Validate all blocks in a session state that have provenance metadata.
 * Blocks that fail validation are moved to the quarantine collection.
 * The persistent summary is rebuilt from active blocks to prevent leakage.
 * Returns the count of blocks that were quarantined.
 */
export function validateBlocksProvenance(
  sessionId: string,
  session: {
    getSessionId(): string;
    getBranch(fromId?: string): readonly { id: string }[];
  },
): number {
  const state = getState(sessionId);
  const remaining: CompressionBlock[] = [];
  let quarantineCount = 0;

      for (const block of state.blocks) {
        // Verify attestation summary hash before ancestry check
        if (block.attestation) {
          const currentHash = createHash("sha256").update(block.summary).digest("hex");
          if (block.attestation.summaryHash !== currentHash) {
                state.quarantinedBlocks.push({
                  id: `b${block.blockId}`,
                  summary: block.summary,
                  reason: "attestation-hash-mismatch",
                  quarantinedAt: Date.now(),
                  createdAt: block.createdAt,
                  actor: "system",
                  confirmation: "auto",
                  summaryHash: block.attestation.summaryHash,
                });
            quarantineCount++;
            continue;
          }
        }
        if (block.provenance) {
          const result = validateBlockProvenance(block.provenance, session);
          if ("reason" in result) {
                state.quarantinedBlocks.push({
                  id: `b${block.blockId}`,
                  summary: block.summary,
                  reason: result.reason,
                  quarantinedAt: Date.now(),
                  createdAt: block.createdAt,
                  actor: block.attestation ? "system" : undefined,
                  confirmation: block.attestation ? "auto" : undefined,
                  summaryHash: block.attestation?.summaryHash,
                });
            quarantineCount++;
            continue; // Don't keep in active blocks
          }
        }
        // Blocks without provenance (legacy) or passing validation stay active
        remaining.push(block);
  }

  if (quarantineCount > 0) {
    state.blocks = remaining;
    // Rebuild persistent summary from active blocks only to prevent leakage
    rebuildPersistentSummary(state);
    persistState(sessionId);
  }

  return quarantineCount;
}

/**
 * Get quarantined blocks for a session.
 */
export function getQuarantinedBlocks(
  sessionId: string,
): readonly QuarantinedBlock[] {
  return getState(sessionId).quarantinedBlocks;
}

/**
 * Check if a block in the state is legacy (no provenance data).
 */
export function isLegacyBlock(block: CompressionBlock): boolean {
  return !block.provenance;
}

/**
 * Count provenance statuses for display.
 */
export function getProvenanceCounts(sessionId: string) {
          const state = getState(sessionId);
          let validated = 0;
          let attested = 0;
          let legacyUnverified = 0;

          for (const block of state.blocks) {
            if (block.attestation) {
              attested++;
            } else if (block.provenance) {
              validated++;
            } else {
              legacyUnverified++;
            }
          }

          return {
            validated,
            attested,
            legacyUnverified,
            quarantined: state.quarantinedBlocks.length,
          };
        }

    /**
     * Categorize all blocks by their attestation status.
     * Returns validated (has provenance), attested (user-attested legacy),
     * legacy-unverified (no provenance and no attestation), and quarantined blocks.
     */
        export function getLegacyStatus(sessionId: string) {
          const state = getState(sessionId);
          const validated: CompressionBlock[] = [];
          const attested: CompressionBlock[] = [];
          const unverified: CompressionBlock[] = [];

          for (const block of state.blocks) {
            if (block.attestation) {
              attested.push(block);
            } else if (block.provenance) {
              validated.push(block);
            } else {
              unverified.push(block);
            }
          }

              return { validated, attested, unverified, quarantined: state.quarantinedBlocks };
            }

        /**
         * Move specified legacy-unverified blocks into quarantine.
         * Returns list of block IDs that were quarantined.
     */
    export function quarantineLegacyBlocks(
      sessionId: string,
      blockIds: number[],
      reason: string,
      actor: "user-command" | "system",
      confirmation: "interactive" | "explicit-yes" | "auto",
    ): number[] {
      const state = getState(sessionId);
      const quarantinedIds: number[] = [];
      const remaining: CompressionBlock[] = [];
      const now = Date.now();

      for (const block of state.blocks) {
        if (
          blockIds.includes(block.blockId) &&
          !block.provenance &&
          !block.attestation
        ) {
          const hash = createHash("sha256")
            .update(block.summary)
            .digest("hex");
          state.quarantinedBlocks.push({
            id: `b${block.blockId}`,
            summary: block.summary,
            reason,
            quarantinedAt: now,
            createdAt: block.createdAt,
            actor,
            confirmation,
            summaryHash: hash,
          });
          quarantinedIds.push(block.blockId);
        } else {
          remaining.push(block);
        }
          }

          state.blocks = remaining;
          rebuildPersistentSummary(state);
          persistState(sessionId);
          return quarantinedIds;
        }

    /**
     * Attest a single block by its blockId, binding to the current session ancestry.
     * Returns the attestation metadata or null if block cannot be attested.
     */
        export function attestBlock(
              sessionId: string,
              blockId: number,
              actor: "user-command",
              confirmation: "interactive" | "explicit-yes",
              session: ProvenanceSessionHandle,
        ): LegacyAttestationMetadata | null {
          const state = getState(sessionId);
          const block = state.blocks.find(
            (b) => b.blockId === blockId && !b.provenance && !b.attestation,
          );
          if (!block) return null;

          const now = Date.now();
          const hash = createHash("sha256")
            .update(block.summary)
            .digest("hex");
          const provenance = captureProvenance(session, block.createdAt);
          const metadata: LegacyAttestationMetadata = {
            actor,
            confirmation,
            attestedAt: now,
            attestationLeafId: provenance.leafId,
            summaryHash: hash,
          };

          Object.assign(block, { provenance, attestation: metadata });
          return metadata;
        }
