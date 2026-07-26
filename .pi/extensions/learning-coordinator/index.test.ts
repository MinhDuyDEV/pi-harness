import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  bindingDigestFor,
  makeContextRequestPayload,
  makeLearningClaim,
  makeProofVerifiedPayload,
  taggedDigest,
} from "@minhduydev/pi-core";
import register, {
  CONTEXT_SERVED_EVENT,
  LEARNING_OBSERVATION_EVENT,
  SUBAGENT_CONTEXT_REQUEST_EVENT,
  SUBAGENT_PROOF_EVENT,
  createObservation,
  parseProof,
  type ContextBindingV1,
} from "./index.js";

interface Listener {
  (payload: unknown): void | Promise<void>;
}

class HarnessEventBus {
  readonly listeners = new Map<string, Listener[]>();
  readonly emitted: Array<{ event: string; payload: unknown }> = [];

  on(event: string, listener: Listener): () => void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return () => {
      const current = this.listeners.get(event) ?? [];
      const index = current.indexOf(listener);
      if (index >= 0) current.splice(index, 1);
    };
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

// Fixtures come from pi-core's REAL constructors — hand-rolled payloads with a
// reimplemented digest are how this suite previously passed against payloads
// no producer would ever emit (§2.2).
const EVIDENCE_DIGEST = taggedDigest({ evidence: "index-test" });
const claim = makeLearningClaim({
  version: 1,
  kind: "pattern",
  statement: "Run the verified migration procedure before deployment",
  applicability: "Migration changes",
  support: {
    mode: "task-outcome",
    evidenceRefs: [{ kind: "evidence-receipt", ref: "receipt-1", digest: EVIDENCE_DIGEST }],
  },
});

const binding: ContextBindingV1 = {
  projectId: "project-1",
  trustEpoch: "trust-1",
  sessionGeneration: "session-1",
};

const request = makeContextRequestPayload(
  "task-42",
  "general",
  "Use the verified migration procedure",
  "task-42",
  [claim],
);

function servedFor(target: typeof request) {
  return {
    version: 1,
    taskId: target.taskId,
    correlationId: target.correlationId,
    requestDigest: target.requestDigest,
    ...binding,
    bindingDigest: bindingDigestFor({ requestDigest: target.requestDigest, ...binding }),
  };
}

const proof = makeProofVerifiedPayload({
  taskId: "task-42",
  verificationPassed: true,
  issues: [],
  evidenceDigests: ["a".repeat(64)],
  correlationId: "task-42",
  requestDigest: request.requestDigest,
  ...binding,
  supportedClaims: [
    { claimId: claim.claimId, supported: true, evidenceDigests: [EVIDENCE_DIGEST] },
  ],
  timestamp: "2026-01-02T03:04:05.000Z",
});

test("emits a supported explicit claim instead of the task description", async () => {
  const bus = new HarnessEventBus();
  let contextListenerRan = false;
  bus.on(SUBAGENT_CONTEXT_REQUEST_EVENT, async (payload) => {
    contextListenerRan = true;
    assert.equal((payload as { taskId: string }).taskId, request.taskId);
  });
  install(bus);

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request);
  await bus.emit(CONTEXT_SERVED_EVENT, servedFor(request));
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
  assert.equal(observation.projectKey, binding.projectId);
});

test("no observation without pi-learning's served binding", async () => {
  // The binding arrives on pi-learning's own event now. A proof for a request
  // that was never served (untrusted project, pi-learning absent) has no
  // identity to write observations under — silence is the contract, but it is
  // an EXPLICIT one here rather than a listener-order accident.
  const bus = new HarnessEventBus();
  install(bus);

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request);
  await bus.emit(SUBAGENT_PROOF_EVENT, proof);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(bus.emitted.filter(({ event }) => event === LEARNING_OBSERVATION_EVENT).length, 0);
});

test("a forged served binding does not attach", async () => {
  const bus = new HarnessEventBus();
  install(bus);

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request);
  await bus.emit(CONTEXT_SERVED_EVENT, {
    ...servedFor(request),
    trustEpoch: "trust-FORGED",
  });
  await bus.emit(SUBAGENT_PROOF_EVENT, proof);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(bus.emitted.filter(({ event }) => event === LEARNING_OBSERVATION_EVENT).length, 0);
});

test("does not learn a task description without an explicit claim", async () => {
  const bus = new HarnessEventBus();
  install(bus);
  const requestWithoutClaim = makeContextRequestPayload(
    "task-without-claim",
    "general",
    "Delete generated files",
    "correlation-without-claim",
    [],
  );
  const proofWithoutClaim = makeProofVerifiedPayload({
    taskId: "task-without-claim",
    verificationPassed: true,
    issues: [],
    evidenceDigests: ["a".repeat(64)],
    correlationId: "correlation-without-claim",
    requestDigest: requestWithoutClaim.requestDigest,
    ...binding,
    supportedClaims: [],
    timestamp: proof.timestamp,
  });

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, requestWithoutClaim);
  await bus.emit(CONTEXT_SERVED_EVENT, servedFor(requestWithoutClaim));
  await bus.emit(SUBAGENT_PROOF_EVENT, proofWithoutClaim);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(bus.emitted.filter(({ event }) => event === LEARNING_OBSERVATION_EVENT).length, 0);
});

test("correlates context and proof by stable correlationId when task IDs differ", async () => {
  const bus = new HarnessEventBus();
  install(bus);
  const correlatedRequest = makeContextRequestPayload(
    "invocation-42",
    "general",
    request.description,
    "correlation-42",
    [claim],
  );
  const correlatedProof = makeProofVerifiedPayload({
    taskId: "canonical-task-42",
    verificationPassed: true,
    issues: [],
    evidenceDigests: ["a".repeat(64)],
    correlationId: "correlation-42",
    requestDigest: correlatedRequest.requestDigest,
    ...binding,
    supportedClaims: [
      { claimId: claim.claimId, supported: true, evidenceDigests: [EVIDENCE_DIGEST] },
    ],
    timestamp: proof.timestamp,
  });

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, correlatedRequest);
  await bus.emit(CONTEXT_SERVED_EVENT, servedFor(correlatedRequest));
  await bus.emit(SUBAGENT_PROOF_EVENT, correlatedProof);
  await new Promise<void>((resolve) => setImmediate(resolve));

  const observations = bus.emitted.filter(({ event }) => event === LEARNING_OBSERVATION_EVENT);
  assert.equal(observations.length, 1);
});

test("uses at-least-once emission instead of a delivered-before-ack dedupe", async () => {
  const bus = new HarnessEventBus();
  install(bus);

  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request);
  await bus.emit(CONTEXT_SERVED_EVENT, servedFor(request));
  await bus.emit(SUBAGENT_PROOF_EVENT, proof);
  await bus.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request);
  await bus.emit(CONTEXT_SERVED_EVENT, servedFor(request));
  await bus.emit(SUBAGENT_PROOF_EVENT, proof);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(bus.emitted.filter(({ event }) => event === LEARNING_OBSERVATION_EVENT).length, 2);
});

test("rejects malformed proof data and unsafe explicit claims", () => {
  assert.equal(parseProof({ ...proof, timestamp: 1700000000000 }), undefined);
  const unsafeClaim = {
    ...claim,
    statement: `Use token ghp_${"A".repeat(36)} during migration`,
  };
  assert.equal(createObservation(
    { ...request, learningClaims: [unsafeClaim] },
    proof,
    binding,
    "/tmp/project",
  ), undefined);
});
