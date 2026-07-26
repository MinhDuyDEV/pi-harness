import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import register, {
  LEARNING_OBSERVATION_EVENT,
  SUBAGENT_CONTEXT_REQUEST_EVENT,
  SUBAGENT_PROOF_EVENT,
  createObservation,
  parseProof,
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

const TAGGED_DIGEST = `sha256:v1:${"a".repeat(64)}`;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(input).sort().map((key) => [key, canonical(input[key])]),
  );
}

function taggedDigest(value: unknown): string {
  return `sha256:v1:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}

const claimBody = {
  version: 1 as const,
  kind: "pattern" as const,
  statement: "Run the verified migration procedure before deployment",
  applicability: "Migration changes",
  support: {
    mode: "task-outcome" as const,
    evidenceRefs: [{
      kind: "evidence-receipt" as const,
      ref: "receipt-1",
      digest: TAGGED_DIGEST,
    }],
  },
};
const claim = { ...claimBody, claimId: taggedDigest(claimBody) };
const requestBody = {
  taskId: "task-42",
  correlationId: "task-42",
  projectId: "project-1",
  trustEpoch: "trust-1",
  sessionGeneration: "session-1",
  agentType: "general",
  description: "Use the verified migration procedure",
  learningClaims: [claim],
};
const request = {
  protocolVersion: 1 as const,
  ...requestBody,
  requestDigest: taggedDigest(requestBody),
};

const proof = {
  protocolVersion: 1,
  taskId: "task-42",
  correlationId: "task-42",
  requestDigest: request.requestDigest,
  projectId: request.projectId,
  trustEpoch: request.trustEpoch,
  sessionGeneration: request.sessionGeneration,
  verificationPassed: true,
  verificationIssues: [],
  evidenceDigests: ["a".repeat(64)],
  supportedClaims: [{
    claimId: claim.claimId,
    supported: true,
    evidenceDigests: [TAGGED_DIGEST],
  }],
  timestamp: "2026-01-02T03:04:05.000Z",
} as const;

test("emits a supported explicit claim instead of the task description", async () => {
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
  assert.equal(observation.protocolVersion, undefined);
  assert.equal(observation.confidence, undefined);
  assert.equal(observation.digest, undefined);
  assert.match(observation.idempotencyKey as string, /^[a-f0-9]{64}$/);
  assert.equal(observation.timestamp, Date.parse(proof.timestamp));
  assert.equal(observation.content, claim.statement);
  assert.notEqual(observation.content, request.description);
});

test("does not learn a task description without an explicit claim", async () => {
  const bus = new HarnessEventBus();
  install(bus);
  const requestWithoutClaim = {
    protocolVersion: 1,
    taskId: "task-without-claim",
    correlationId: "correlation-without-claim",
    agentType: "general",
    description: "Delete generated files",
    requestDigest: `sha256:v1:${"d".repeat(64)}`,
    learningClaims: [],
  };
  const proofWithoutClaim = {
    ...proof,
    taskId: "task-without-claim",
    correlationId: "correlation-without-claim",
    requestDigest: requestWithoutClaim.requestDigest,
    supportedClaims: [],
  };

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, requestWithoutClaim);
  await bus.emit(SUBAGENT_PROOF_EVENT, proofWithoutClaim);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(bus.emitted.filter(({ event }) => event === LEARNING_OBSERVATION_EVENT).length, 0);
});

test("correlates context and proof by stable correlationId when task IDs differ", async () => {
  const bus = new HarnessEventBus();
  install(bus);
  const correlatedRequestBody = {
    taskId: "invocation-42",
    correlationId: "correlation-42",
    projectId: request.projectId,
    trustEpoch: request.trustEpoch,
    sessionGeneration: request.sessionGeneration,
    agentType: request.agentType,
    description: request.description,
    learningClaims: request.learningClaims,
  };
  const correlatedRequest = {
    protocolVersion: 1 as const,
    ...correlatedRequestBody,
    requestDigest: taggedDigest(correlatedRequestBody),
  };
  const correlatedProof = {
    ...proof,
    taskId: "canonical-task-42",
    correlationId: "correlation-42",
    requestDigest: correlatedRequest.requestDigest,
  };

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, correlatedRequest);
  await bus.emit(SUBAGENT_PROOF_EVENT, correlatedProof);
  await new Promise<void>((resolve) => setImmediate(resolve));

  const observations = bus.emitted.filter(({ event }) => event === LEARNING_OBSERVATION_EVENT);
  assert.equal(observations.length, 1);
});

test("normalizes pi-learning context responses to the subagent v1 schema", async () => {
  const bus = new HarnessEventBus();
  install(bus);
  bus.on(SUBAGENT_CONTEXT_REQUEST_EVENT, (payload) => {
    (payload as { response?: unknown }).response = {
      protocolVersion: 1,
      facts: [{
        domain: "testing",
        summary: "Run focused tests first",
        confidence: "high",
        evidenceDigest: "a".repeat(64),
      }],
    };
  });
  const payload: Record<string, unknown> = { ...request };

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, payload);

  assert.deepEqual(payload.response, {
    version: 1,
    facts: [{
      domain: "testing",
      summary: "Run focused tests first",
      confidence: "high",
      evidenceDigest: "a".repeat(64),
    }],
  });
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

test("rejects malformed proof data and unsafe explicit claims", () => {
  assert.equal(parseProof({ ...proof, timestamp: 1700000000000 }), undefined);
  assert.equal(parseProof({ ...proof, evidenceDigests: ["not-a-digest"] }), undefined);
  const unsafeClaim = {
    ...claim,
    statement: `Use token ghp_${"A".repeat(36)} during migration`,
  };
  assert.equal(createObservation(
    { ...request, learningClaims: [unsafeClaim] },
    proof,
    "/tmp/project",
  ), undefined);
});
