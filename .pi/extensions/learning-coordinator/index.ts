import { join } from "node:path";
import { assertPiCoreProtocolVersion } from "@minhduydev/pi-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { EventBusPort } from "./delivery.js";
import { replayPortToSink } from "./public-replay.js";
import { loadProducerReplayPorts } from "./source-ports.js";
import {
  CONTEXT_SERVED_EVENT,
  LEARNING_OBSERVATION_EVENT,
  SUBAGENT_CONTEXT_REQUEST_EVENT,
  SUBAGENT_PROOF_EVENT,
  parseContextRequest,
  parseContextServed,
  parseProof,
  createObservations,
  type ContextBindingV1,
  type ContextRequestV1,
} from "./protocol.js";

const REQUEST_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_REQUESTS = 128;

interface PendingRequest {
  request: ContextRequestV1;
  /** Set when pi-learning announces the served binding for this request. */
  binding?: ContextBindingV1;
  expiresAt: number;
}

function emitAtLeastOnce(pi: ExtensionAPI, event: string, payload: unknown): void {
  void Promise.resolve()
    .then(() => pi.events.emit(event, payload))
    .catch(() => undefined);
}

export default function register(pi: ExtensionAPI): void {
  // Two pi-core copies with different canonicalization rules would recreate
  // the digest divergence the shared package exists to end.
  assertPiCoreProtocolVersion(1);
  const pending = new Map<string, PendingRequest>();
  const bus: EventBusPort = {
    on(event, handler) {
      return pi.events.on(event, handler);
    },
    emit(event, payload) {
      pi.events.emit(event, payload);
    },
  };
  let cwd: string | undefined;
  let ports = Promise.resolve([] as Awaited<ReturnType<typeof loadProducerReplayPorts>>);
  let replayChain = Promise.resolve();
  let replayFailed = false;
  const scheduleReplay = (): void => {
    const projectDirectory = cwd;
    if (!projectDirectory) return;
    replayChain = replayChain.then(async () => {
      for (const source of await ports) {
        await replayPortToSink({
          producer: source.producer,
          port: source.port,
          bus,
          cursorPath: join(
            projectDirectory,
            ".pi",
            "artifacts",
            "learning-coordinator",
            "cursors",
            `${source.producer}.json`,
          ),
          timeoutMs: 2_000,
          retries: 2,
        });
      }
    }).catch(() => {
      replayFailed = true;
    });
  };

  pi.on("session_start", (_event, context) => {
    cwd = context.cwd;
    ports = loadProducerReplayPorts(context.cwd);
    pending.clear();
    scheduleReplay();
    if (replayFailed) {
      context.ui.notify(
        "Durable learning-signal replay is paused; source cursors were not advanced.",
        "warning",
      );
      replayFailed = false;
    }
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

  // The old flow re-parsed the SAME payload inside a queueMicrotask, hoping
  // pi-learning's listener had mutated identity fields into it by then — a
  // dependency on listener ordering nobody declared. The request is now
  // remembered as the producer signed it, and the binding arrives on
  // pi-learning's own event below.
  pi.events.on(SUBAGENT_CONTEXT_REQUEST_EVENT, (payload: unknown) => {
    const request = parseContextRequest(payload);
    if (request) remember(request);
  });

  pi.events.on(CONTEXT_SERVED_EVENT, (payload: unknown) => {
    const served = parseContextServed(payload);
    if (!served) return;
    const entry = pending.get(served.correlationId);
    if (!entry || entry.request.requestDigest !== served.requestDigest) return;
    entry.binding = {
      projectId: served.projectId,
      trustEpoch: served.trustEpoch,
      sessionGeneration: served.sessionGeneration,
    };
  });

  pi.events.on(SUBAGENT_PROOF_EVENT, (payload: unknown) => {
    const proof = parseProof(payload);
    if (!proof) return;
    const entry = pending.get(proof.correlationId);
    pending.delete(proof.correlationId);
    if (!entry || entry.expiresAt <= Date.now() || !cwd) return;
    // No binding means pi-learning never served this request (absent or
    // untrusted project) — there is no identity to write observations under.
    if (!entry.binding) return;
    for (const observation of createObservations(entry.request, proof, entry.binding, cwd)) {
      emitAtLeastOnce(pi, LEARNING_OBSERVATION_EVENT, observation);
    }
    scheduleReplay();
  });

  pi.on("turn_end", scheduleReplay);
}

export * from "./protocol.js";
