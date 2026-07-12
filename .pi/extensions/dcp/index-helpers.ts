/**
 * DCP Extension — Index Helpers
 *
 * Pure helper functions extracted from index.ts.
 * No closure over `pi`/`ctx`/`config`.
 */

import type { DcpStateEntryPayload, DurableSessionState } from "./compress.js";
import type { CompactionReason } from "./deterministic.js";

export interface DcpCompactionMetadata {
  reason: CompactionReason;
  willRetry?: boolean;
  customInstructions?: string;
}

function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asMutableRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseCompactionReason(value: unknown): CompactionReason {
  return value === "manual" || value === "threshold" || value === "overflow"
    ? value
    : "unknown";
}

export function serializeSessionEntries(
  entries: readonly unknown[],
): string {
  return entries
    .map((entry, index) => {
      if (!entry || typeof entry !== "object")
        return `[Entry ${index}] ${String(entry)}`;
      const obj = entry as Record<string, unknown>;
      const type = String(obj.type ?? "entry");
      const payload = obj.summary ?? obj.content ?? obj.data ?? obj;
      return `[${type} ${String(obj.id ?? index)}]: ${
        typeof payload === "string"
          ? payload
          : JSON.stringify(payload)
      }`;
    })
    .join("\n\n");
}

export function getCompactionMetadata(
  event: unknown,
): DcpCompactionMetadata {
  const record = asRecord(event);
  return {
    reason: parseCompactionReason(record?.reason),
    willRetry:
      typeof record?.willRetry === "boolean" ? record.willRetry : undefined,
    customInstructions:
      typeof record?.customInstructions === "string"
        ? record.customInstructions
        : undefined,
  };
}

export function getDeterministicTranscriptLimit(
  baseLimit: number,
  reason: CompactionReason,
): number {
  if (reason !== "overflow") return baseLimit;
  return Math.max(baseLimit, Math.ceil(baseLimit * 1.5));
}

export function prependCompactionContext(
  summary: string,
  metadata: DcpCompactionMetadata,
): string {
  const lines = [`Compaction reason: ${metadata.reason}.`];
  if (typeof metadata.willRetry === "boolean") {
    lines.push(
      metadata.willRetry
        ? "Pi will retry the interrupted turn after compaction."
        : "Pi will not retry an interrupted turn after compaction.",
    );
  }
  if (metadata.reason === "overflow") {
    lines.push(
      "Overflow recovery: preserve the latest user intent and split-turn context needed for retry.",
    );
  }
  if (metadata.customInstructions) {
    lines.push(`Manual compact instructions: ${metadata.customInstructions}`);
  }
  return `${lines.join("\n")}\n\n${summary}`;
}

export function addDcpCompactionDetails(
  result: { details?: unknown },
  sessionId: string,
  metadata: DcpCompactionMetadata,
  makeDcpStateEntryPayloadFn: (
    sessionId: string,
    reason: string,
  ) => DcpStateEntryPayload,
): void {
  const details = asMutableRecord(result.details) ?? {};
  const dcp = asMutableRecord(details.dcp) ?? {};
  dcp.deterministic = false;
  dcp.reason = metadata.reason;
  if (typeof metadata.willRetry === "boolean") {
    dcp.willRetry = metadata.willRetry;
  }
  if (metadata.customInstructions) {
    dcp.customInstructions = metadata.customInstructions;
  }
  dcp.snapshot = makeDcpStateEntryPayloadFn(sessionId, "compaction").snapshot;
  details.dcp = dcp;
  result.details = details;
}
