/**
 * DCP Extension — Compress Tool
 *
 * Agent-callable tool that writes a durable summary block.
 *
 * CRITICAL: pi.registerTool only accepts a ToolDefinition object
 * (`{ name, parameters, execute, ... }`). The multi-arg form
 * `registerTool("name", description, fn)` treats the string as the tool
 * definition, so `tool.name` is undefined. JSON then omits `name` and
 * providers return 422 "missing field `name`" (or tools[N].name missing)
 * on every request after session_start — including resume.
 */

import { createHash } from "node:crypto";
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
    import { Text } from "@earendil-works/pi-tui";
    import type { DCPConfig } from "./config.js";
    import {
      addBlock,
      captureProvenance,
      getBlocks,
      getDcpSessionId,
      getQualityMetrics,
      getStats,
      getState,
      makeDcpStateEntryPayload,
      persistState,
    } from "./compress-state.js";
    import { computeProtectionPolicy } from "./protection.js";
    import { getSessionBranchMessages } from "./branch-messages.js";
import {
  evaluateCompressionProbes,
  extractStructuredFields,
  mergeIntoPersistentSummary,
  recordProbeResults,
} from "./compress-summary.js";
import {
  getQualityStatus,
  recordCompressEvent,
} from "./compress-metrics.js";
import { renderCompressResult } from "./compress-render.js";
import { DCP_STATE_ENTRY_TYPE } from "./compress-types.js";
import {
  appendDcpCheckpointReference,
  appendDcpUsageReference,
  emptyDcpKnowledgeReferences,
  type DcpUsageReference,
} from "./knowledge-port.js";
import type { QualityMetricsData, StructuredSummaryFields } from "./compress-types.js";

type CompressToolDetails =
  | { denied: true }
  | {
      blockId: number;
      topic: string;
      mode: string;
      summaryTokens: number;
      summaryBufferTokens: number;
      files: StructuredSummaryFields;
      quality: QualityMetricsData;
    };

const COMPRESS_TOOL_DESCRIPTION = `Save a durable summary of completed work to DCP (Durable Compression Protocol).

Call this when:
1. You finished a multi-step task and context is getting long
2. A /dcp-nudge or [DCP Nudge] message asked you to compress
3. You are about to switch topics and want to preserve state

Write a DETAILED summary covering: what was done, key decisions, current state of all modified files, and remaining work. This summary is the only record after context is compacted — be thorough.`;

const compressParams = Type.Object({
  summary: Type.String({
    description:
      "Detailed summary of work done, decisions made, file states, and remaining tasks. Be thorough — this replaces the raw history.",
  }),
  files_read: Type.Optional(
    Type.String({
      description: "Comma-separated paths of files that were read/examined",
    }),
  ),
  files_modified: Type.Optional(
    Type.String({
      description: "Comma-separated paths of files that were created/edited",
    }),
  ),
  decisions: Type.Optional(
    Type.String({
      description: "Comma-separated key decisions made during this work",
    }),
  ),
  next_steps: Type.Optional(
    Type.String({
      description: "Comma-separated remaining tasks / next steps",
    }),
  ),
  usage_ids: Type.Optional(
    Type.Array(Type.String(), {
      maxItems: 16,
      description: "Exact pi-learning usage receipt IDs for learnings this checkpoint actually uses",
    }),
  ),
});

export function registerCompressTool(
  pi: ExtensionAPI,
  config: DCPConfig,
  nudge?: (msg: string) => void,
  resolveUsageIds?: (ids: readonly string[]) => DcpUsageReference[],
): void {
  pi.registerTool<typeof compressParams, CompressToolDetails>({
    name: "compress",
    label: "compress",
    description: COMPRESS_TOOL_DESCRIPTION,
    parameters: compressParams,
    renderCall: (_args, theme) =>
      new Text(theme.fg("toolTitle", theme.bold("⚙ compress")), 0, 0),
    async execute(
      _toolCallId: string,
      params: {
        summary: string;
        files_read?: string;
        files_modified?: string;
        decisions?: string;
        next_steps?: string;
        usage_ids?: string[];
      },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      if (config.compress.permission === "deny") {
        return {
          content: [
            {
              type: "text" as const,
              text: "DCP compress denied by config (compress.permission=deny).",
            },
          ],
          details: { denied: true },
        };
      }

          const sessionId = getDcpSessionId(ctx);
          const { fields, narrative } = extractStructuredFields(
            params as Record<string, unknown>,
            config,
          );
          const mode = "manual";

          // Compute protection provenance over the current session messages
          const sessionMessages = getSessionBranchMessages(ctx);
          const protectionProvenance = sessionMessages.length > 0
            ? computeProtectionPolicy(sessionMessages, config).provenance
            : undefined;

          const provenance = ctx.sessionManager
            ? captureProvenance(
                ctx.sessionManager,
                Date.now(),
                protectionProvenance,
                "manual",
              )
            : undefined;

          const block = addBlock(
            sessionId,
            "manual",
            narrative,
            "manual",
            "manual",
            {
              files_read: fields.files_read,
              files_modified: fields.files_modified,
              decisions: fields.decisions,
              next_steps: fields.next_steps,
              source: mode,
              ...(protectionProvenance ? { protectionProvenance } : {}),
            },
            provenance,
          );

      const usage = resolveUsageIds?.(params.usage_ids ?? []) ?? [];
      if (usage.length > 0) {
        const state = getState(sessionId);
        let references = state.knowledgeReferences ?? emptyDcpKnowledgeReferences();
        for (const receipt of usage) {
          references = appendDcpUsageReference(references, receipt);
        }
        const subjectDigest = `sha256:v1:${createHash("sha256")
          .update(block.summary)
          .digest("hex")}`;
        references = appendDcpCheckpointReference(references, {
          checkpointId: `checkpoint:${block.blockId}`,
          blockId: String(block.blockId),
          subjectDigest,
          occurredAt: new Date(block.createdAt).toISOString(),
          usageIds: usage.map((receipt) => receipt.usageId),
        });
        state.knowledgeReferences = references;
        persistState(sessionId);
      }

      mergeIntoPersistentSummary(sessionId, fields, "manual", block.blockId);
      recordCompressEvent(sessionId, block.blockId, fields);

      if (config.probeEvaluation.enabled) {
        const probeResult = evaluateCompressionProbes(
          fields,
          narrative,
          block.summaryTokens,
          config.probeEvaluation,
        );
        recordProbeResults(sessionId, probeResult);
      }

      pi.appendEntry(
        DCP_STATE_ENTRY_TYPE,
        makeDcpStateEntryPayload(sessionId, "manual-compress"),
      );

      const stats = getStats(sessionId);
      const qualityStatus = getQualityStatus(sessionId);
      const qm = getQualityMetrics(sessionId);
      const first = getBlocks(sessionId).length <= 1;

      if (nudge) {
        nudge(
          `Manual compress recorded (b${block.blockId}). ${qualityStatus}`,
        );
      }

      const lines = [
        `DCP compress saved as block b${block.blockId}.`,
        `Summary tokens: ~${block.summaryTokens}. Store: ${stats.blockCount} blocks, ~${stats.summaryTokens} summary tokens.`,
        first ? "" : qualityStatus,
      ].filter(Boolean);

      if (config.probeEvaluation.enabled && qm.lastProbeResults) {
        const probeLines: string[] = [
          "",
          "--- Compression quality probes ---",
        ];
        for (const p of qm.lastProbeResults.probes) {
          const icon = p.pass ? "PASS" : "FAIL";
          probeLines.push(
            `  [${icon}] ${p.name}: ${p.score}/100 — ${p.detail}`,
          );
        }
        const overallIcon = qm.lastProbeResults.allPassed ? "PASS" : "FAIL";
        probeLines.push(
          `  [${overallIcon}] Overall: ${qm.lastProbeResults.overallScore}/100`,
        );
        lines.push(...probeLines);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: {
          blockId: block.blockId,
          topic: block.topic,
          mode,
          summaryTokens: block.summaryTokens,
          summaryBufferTokens: stats.summaryTokens,
          files: fields,
          quality: qm,
        },
      };
    },
    renderResult(result, options, theme) {
      return renderCompressResult(result, options, theme);
    },
  });
}
