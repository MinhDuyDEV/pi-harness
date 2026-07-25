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
  // Pi's EventBus owns listener error handling. Do not mark delivery before the
  // bus has dispatched the event: pi-learning's durable idempotency handles repeats.
  void Promise.resolve()
    .then(() => pi.events.emit(event, payload))
    .catch(() => undefined);
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
    for (const [taskId, entry] of pending) {
      if (entry.expiresAt <= now) pending.delete(taskId);
    }
    if (pending.size >= MAX_PENDING_REQUESTS) {
      const oldest = pending.keys().next().value;
      if (typeof oldest === "string") pending.delete(oldest);
    }
    pending.set(request.taskId, { request, expiresAt: now + REQUEST_TTL_MS });
  };

  pi.events.on(SUBAGENT_CONTEXT_REQUEST_EVENT, (payload: unknown) => {
    const request = parseContextRequest(payload);
    if (request) remember(request);
  });

  pi.events.on(SUBAGENT_PROOF_EVENT, (payload: unknown) => {
    const proof = parseProof(payload);
    if (!proof) return;
    const entry = pending.get(proof.taskId);
    pending.delete(proof.taskId);
    if (!entry || entry.expiresAt <= Date.now() || !cwd) return;
    const observation = createObservation(entry.request, proof, cwd);
    if (observation) emitAtLeastOnce(pi, LEARNING_OBSERVATION_EVENT, observation);
  });

  // DCP/TODO/review knowledge-signal relays are intentionally deferred. The
  // current pi-learning package has no bounded consumer for that contract, so
  // this extension does not subscribe and claim an integration with no effect.
}

export * from "./protocol.js";
