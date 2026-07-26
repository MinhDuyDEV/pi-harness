import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { EventBusPort } from "./delivery.js";
import { replayPortToSink } from "./public-replay.js";
import { loadProducerReplayPorts } from "./source-ports.js";
import {
  LEARNING_OBSERVATION_EVENT,
  SUBAGENT_CONTEXT_REQUEST_EVENT,
  SUBAGENT_PROOF_EVENT,
  parseContextRequest,
  parseProof,
  createObservations,
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

  pi.events.on(SUBAGENT_CONTEXT_REQUEST_EVENT, (payload: unknown) => {
    adaptContextResponse(payload);
    const request = parseContextRequest(payload);
    if (request?.projectId && request.trustEpoch && request.sessionGeneration) {
      remember(request);
      return;
    }
    queueMicrotask(() => {
      const enriched = parseContextRequest(payload);
      if (enriched?.projectId && enriched.trustEpoch && enriched.sessionGeneration) {
        remember(enriched);
      }
    });
  });

  pi.events.on(SUBAGENT_PROOF_EVENT, (payload: unknown) => {
    const proof = parseProof(payload);
    if (!proof) return;
    const entry = pending.get(proof.correlationId);
    pending.delete(proof.correlationId);
    if (!entry || entry.expiresAt <= Date.now() || !cwd) return;
    for (const observation of createObservations(entry.request, proof, cwd)) {
      emitAtLeastOnce(pi, LEARNING_OBSERVATION_EVENT, observation);
    }
    scheduleReplay();
  });

  pi.on("turn_end", scheduleReplay);
}

export * from "./protocol.js";
