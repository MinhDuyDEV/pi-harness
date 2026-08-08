import { taggedDigest } from "@minhduydev/pi-core";
import type { KnowledgeSignalV1, UsageBindingV1 } from "./delivery.js";

type SourceProducer = "pi-subagents" | "pi-todo" | "dcp";
type Outcome = KnowledgeSignalV1["outcome"];
type SubjectKind = KnowledgeSignalV1["subject"]["kind"];

const TAGGED_DIGEST = /^sha256:v1:[0-9a-f]{64}$/;
const LEGACY_ORCHESTRATION_DIGEST = /^sha256:([0-9a-f]{64})$/;

function normalizeOrchestrationDigest(value: unknown): string | undefined {
  const digest = String(value);
  if (TAGGED_DIGEST.test(digest)) return digest;
  const legacy = LEGACY_ORCHESTRATION_DIGEST.exec(digest);
  return legacy ? `sha256:v1:${legacy[1]}` : undefined;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function bounded(value: unknown, maximum = 200): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}

// The digest and its canonicalization come from @minhduydev/pi-core —
// this file carried one of the audit's nine independent copies (§2.2).

interface ParsedUsageReceipt {
  binding: UsageBindingV1;
  projectId: string;
  trustEpoch: string;
  sessionGeneration: string;
}

function parseUsageReceipt(value: unknown): ParsedUsageReceipt | undefined {
  const input = record(value);
  if (
    !input ||
    Object.keys(input).some((key) => ![
      "version", "usageId", "projectId", "trustEpoch", "sessionGeneration", "consumer",
      "correlationId", "requestDigest", "queryDigest", "learningId", "learningRevision",
      "learningDigest", "returnedAt",
    ].includes(key)) ||
    input.version !== 1 ||
    !Number.isInteger(input.learningRevision) ||
    Number(input.learningRevision) < 1 ||
    !TAGGED_DIGEST.test(String(input.requestDigest)) ||
    !TAGGED_DIGEST.test(String(input.queryDigest)) ||
    !TAGGED_DIGEST.test(String(input.learningDigest)) ||
    !Number.isFinite(Date.parse(String(input.returnedAt)))
  ) return undefined;
  const consumer = record(input.consumer);
  if (
    !consumer ||
    Object.keys(consumer).some((key) => !["kind", "id"].includes(key)) ||
    (consumer.kind !== "parent-turn" && consumer.kind !== "subagent")
  ) return undefined;
  const usageId = bounded(input.usageId);
  const projectId = bounded(input.projectId);
  const trustEpoch = bounded(input.trustEpoch);
  const sessionGeneration = bounded(input.sessionGeneration);
  const consumerId = bounded(consumer.id);
  const correlationId = bounded(input.correlationId);
  const learningId = bounded(input.learningId);
  if (!usageId || !projectId || !trustEpoch || !sessionGeneration || !consumerId || !correlationId || !learningId) return undefined;
  return {
    projectId,
    trustEpoch,
    sessionGeneration,
    binding: {
      usageId,
      consumer: { kind: consumer.kind, id: consumerId },
      correlationId,
      requestDigest: String(input.requestDigest),
      learningId,
      learningRevision: Number(input.learningRevision),
      learningDigest: String(input.learningDigest),
    },
  };
}

function eventIdentity(event: Record<string, unknown>): string | undefined {
  return bounded(event.id ?? event.eventId ?? event.transitionId, 240);
}

function eventTimestamp(event: Record<string, unknown>): string | undefined {
  const timestamp = bounded(event.timestamp ?? event.occurredAt ?? event.committedAt, 80);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined;
}

function eventSequence(event: Record<string, unknown>): number | undefined {
  return Number.isInteger(event.sequence) && Number(event.sequence) > 0
    ? Number(event.sequence)
    : undefined;
}

function classify(producer: SourceProducer, event: Record<string, unknown>): {
  subjectKind: SubjectKind;
  subjectDigest: string;
  outcome: Outcome;
} | undefined {
  const type = bounded(event.type ?? event.kind, 100);
  if (!type) return undefined;
  if (producer === "pi-subagents") {
    if (type !== "review_completed" && type !== "task_reviewed") return undefined;
    const status = bounded(type === "task_reviewed" ? event.verdict : event.reviewStatus, 40);
    if (!status) return undefined;
    const immutableSubjectDigest = normalizeOrchestrationDigest(event.subjectDigest);
    const reviewerOutputDigest = normalizeOrchestrationDigest(event.reviewerOutputDigest);
    if (type === "task_reviewed" && (!immutableSubjectDigest || !reviewerOutputDigest)) {
      return undefined;
    }
    return {
      subjectKind: "review",
      subjectDigest: immutableSubjectDigest
        ?? taggedDigest({ eventId: eventIdentity(event), reviewStatus: status }),
      outcome: status === "approved" || status === "accepted"
        ? "passed"
        : status === "changes_requested"
          ? "changes-requested"
          : "failed",
    };
  }
  if (producer === "pi-todo") {
    const phase = type.includes("phase");
    const subjectDigest = TAGGED_DIGEST.test(String(event.subjectDigest))
      ? String(event.subjectDigest)
      : taggedDigest({ eventId: eventIdentity(event), completionEpoch: event.completionEpoch });
    return {
      subjectKind: phase ? "todo-phase" : "todo-item",
      subjectDigest,
      outcome: "completed",
    };
  }
  const subjectDigest = TAGGED_DIGEST.test(String(event.subjectDigest))
    ? String(event.subjectDigest)
    : taggedDigest({ eventId: eventIdentity(event), checkpointDigest: event.checkpointDigest });
  return { subjectKind: "dcp-checkpoint", subjectDigest, outcome: "checkpointed" };
}

export function buildSignalsFromProducerEvent(
  producer: SourceProducer,
  value: unknown,
): KnowledgeSignalV1[] {
  const event = record(value);
  if (!event || !Array.isArray(event.usageBindings)) return [];
  const id = eventIdentity(event);
  const sequence = eventSequence(event);
  const occurredAt = eventTimestamp(event);
  const classification = classify(producer, event);
  if (!id || sequence === undefined || !occurredAt || !classification) return [];
  return event.usageBindings.flatMap((value) => {
    const usage = parseUsageReceipt(value);
    if (!usage) return [];
    return [{
      version: 1,
      producer: producer === "pi-subagents" ? "pi-subagents-review" : producer,
      streamId: `${producer === "pi-subagents" ? "pi-subagents-review" : producer}:${usage.projectId}:${usage.trustEpoch}`,
      sequence,
      eventId: id,
      idempotencyKey: `${producer}:${id}:${usage.binding.usageId}`,
      occurredAt,
      projectId: usage.projectId,
      trustEpoch: usage.trustEpoch,
      sessionGeneration: usage.sessionGeneration,
      usage: usage.binding,
      subject: {
        kind: classification.subjectKind,
        digest: classification.subjectDigest,
      },
      outcome: classification.outcome,
    } satisfies KnowledgeSignalV1];
  });
}
