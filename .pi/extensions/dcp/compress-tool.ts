import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DCPConfig } from "./config.js";
import {
  addBlock,
  getStats,
  getState,
  makeDcpStateEntryPayload,
} from "./compress-state.js";
import {
  evaluateCompressionProbes,
  mergeIntoPersistentSummary,
  recordProbeResults,
  extractStructuredFields,
  buildCompressedSummaryMessage,
} from "./compress-summary.js";
import { recordCompressFiles, getQualityStatus } from "./compress-metrics.js";

const COMPRESS_TOOL_DESCRIPTION =
  `Compress a conversation range into a dense summary (replaces range with anchor reference).
   Always returns blockId + summary + structured fields for context continuation.
   Use instead of manual summarization — ensures proper DCP state tracking.

   Args:
     summary: The compressed summary text
     topic: Short label for this block (3–5 words)
     files_read: Comma-separated file paths read in this range
     files_modified: Comma-separated file paths modified in this range
     decisions: Comma-separated key decisions made in this range
     next_steps: Comma-separated remaining tasks
     start_message_id: Starting message identifier (optional)
     end_message_id: Ending message identifier (optional)`;

let compressToolRegistered = false;

export function registerCompressTool(
  pi: ExtensionAPI,
  config: DCPConfig,
  nudge: (msg: string) => void,
): void {
  if (compressToolRegistered) return;

  pi.registerTool("compress", COMPRESS_TOOL_DESCRIPTION, async (params) => {
    const sessionId = pi.sessionManager.getSessionFile() ?? pi.cwd;
    const { fields, narrative } = extractStructuredFields(params, config);
    const topic = (params.topic as string) ?? "session-context";

    const startLabel = (params.start_message_id as string) ?? "auto";
    const endLabel = (params.end_message_id as string) ?? "auto";

    const block = addBlock(
      sessionId,
      topic,
      narrative,
      startLabel,
      endLabel,
      {
        files_read: fields.files_read,
        files_modified: fields.files_modified,
        decisions: fields.decisions,
        next_steps: fields.next_steps,
      },
    );

    mergeIntoPersistentSummary(sessionId, fields, topic, block.blockId);

    if (config.structuredSummary.qualityProbes?.enabled) {
      const probeResults = evaluateCompressionProbes(
        fields,
        narrative,
        block.summaryTokens,
        config.structuredSummary.qualityProbes ?? {
          enabled: true,
          minFileCoverage: 50,
          minDecisionCoverage: 50,
          minNarrativeDepth: 50,
          minStructureCompleteness: 50,
          minProbePassRate: 60,
        },
      );
      recordProbeResults(sessionId, probeResults);

      if (!probeResults.allPassed && nudge) {
        const failedProbes = probeResults.probes
          .filter((p) => !p.pass)
          .map((p) => `${p.name}: ${p.detail}`)
          .join("; ");
        nudge(`Compression quality warning — ${failedProbes}`);
      }
    }

    recordCompressFiles(
      sessionId,
      [...fields.files_read, ...fields.files_modified],
    );

    const state = getState(sessionId);
    const quality = state.qualityMetrics;
    quality.totalCompressions++;
    if (config.structuredSummary.qualityProbes?.enabled) {
      const probe = evaluateCompressionProbes(
        fields,
        narrative,
        block.summaryTokens,
        config.structuredSummary.qualityProbes,
      );
      if (probe.allPassed) {
        quality.cleanCompressions++;
      }
    } else {
      quality.cleanCompressions++;
    }

    state.currentTurn = quality.totalCompressions;

    const summaryMessage = buildCompressedSummaryMessage(
      state.persistentSummary,
    );

    const stats = getStats(sessionId);
    const isFirst = state.blocks.length <= 1;

    return {
      blockId: block.blockId,
      blockCount: stats.blockCount,
      summary: summaryMessage,
      probeResults: quality.lastProbeResults,
      qualityStatus: isFirst ? undefined : getQualityStatus(sessionId),
    };
  });

  pi.on("afterToolCall", (event) => {
    if (!event?.result?.details?.dcpStateEvent) return;
    const sessionId = pi.sessionManager.getSessionFile() ?? pi.cwd;
    const payload = makeDcpStateEntryPayload(sessionId, "tool-call auto-save");
    try {
      const details = event.result as Record<string, unknown>;
      if (!details.dcp) {
        details.dcp = {};
      }
      (details.dcp as Record<string, unknown>).snapshot = payload.snapshot;
    } catch {
      // Best-effort: can't modify frozen results
    }
  });

  compressToolRegistered = true;
}
