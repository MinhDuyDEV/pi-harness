/**
 * DCP telemetry payloads for extension events.
 *
 * Payloads contain only JSON-safe values so RPC and JSON consumers can use
 * them without custom serialization.
 */

import type { CompactionReason } from "./deterministic.js";
export type { CompactionReason } from "./deterministic.js";

export const DCP_TELEMETRY_EVENT = "dcp:telemetry" as const;

export type DCPTelemetryEvent =
  | DCPCompactionCompletedEvent
  | DCPStateRestoredEvent
  | DCPNudgeEvaluatedEvent
  | DCPLifecycleForkEvent
  | DCPNullTokensEvent;

export interface CompactionOutcome {
  blockCount: number;
  artifactCount: number;
  deterministic: boolean;
  reason: CompactionReason;
  willRetry: boolean;
}

export interface DCPCompactionCompletedEvent {
  type: "compaction_completed";
  timestamp: number;
  outcome: CompactionOutcome;
}

export interface DCPStateRestoredEvent {
  type: "state_restored";
  timestamp: number;
  sessionIdMatch: boolean;
  blockCount: number;
  restoredVersion: number;
}

export interface DCPNudgeEvaluatedEvent {
  type: "nudge_evaluated";
  timestamp: number;
  branchTokens: number | null;
  branchPercent: number | null;
  nudgeEmitted: boolean;
}

export interface DCPLifecycleForkEvent {
  type: "lifecycle_fork";
  timestamp: number;
  stateCleanedUp: boolean;
  initialReset: boolean;
}

export interface DCPNullTokensEvent {
  type: "null_tokens";
  timestamp: number;
  processedHistoryEstimateTokens: number | null;
}

export function buildCompactionCompletedEvent(
  outcome: CompactionOutcome,
): DCPCompactionCompletedEvent {
  return { type: "compaction_completed", timestamp: Date.now(), outcome };
}

export function buildStateRestoredEvent(
  sessionIdMatch: boolean,
  blockCount: number,
  restoredVersion: number,
): DCPStateRestoredEvent {
  return {
    type: "state_restored",
    timestamp: Date.now(),
    sessionIdMatch,
    blockCount,
    restoredVersion,
  };
}

export function buildNudgeEvaluatedEvent(
  branchTokens: number | null,
  branchPercent: number | null,
  nudgeEmitted: boolean,
): DCPNudgeEvaluatedEvent {
  return {
    type: "nudge_evaluated",
    timestamp: Date.now(),
    branchTokens,
    branchPercent,
    nudgeEmitted,
  };
}

export function buildLifecycleForkEvent(
  stateCleanedUp: boolean,
  initialReset: boolean,
): DCPLifecycleForkEvent {
  return {
    type: "lifecycle_fork",
    timestamp: Date.now(),
    stateCleanedUp,
    initialReset,
  };
}

export function buildNullTokensEvent(
  processedHistoryEstimateTokens: number | null,
): DCPNullTokensEvent {
  return {
    type: "null_tokens",
    timestamp: Date.now(),
    processedHistoryEstimateTokens,
  };
}
