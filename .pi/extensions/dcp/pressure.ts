/**
 * Context pressure % for nudges and autoCompact (branch vs outbound vs max).
 */

import type { AutoCompactConfig } from "./config.js";
import type { ContextMeterSnapshot } from "./context-meter.js";

export type ContextPressureSource = "branch" | "outbound" | "max";

export interface ContextPressure {
  percent: number;
  source: ContextPressureSource;
  branchPercent: number | null;
  outboundPercent: number | null;
}

export function resolveContextPressure(
  meter: ContextMeterSnapshot,
  source: ContextPressureSource,
): ContextPressure {
  const branch = meter.branchPercent ?? 0;
  const outbound =
    meter.outboundTokens > 0 ? (meter.outboundPercent ?? 0) : null;

  let percent: number;
  let resolved: ContextPressureSource;

  switch (source) {
    case "branch":
      percent = branch;
      resolved = "branch";
      break;
    case "outbound":
      if (outbound != null) {
        percent = outbound;
        resolved = "outbound";
      } else {
        percent = branch;
        resolved = "branch";
      }
      break;
    case "max":
    default:
      if (outbound != null) {
        percent = Math.max(branch, outbound);
        resolved = branch >= outbound ? "branch" : "outbound";
      } else {
        percent = branch;
        resolved = "branch";
      }
      break;
  }

  return {
    percent,
    source: resolved,
    branchPercent: meter.branchPercent,
    outboundPercent: outbound,
  };
}

export function formatPressureSourceLabel(source: ContextPressureSource): string {
  switch (source) {
    case "branch":
      return "branch";
    case "outbound":
      return "outbound";
    case "max":
      return "max(branch,outbound)";
  }
}

export interface AutoCompactThreshold {
  ratio: number;
  percent: number;
  tokens: number;
}

export function resolveAutoCompactThreshold(
  cfg: AutoCompactConfig,
  contextWindow: number,
  fallbackContextWindow = 200_000,
 ): AutoCompactThreshold {
  const rawRatio =
    typeof cfg.thresholdRatio === "number"
      ? cfg.thresholdRatio
      : cfg.thresholdPercent / 100;
  const ratio = clampRatio(rawRatio);
  const window = contextWindow > 0 ? contextWindow : fallbackContextWindow;
  return {
    ratio,
    percent: ratio * 100,
    tokens: Math.floor(window * ratio),
  };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.8;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}