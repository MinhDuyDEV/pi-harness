import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createObservation,
  DCP_TELEMETRY_EVENT,
  digest,
  KNOWLEDGE_SIGNAL_EVENT,
  LEARNING_OBSERVATION_EVENT,
  parseContextRequest,
  parseProof,
  SUBAGENT_CONTEXT_REQUEST_EVENT,
  SUBAGENT_PROOF_EVENT,
  SUBAGENT_REVIEW_EVENT,
  TODO_ITEM_EVENT,
  TODO_PHASE_EVENT,
  type ContextRequestV1,
  type KnowledgeSignalV1,
} from "./protocol.js";

const MAX_CACHE = 512;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function bounded(value: unknown, max = 200): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_CACHE) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function signalFromEvent(type: KnowledgeSignalV1["type"], source: string, payload: unknown): KnowledgeSignalV1 | undefined {
  const input = object(payload);
  if (!input) return undefined;
  const sourceKey = bounded(input.idempotencyKey) ?? bounded(input.eventId) ?? bounded(input.timestamp) ?? bounded(input.occurredAt);
  if (!sourceKey) return undefined;
  const references = [input.todoRef, input.docDigest, input.subjectDigest, input.taskId]
    .map((value) => bounded(value))
    .filter((value): value is string => value !== undefined)
    .slice(0, 8);
  return {
    schema: "pi-harness.knowledge-signal/v1",
    type,
    idempotencyKey: digest(`${source}\0${type}\0${sourceKey}`),
    occurredAt: bounded(input.timestamp, 40) ?? bounded(input.occurredAt, 40) ?? new Date().toISOString(),
    source,
    references,
  };
}

export default function learningCoordinator(pi: ExtensionAPI): void {
  const requests = new Map<string, ContextRequestV1>();
  const delivered = new Map<string, true>();
  let cwd: string | undefined;

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
    requests.clear();
    delivered.clear();
  });

  pi.events.on(SUBAGENT_CONTEXT_REQUEST_EVENT, (payload: unknown) => {
    const request = parseContextRequest(payload);
    if (request) remember(requests, request.taskId, request);
  });

  pi.events.on(SUBAGENT_PROOF_EVENT, (payload: unknown) => {
    const proof = parseProof(payload);
    if (!proof || !cwd) return;
    const request = requests.get(proof.taskId);
    if (!request) return;
    const observation = createObservation(request, proof, cwd);
    if (!observation || delivered.has(observation.idempotencyKey)) return;
    remember(delivered, observation.idempotencyKey, true);
    try {
      pi.events.emit(LEARNING_OBSERVATION_EVENT, observation);
    } catch {
      delivered.delete(observation.idempotencyKey);
    }
  });

  const relay = (type: KnowledgeSignalV1["type"], source: string, payload: unknown): void => {
    const signal = signalFromEvent(type, source, payload);
    if (!signal || delivered.has(signal.idempotencyKey)) return;
    remember(delivered, signal.idempotencyKey, true);
    try {
      pi.events.emit(KNOWLEDGE_SIGNAL_EVENT, signal);
    } catch {
      delivered.delete(signal.idempotencyKey);
    }
  };

  pi.events.on(TODO_ITEM_EVENT, (payload: unknown) => relay("todo-item-completed", TODO_ITEM_EVENT, payload));
  pi.events.on(TODO_PHASE_EVENT, (payload: unknown) => relay("todo-phase-closed", TODO_PHASE_EVENT, payload));
  pi.events.on(DCP_TELEMETRY_EVENT, (payload: unknown) => {
    const input = object(payload);
    if (input?.type === "compaction_completed") relay("dcp-compaction", DCP_TELEMETRY_EVENT, payload);
  });
  pi.events.on(SUBAGENT_REVIEW_EVENT, (payload: unknown) => relay("review-completed", SUBAGENT_REVIEW_EVENT, payload));
}

export * from "./protocol.js";
