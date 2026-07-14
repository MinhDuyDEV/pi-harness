/**
 * Compare Pi branch usage (getContextUsage) vs DCP-pruned outbound payload.
 */

import type { Message } from "@earendil-works/pi-ai";
import type { DCPConfig } from "./config.js";
import { estimateTokens, processContextMessages } from "./compress.js";

export interface ContextMeterSnapshot {
  branchTokens: number | null;
  outboundTokens: number;
  branchPercent: number | null;
  outboundPercent: number | null;
  contextWindow: number;
  deltaTokens: number | null;
  strippedByDcp: boolean;
}

export function estimateOutboundContextTokens(
  branchMessages: readonly Message[],
  sessionId: string,
  config: DCPConfig,
): number {
  const pruned = processContextMessages([...branchMessages], sessionId, config);
  return pruned.reduce((sum, msg) => sum + estimateTokens(msg), 0);
}

/**
 * Build a snapshot of context usage for diagnostics/telemetry.
 *
 * When `branchTokens` is null/undefined (Pi reports processed-history estimate),
 * all percentage-based diagnostics are explicitly suppressed (`branchPercent` is null,
 * `deltaTokens` is null, `strippedByDcp` is false). Callers MUST check `branchPercent`
 * before displaying any percentage output.
 */
export function buildContextMeterSnapshot(
  branchTokens: number | null | undefined,
  outboundTokens: number,
  contextWindow: number,
): ContextMeterSnapshot {
  const window = contextWindow > 0 ? contextWindow : 200_000;

  // When Pi reports null tokens, suppress all percentage diagnostics
  if (branchTokens == null) {
    return {
      branchTokens: null,
      outboundTokens,
      branchPercent: null,
      outboundPercent: outboundTokens > 0 ? (outboundTokens / window) * 100 : 0,
      contextWindow: window,
      deltaTokens: null,
      strippedByDcp: false,
    };
  }

  const branchTokensVal = branchTokens;
  const branchPercent = (branchTokensVal / window) * 100;
  const outboundPercent =
    outboundTokens > 0 ? (outboundTokens / window) * 100 : 0;
  const deltaTokens = branchTokensVal - outboundTokens;

  return {
    branchTokens: branchTokensVal,
    outboundTokens,
    branchPercent,
    outboundPercent,
    contextWindow: window,
    deltaTokens,
    strippedByDcp:
      outboundTokens > 0 &&
      deltaTokens != null &&
      deltaTokens > 500,
  };
}