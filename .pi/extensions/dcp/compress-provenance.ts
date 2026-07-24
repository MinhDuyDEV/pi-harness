import type { DcpProvenanceV2 } from "./compress-types.js";

export interface ProvenanceSessionHandle {
  getSessionId(): string;
  getLeafId(): string | null;
  getBranch(fromId?: string): readonly { id: string }[];
}

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
    coveredEntryIds: branch.map((entry) => entry.id),
    createdAt: blockCreatedAt,
    protectionProvenance,
    summarySource,
  };
}

export function validateBlockProvenance(
  provenance: DcpProvenanceV2,
  session: {
    getSessionId(): string;
    getBranch(fromId?: string): readonly { id: string }[];
  },
): { valid: true } | { valid: false; reason: string } {
  const currentSessionId = session.getSessionId();
  if (provenance.sessionId !== currentSessionId) {
    return { valid: false, reason: `Session mismatch: block session "${provenance.sessionId}" !== current "${currentSessionId}"` };
  }
  const reachableIds = new Set(session.getBranch().map((entry) => entry.id));
  for (const id of provenance.coveredEntryIds) {
    if (!reachableIds.has(id)) {
      return { valid: false, reason: `Covered entry ${id} is not reachable in current branch (has ${reachableIds.size} entries)` };
    }
  }
  if (provenance.leafId !== null && !reachableIds.has(provenance.leafId)) {
    return { valid: false, reason: `Creation leaf ${provenance.leafId} is not reachable in current branch` };
  }
  return { valid: true };
}
