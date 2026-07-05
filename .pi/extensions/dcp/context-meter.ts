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

export function buildContextMeterSnapshot(
  branchTokens: number | null | undefined,
  outboundTokens: number,
  contextWindow: number,
): ContextMeterSnapshot {
  const window = contextWindow > 0 ? contextWindow : 200_000;
  const branchPercent =
    branchTokens != null && branchTokens > 0
      ? (branchTokens / window) * 100
      : null;
  const outboundPercent =
    outboundTokens > 0 ? (outboundTokens / window) * 100 : 0;
  const deltaTokens =
    branchTokens != null ? branchTokens - outboundTokens : null;

  return {
    branchTokens: branchTokens ?? null,
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