import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildCompactionCompletedEvent,
  DCP_TELEMETRY_EVENT,
} from "../dcp/telemetry.js";
import register, {
  LEARNING_OBSERVATION_EVENT,
  SUBAGENT_CONTEXT_REQUEST_EVENT,
  SUBAGENT_PROOF_EVENT,
  createObservation,
  knowledgeSignalFromEvent,
  parseProof,
  stableEventIdentity,
} from "./index.js";

interface Listener {
  (payload: unknown): void | Promise<void>;
}

class HarnessEventBus {
  readonly listeners = new Map<string, Listener[]>();
  readonly emitted: Array<{ event: string; payload: unknown }> = [];

  on(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  async emit(event: string, payload: unknown): Promise<void> {
    this.emitted.push({ event, payload });
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        await listener(payload);
      } catch {
        // Model Pi EventBus: one async listener failure does not reject the bus.
      }
    }
  }
}

function install(bus: HarnessEventBus): void {
  register({
    events: bus,
    on(name: string, handler: (event: unknown, context: { cwd: string }) => void) {
      if (name === "session_start") handler({}, { cwd: "/tmp/project" });
    },
  } as unknown as ExtensionAPI);
}

const request = {
  protocolVersion: 1,
  taskId: "task-42",
  agentType: "general",
  description: "Use the verified migration procedure",
} as const;

const proof = {
  protocolVersion: 1,
  taskId: "task-42",
  verificationPassed: true,
  verificationIssues: [],
  evidenceDigests: ["a".repeat(64)],
  timestamp: "2026-01-02T03:04:05.000Z",
} as const;

test("correlates a context request with proof and emits the v1 learning schema", async () => {
  const bus = new HarnessEventBus();
  let contextListenerRan = false;
  bus.on(SUBAGENT_CONTEXT_REQUEST_EVENT, async (payload) => {
    contextListenerRan = true;
    assert.equal((payload as { taskId: string }).taskId, request.taskId);
  });
  install(bus);

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request);
  await bus.emit(SUBAGENT_PROOF_EVENT, proof);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(contextListenerRan, true);
  const observations = bus.emitted.filter(({ event }) => event === LEARNING_OBSERVATION_EVENT);
  assert.equal(observations.length, 1);
  const observation = observations[0]?.payload as Record<string, unknown>;
  assert.equal(observation.protocolVersion, 1);
  assert.equal(observation.confidence, "high");
  assert.match(observation.digest as string, /^[a-f0-9]{64}$/);
  assert.equal(observation.idempotencyKey, observation.digest);
  assert.equal(observation.timestamp, Date.parse(proof.timestamp));
});

test("uses at-least-once emission instead of a delivered-before-ack dedupe", async () => {
  const bus = new HarnessEventBus();
  install(bus);

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request);
  await bus.emit(SUBAGENT_PROOF_EVENT, proof);
  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request);
  await bus.emit(SUBAGENT_PROOF_EVENT, proof);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(bus.emitted.filter(({ event }) => event === LEARNING_OBSERVATION_EVENT).length, 2);
});

test("does not register knowledge relays without a pi-learning consumer", () => {
  const bus = new HarnessEventBus();
  install(bus);
  assert.deepEqual([...bus.listeners.keys()].sort(), [SUBAGENT_CONTEXT_REQUEST_EVENT, SUBAGENT_PROOF_EVENT].sort());
  assert.equal(DCP_TELEMETRY_EVENT, "dcp:telemetry");
});

test("uses the real numeric DCP timestamp and bounded stable identity", () => {
  const event = buildCompactionCompletedEvent({
    blockCount: 3,
    artifactCount: 2,
    deterministic: true,
    reason: "threshold",
    willRetry: false,
  });
  assert.equal(typeof event.timestamp, "number");
  const first = stableEventIdentity("dcp", event);
  const second = stableEventIdentity("dcp", { ...event });
  assert.match(first ?? "", /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.equal(knowledgeSignalFromEvent("dcp-compaction", "dcp", event)?.idempotencyKey, first);
});

test("rejects malformed proof data and redacts secrets before emission", () => {
  assert.equal(parseProof({ ...proof, timestamp: 1700000000000 }), undefined);
  assert.equal(parseProof({ ...proof, evidenceDigests: ["not-a-digest"] }), undefined);
  const observation = createObservation(
    { ...request, description: "password=super-secret" },
    proof,
    "/tmp/project",
  );
  assert.ok(observation);
  assert.equal(observation.content.includes("super-secret"), false);
  assert.equal(observation.content.includes("[REDACTED]"), true);
});
