import { createHash } from "node:crypto";
import type {
  CompressionBlock,
  LegacyAttestationMetadata,
} from "./compress-types.js";
import { getState, persistState, rebuildPersistentSummary } from "./compress-state-core.js";
import { captureProvenance, type ProvenanceSessionHandle } from "./compress-provenance.js";

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
