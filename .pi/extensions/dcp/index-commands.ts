/**
 * DCP Extension — Command Registrations
 *
 * /dcp and /dcp-recall command handlers.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import type { DCPConfig } from "./config.js";
import {
  getBlocks,
  getDcpSessionId,
  getPersistentSummary,
  getProvenanceCounts,
  getQuarantinedBlocks,
  getStats,
  getArtifactTracker,
} from "./compress.js";
import { getSessionBranchMessages } from "./branch-messages.js";
import { searchDcpRecall } from "./recall.js";
import { formatPressureSourceLabel } from "./pressure.js";
import type { ContextMeterSnapshot } from "./context-meter.js";

export function registerDcpCommand(
  pi: ExtensionAPI,
  _ctx: ExtensionContext,
  config: DCPConfig,
  nudge: {
    refreshContextMeter: (ctx: ExtensionContext, meter: ContextMeterSnapshot) => void;
    getState: () => import("./nudge.js").NudgeState;
  },
  helpers: {
    estimateOutboundContextTokens: (
      messages: Message[],
      sessionId: string,
      config: DCPConfig,
    ) => number;
    buildContextMeterSnapshot: (
      usedTokens: number | null | undefined,
      outboundTokens: number,
      contextWindow: number,
    ) => ContextMeterSnapshot;
  },
  ensureInitialized: (ctx: ExtensionContext) => void,
): void {
  pi.registerCommand("dcp", {
    description:
      "DCP status — compression blocks, artifact tracking, quality metrics, and nudges",
    async handler(_args: string, ctx: ExtensionContext) {
      ensureInitialized(ctx);

      // Legacy subcommand routing
      if (_args.trim().startsWith("legacy")) {
        const { handleLegacyCommand } = await import("./legacy-attestation.js");
        const { makeDcpStateEntryPayload, DCP_STATE_ENTRY_TYPE } =
          await import("./compress.js");
        const legacyArgs = _args.trim().slice("legacy".length).trim();
        await handleLegacyCommand(
          legacyArgs,
          {
            notify: (msg: string) => ctx.ui.notify(msg),
            confirm: (title: string, message: string) =>
              ctx.ui.confirm(title, message),
          },
          {
            stateKey: getDcpSessionId(ctx),
            session: ctx.sessionManager,
            appendState: (reason: string) => {
              const stateKey = getDcpSessionId(ctx);
              pi.appendEntry(
                DCP_STATE_ENTRY_TYPE,
                makeDcpStateEntryPayload(stateKey, reason),
              );
            },
          },
        );
        return;
      }

      const sessionId = getDcpSessionId(ctx);
      const usage = ctx.getContextUsage();
      const contextWindow = ctx.model?.contextWindow ?? 200_000;
      const outboundTokens = helpers.estimateOutboundContextTokens(
        getSessionBranchMessages(ctx),
        sessionId,
        config,
      );
      const meter = helpers.buildContextMeterSnapshot(
        usage?.tokens,
        outboundTokens,
        contextWindow,
      );
      nudge.refreshContextMeter(ctx, meter);

      const blocks = getBlocks(sessionId);
      const provenance = getProvenanceCounts(sessionId);
      const quarantined = getQuarantinedBlocks(sessionId);
      const stats = getStats(sessionId);
      const nudgeState = nudge.getState();

      const lines: string[] = [
        "## DCP Status",
        "",
        `Context: ${nudgeState.lastContextTokens !== null ? `${Math.round(nudgeState.lastContextTokens / 1000)}k branch` : "no data"}` +
          (nudgeState.lastContextPercent !== null
            ? ` (${Math.round(nudgeState.lastContextPercent)}%)`
            : "") +
          (nudgeState.lastMeter
            ? nudgeState.lastMeter.outboundTokens > 0
              ? ` | estimate ${Math.round(nudgeState.lastMeter.outboundTokens / 1000)}k` +
                (nudgeState.lastMeter.strippedByDcp
                  ? ` (\u0394${Math.round((nudgeState.lastMeter.deltaTokens ?? 0) / 1000)}k)`
                  : "")
              : " | estimate n/a (run after an agent turn)"
            : "") +
          (nudgeState.lastPressurePercent != null
            ? ` | pressure ${Math.round(nudgeState.lastPressurePercent)}% (${formatPressureSourceLabel(nudgeState.lastPressureSource ?? "branch")})`
            : ""),
        "",
        "### Compression Blocks",
        blocks.length === 0
          ? "  None yet. Use `compress` when a phase is complete."
          : blocks
              .map(
                (b) =>
                  `  b${b.blockId}: ${b.topic} (~${b.summaryTokens} tokens)`,
              )
              .join("\n"),
        "",
        "### Provenance",
        `  Validated: ${provenance.validated}${provenance.attested != null ? ` | Attested: ${provenance.attested}` : ""} | Legacy unverified: ${provenance.legacyUnverified} | Quarantined: ${quarantined.length}`,
        "",
        (() => {
          const branchMsgs = getSessionBranchMessages(ctx);
          const tokenCount = branchMsgs.reduce((sum: number, m: Message) => {
            try {
              return sum + Math.ceil(JSON.stringify(m).length / 3.5);
            } catch {
              return sum;
            }
          }, 0);
          return `This run: ~${tokenCount} tokens (resets on Pi restart)`;
        })(),
        "",
      ];

      if (config.qualityMetrics.enabled) {
        const qm = stats.qualityMetrics;
        if (qm.totalCompressions > 0) {
          lines.push("### Quality Metrics");
          lines.push(`  Compressions: ${qm.totalCompressions}`);
          lines.push(`  Re-read events: ${qm.reReadsAfterCompress}`);
          if (qm.totalCompressions > 0 && qm.reReadsAfterCompress > 0) {
            lines.push(
              `  Avg re-read events per compression: ${(qm.reReadsAfterCompress / qm.totalCompressions).toFixed(1)}`,
            );
          }
          lines.push(`  Clean streak: ${qm.cleanCompressions}`);
          if (qm.regressionLog.length > 0) {
            lines.push("  Recent regressions:");
            const recent = qm.regressionLog.slice(-3);
            for (const r of recent) {
              lines.push(
                `    b${r.blockId} \u2192 ${r.file} (gap: ${r.turnGap} turns)`,
              );
            }
          }
          lines.push("");
        }
      }

      if (
        config.probeEvaluation?.enabled &&
        stats.qualityMetrics.lastProbeResults
      ) {
        const pr = stats.qualityMetrics.lastProbeResults;
        lines.push("### Probe Evaluation (last compression)");
        for (const p of pr.probes) {
          const icon = p.pass ? "\uF00C" : "\uF071";
          lines.push(`  ${icon} ${p.name}: ${p.score}/100 \u2014 ${p.detail}`);
        }
        const overallIcon = pr.allPassed ? "\uF00C" : "\uF071";
        lines.push(`  ${overallIcon} Overall: ${pr.overallScore}/100`);
        if (stats.qualityMetrics.avgProbeScore > 0) {
          lines.push(
            `  Running average: ${Math.round(stats.qualityMetrics.avgProbeScore)}/100`,
          );
        }
        if (stats.qualityMetrics.failedProbes > 0) {
          lines.push(
            `  Failed compressions: ${stats.qualityMetrics.failedProbes}`,
          );
        }
        lines.push("");
      }

      if (config.artifactTracking.enabled) {
        const artifacts = getArtifactTracker(sessionId);
        const totalTracked =
          artifacts.files_read.length + artifacts.files_modified.length;
        if (totalTracked > 0) {
          lines.push("### Artifact Tracking");
          if (artifacts.files_read.length > 0) {
            lines.push(`  Files read (${artifacts.files_read.length}):`);
            for (const f of artifacts.files_read.slice(0, 10)) {
              lines.push(`    \u2022 ${f}`);
            }
            if (artifacts.files_read.length > 10) {
              lines.push(
                `    \u2026 and ${artifacts.files_read.length - 10} more`,
              );
            }
          }
          if (artifacts.files_modified.length > 0) {
            lines.push(
              `  Files modified (${artifacts.files_modified.length}):`,
            );
            for (const f of artifacts.files_modified.slice(0, 5)) {
              lines.push(`    \u2022 ${f}`);
            }
            if (artifacts.files_modified.length > 5) {
              lines.push(
                `    \u2026 and ${artifacts.files_modified.length - 5} more`,
              );
            }
          }
          lines.push("");
        }
      }

      if (config.structuredSummary.enabled) {
        const ps = getPersistentSummary(sessionId);
        if (ps.merged_block_ids.length > 0) {
          lines.push("### Persistent Summary");
          lines.push(`  Merged blocks: ${ps.merged_block_ids.join(", ")}`);
          lines.push(
            `  Files tracked: ${ps.files_read.length} read, ${ps.files_modified.length} modified`,
          );
          lines.push(`  Decisions: ${ps.decisions.length}`);
          lines.push(`  Narrative segments: ${ps.narrative_parts.length}`);
          lines.push(
            `  Last updated: ${new Date(ps.last_updated).toLocaleTimeString()}`,
          );
          lines.push("");
        }
      }

      lines.push(
        nudgeState.pendingNudge
          ? `\uF071 Pending nudge: "${nudgeState.pendingNudge}"`
          : "No pending nudge",
      );

      const output = lines.filter(Boolean).join("\n");
      if (ctx.hasUI) ctx.ui.notify(output);
    },
  });
}

export function registerDcpRecallCommand(
  pi: ExtensionAPI,
  _ctx: ExtensionContext,
  config: DCPConfig,
  ensureInitialized: (ctx: ExtensionContext) => void,
): void {
  pi.registerCommand("dcp-recall", {
    description:
      "Search durable DCP blocks and raw Pi session JSONL. Usage: /dcp-recall <query> [scope:all] [page:N] [expand:N,N]",
    async handler(args: string, ctx: ExtensionContext) {
      ensureInitialized(ctx);
      const scope = /\bscope:all\b/i.test(args) ? "all" : "active";
      const pageMatch = args.match(/\bpage:(\d+)\b/i);
      const expandMatch = args.match(/\bexpand:([\d,\s]+)\b/i);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      const expand = expandMatch
        ? expandMatch[1]
            .split(/[,\s]+/)
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item))
        : undefined;
      const query = args
        .replace(/\bscope:all\b/gi, "")
        .replace(/\bpage:\d+\b/gi, "")
        .replace(/\bexpand:[\d,\s]+\b/gi, "")
        .trim();
      const result = searchDcpRecall({
        sessionId: getDcpSessionId(ctx),
        sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
        query,
        expand,
        page,
        scope,
      });
      if (ctx.hasUI) ctx.ui.notify(result.rendered);
    },
  });
}
