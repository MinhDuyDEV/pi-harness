import { createHash } from "node:crypto";
import type { SessionState } from "./compress-types.js";

export interface DcpUsageReference {
  version: 1;
  usageId: string;
  projectId: string;
  trustEpoch: string;
  sessionGeneration: string;
  consumer: { kind: "parent-turn" | "subagent"; id: string };
  correlationId: string;
  requestDigest: string;
  queryDigest: string;
  learningId: string;
  learningRevision: number;
  learningDigest: string;
  returnedAt: string;
}

export interface DcpKnowledgeReferences {
  version: 2;
  usage: DcpUsageReference[];
  checkpoints: DcpCheckpointReference[];
}

export interface DcpCheckpointReference {
  version: 1;
  eventId: string;
  checkpointId: string;
  blockId: string;
  subjectDigest: string;
  occurredAt: string;
  usageIds: string[];
}

export const emptyDcpKnowledgeReferences = (): DcpKnowledgeReferences => ({
  version: 2,
  usage: [],
  checkpoints: [],
});

const TAGGED = /^sha256:v1:[0-9a-f]{64}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safe(value: unknown, maximum = 240): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum &&
    !/\b(?:api[_-]?key|secret|token|password|authorization)\s*[:=]\s*\S+/i.test(value);
}

function tagged(value: unknown): value is string {
  return typeof value === "string" && TAGGED.test(value);
}

function exact(input: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(input).every((key) => allowed.has(key));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonical(input[key])]));
}

function taggedDigest(value: unknown): string {
  return `sha256:v1:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}

export function parseDcpUsageReference(value: unknown): DcpUsageReference | undefined {
  const input = record(value);
  const consumer = record(input?.consumer);
  if (
    !input ||
    !exact(input, [
      "version", "usageId", "projectId", "trustEpoch", "sessionGeneration", "consumer",
      "correlationId", "requestDigest", "queryDigest", "learningId", "learningRevision",
      "learningDigest", "returnedAt",
    ]) ||
    input.version !== 1 ||
    !tagged(input.usageId) ||
    !safe(input.projectId) ||
    !safe(input.trustEpoch) ||
    !safe(input.sessionGeneration) ||
    !consumer ||
    !exact(consumer, ["kind", "id"]) ||
    (consumer.kind !== "parent-turn" && consumer.kind !== "subagent") ||
    !safe(consumer.id) ||
    !safe(input.correlationId) ||
    !tagged(input.requestDigest) ||
    !tagged(input.queryDigest) ||
    !safe(input.learningId) ||
    !Number.isInteger(input.learningRevision) ||
    Number(input.learningRevision) < 1 ||
    !tagged(input.learningDigest) ||
    !safe(input.returnedAt, 80) ||
    !Number.isFinite(Date.parse(input.returnedAt))
  ) return undefined;
  return {
    version: 1,
    usageId: input.usageId,
    projectId: input.projectId,
    trustEpoch: input.trustEpoch,
    sessionGeneration: input.sessionGeneration,
    consumer: { kind: consumer.kind, id: consumer.id },
    correlationId: input.correlationId,
    requestDigest: input.requestDigest,
    queryDigest: input.queryDigest,
    learningId: input.learningId,
    learningRevision: Number(input.learningRevision),
    learningDigest: input.learningDigest,
    returnedAt: input.returnedAt,
  };
}

export function parseDcpCheckpointReference(value: unknown): DcpCheckpointReference | undefined {
  const input = record(value);
  if (
    !input ||
    !exact(input, ["version", "eventId", "checkpointId", "blockId", "subjectDigest", "occurredAt", "usageIds"]) ||
    input.version !== 1 ||
    !safe(input.eventId) ||
    !safe(input.checkpointId) ||
    !safe(input.blockId) ||
    !tagged(input.subjectDigest) ||
    !safe(input.occurredAt, 80) ||
    !Number.isFinite(Date.parse(input.occurredAt)) ||
    !Array.isArray(input.usageIds) ||
    input.usageIds.length === 0 ||
    input.usageIds.length > 16 ||
    !input.usageIds.every(tagged)
  ) return undefined;
  return {
    version: 1,
    eventId: input.eventId,
    checkpointId: input.checkpointId,
    blockId: input.blockId,
    subjectDigest: input.subjectDigest,
    occurredAt: input.occurredAt,
    usageIds: [...input.usageIds] as string[],
  };
}

export function isDcpKnowledgeReferences(value: unknown): value is DcpKnowledgeReferences {
  const input = record(value);
  if (
    !input ||
    !exact(input, ["version", "usage", "checkpoints"]) ||
    input.version !== 2 ||
    !Array.isArray(input.usage) ||
    !Array.isArray(input.checkpoints)
  ) return false;
  return input.usage.every((entry) => parseDcpUsageReference(entry) !== undefined) &&
    input.checkpoints.every((entry) => parseDcpCheckpointReference(entry) !== undefined);
}

export function createDcpKnowledgeEvent(input: {
  checkpoint: DcpCheckpointReference;
  usage: readonly DcpUsageReference[];
  sequence: number;
}): Record<string, unknown> | undefined {
  const checkpoint = parseDcpCheckpointReference(input.checkpoint);
  const usage = input.usage.map(parseDcpUsageReference);
  if (!checkpoint || usage.some((entry) => !entry) || !Number.isInteger(input.sequence) || input.sequence < 1) {
    return undefined;
  }
  const byId = new Map((usage as DcpUsageReference[]).map((entry) => [entry.usageId, entry]));
  const usageBindings = checkpoint.usageIds.map((id) => byId.get(id));
  if (usageBindings.some((entry) => !entry)) return undefined;
  return {
    version: 1,
    eventId: checkpoint.eventId,
    sequence: input.sequence,
    occurredAt: checkpoint.occurredAt,
    type: "dcp_checkpointed",
    checkpointId: checkpoint.checkpointId,
    blockId: checkpoint.blockId,
    subjectDigest: checkpoint.subjectDigest,
    usageBindings: usageBindings as DcpUsageReference[],
  };
}

export function appendDcpUsageReference(
  references: DcpKnowledgeReferences,
  usage: DcpUsageReference,
): DcpKnowledgeReferences {
  const parsed = parseDcpUsageReference(usage);
  if (!parsed) throw new Error("Invalid DCP usage reference");
  if (references.usage.some((entry) => entry.usageId === parsed.usageId)) return references;
  return { ...references, version: 2, usage: [...references.usage, parsed] };
}

export function appendDcpCheckpointReference(
  references: DcpKnowledgeReferences,
  input: Omit<DcpCheckpointReference, "version" | "eventId">,
): DcpKnowledgeReferences {
  const checkpoint = parseDcpCheckpointReference({
    version: 1,
    eventId: taggedDigest(input),
    ...input,
  });
  if (!checkpoint) throw new Error("Invalid DCP checkpoint reference");
  if (references.checkpoints.some((entry) => entry.eventId === checkpoint.eventId)) return references;
  return { ...references, version: 2, checkpoints: [...references.checkpoints, checkpoint] };
}

export function attachDcpKnowledgeReferences(
  state: SessionState,
  references: DcpKnowledgeReferences,
): SessionState {
  return { ...state, knowledgeReferences: references };
}
