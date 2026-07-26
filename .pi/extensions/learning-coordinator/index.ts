import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  LEARNING_OBSERVATION_EVENT,
  SUBAGENT_CONTEXT_REQUEST_EVENT,
  SUBAGENT_PROOF_EVENT,
  parseContextRequest,
  parseProof,
  createObservation,
  type ContextRequestV1,
} from "./protocol.js";

const REQUEST_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_REQUESTS = 128;

interface PendingRequest {
  request: ContextRequestV1;
  expiresAt: number;
}

function emitAtLeastOnce(pi: ExtensionAPI, event: string, payload: unknown): void {
  void Promise.resolve()
    .then(() => pi.events.emit(event, payload))
    .catch(() => undefined);
}

function normalizeContextResponse(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const response = value as Record<string, unknown>;
  if (response.version === 1) return value;
  if (response.protocolVersion !== 1 || !Array.isArray(response.facts)) return value;
  return { version: 1, facts: response.facts };
}

function adaptContextResponse(payload: unknown): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const target = payload as Record<string, unknown>;
  if (target.confidence === undefined) target.confidence = "high";
  let response = normalizeContextResponse(target.response);
  try {
    Object.defineProperty(target, "response", {
      configurable: true,
      enumerable: true,
      get: () => response,
      set: (value: unknown) => {
        response = normalizeContextResponse(value);
      },
    });
  } catch {
    target.response = response;
  }
}

export default function register(pi: ExtensionAPI): void {
  const pending = new Map<string, PendingRequest>();
  let cwd: string | undefined;

  pi.on("session_start", (_event, context) => {
    cwd = context.cwd;
    pending.clear();
  });

  const remember = (request: ContextRequestV1): void => {
    const now = Date.now();
    for (const [correlationId, entry] of pending) {
      if (entry.expiresAt <= now) pending.delete(correlationId);
    }
    if (pending.size >= MAX_PENDING_REQUESTS) {
      const oldest = pending.keys().next().value;
      if (typeof oldest === "string") pending.delete(oldest);
    }
    pending.set(request.correlationId, { request, expiresAt: now + REQUEST_TTL_MS });
  };

  pi.events.on(SUBAGENT_CONTEXT_REQUEST_EVENT, (payload: unknown) => {
    adaptContextResponse(payload);
    const request = parseContextRequest(payload);
    if (request) remember(request);
  });

  pi.events.on(SUBAGENT_PROOF_EVENT, (payload: unknown) => {
    const proof = parseProof(payload);
    if (!proof) return;
    const entry = pending.get(proof.correlationId);
    pending.delete(proof.correlationId);
    if (!entry || entry.expiresAt <= Date.now() || !cwd) return;
    const observation = createObservation(entry.request, proof, cwd);
    if (observation) emitAtLeastOnce(pi, LEARNING_OBSERVATION_EVENT, observation);
  });

}

export * from "./protocol.js";
