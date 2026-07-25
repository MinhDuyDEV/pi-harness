import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import learningCoordinator from "./index.js";
import {
  DCP_TELEMETRY_EVENT,
  KNOWLEDGE_SIGNAL_EVENT,
  LEARNING_OBSERVATION_EVENT,
  SUBAGENT_CONTEXT_REQUEST_EVENT,
  SUBAGENT_PROOF_EVENT,
  SUBAGENT_REVIEW_EVENT,
  TODO_ITEM_EVENT,
  TODO_PHASE_EVENT,
  createObservation,
  parseContextRequest,
  parseProof,
} from "./protocol.js";

interface Harness {
  pi: ExtensionAPI;
  hook(name: string): (event: unknown, ctx: { cwd: string }) => unknown;
  emit(name: string, payload: unknown): void;
  emitted: Array<{ name: string; payload: unknown }>;
  throwOn: Set<string>;
}

function harness(): Harness {
  const hooks = new Map<string, (event: unknown, ctx: { cwd: string }) => unknown>();
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const throwOn = new Set<string>();
  const pi = {
    on: (name: string, handler: (event: unknown, ctx: { cwd: string }) => unknown) => hooks.set(name, handler),
    events: {
      on: (name: string, handler: (payload: unknown) => void) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
      emit: (name: string, payload: unknown) => {
        if (throwOn.has(name)) throw new Error("listener failed");
        emitted.push({ name, payload });
        for (const listener of listeners.get(name) ?? []) listener(payload);
      },
    },
  } as unknown as ExtensionAPI;
  return {
    pi,
    hook: (name) => {
      const handler = hooks.get(name);
      assert.ok(handler);
      return handler;
    },
    emit: (name, payload) => {
      for (const listener of listeners.get(name) ?? []) listener(payload);
    },
    emitted,
    throwOn,
  };
}

const DIGEST = "a".repeat(64);

function request(description = "Run the focused coordinator test before the full suite") {
  return { protocolVersion: 1, taskId: "task-1", agentType: "reviewer", description };
}

function proof(verificationPassed = true) {
  return {
    protocolVersion: 1,
    taskId: "task-1",
    verificationPassed,
    verificationIssues: verificationPassed ? [] : ["failed"],
    evidenceDigests: [DIGEST],
    timestamp: "2026-07-25T00:00:00.000Z",
  };
}

test("parses bounded context and proof payloads", () => {
  assert.equal(parseContextRequest(request())?.taskId, "task-1");
  assert.equal(parseContextRequest(request("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij")), undefined);
  assert.deepEqual(parseProof(proof())?.evidenceDigests, [DIGEST]);
  assert.equal(parseProof({ ...proof(), evidenceDigests: ["invalid"] })?.evidenceDigests.length, 0);
});

test("creates an observation only from passed proof with evidence", () => {
  const context = parseContextRequest(request());
  const passed = parseProof(proof());
  const failed = parseProof(proof(false));
  assert.ok(context && passed && failed);
  const observation = createObservation(context, passed, "/repo");
  assert.equal(observation?.source, "pi-subagents:proof-verified");
  assert.equal(observation?.evidenceRefs[0]?.digest, DIGEST);
  assert.equal(createObservation(context, failed, "/repo"), undefined);
});

test("correlates context with proof and suppresses duplicate delivery", () => {
  const h = harness();
  learningCoordinator(h.pi);
  h.hook("session_start")({}, { cwd: "/repo" });
  h.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request());
  h.emit(SUBAGENT_PROOF_EVENT, proof());
  h.emit(SUBAGENT_PROOF_EVENT, proof());
  const observations = h.emitted.filter((event) => event.name === LEARNING_OBSERVATION_EVENT);
  assert.equal(observations.length, 1);
});

test("does not turn failed proof or missing context into learning", () => {
  const h = harness();
  learningCoordinator(h.pi);
  h.hook("session_start")({}, { cwd: "/repo" });
  h.emit(SUBAGENT_PROOF_EVENT, proof());
  h.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request());
  h.emit(SUBAGENT_PROOF_EVENT, proof(false));
  assert.equal(h.emitted.some((event) => event.name === LEARNING_OBSERVATION_EVENT), false);
});

test("retries delivery after a throwing listener", () => {
  const h = harness();
  learningCoordinator(h.pi);
  h.hook("session_start")({}, { cwd: "/repo" });
  h.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request());
  h.throwOn.add(LEARNING_OBSERVATION_EVENT);
  h.emit(SUBAGENT_PROOF_EVENT, proof());
  h.throwOn.delete(LEARNING_OBSERVATION_EVENT);
  h.emit(SUBAGENT_PROOF_EVENT, proof());
  assert.equal(h.emitted.filter((event) => event.name === LEARNING_OBSERVATION_EVENT).length, 1);
});

test("relays todo, DCP, and review metadata as non-proof signals", () => {
  const h = harness();
  learningCoordinator(h.pi);
  h.hook("session_start")({}, { cwd: "/repo" });
  h.emit(TODO_ITEM_EVENT, { idempotencyKey: "item-1", todoRef: ".pi/artifacts/TODO.md", docDigest: DIGEST });
  h.emit(TODO_PHASE_EVENT, { idempotencyKey: "phase-1", todoRef: ".pi/artifacts/TODO.md", docDigest: DIGEST });
  h.emit(DCP_TELEMETRY_EVENT, { type: "compaction_completed", timestamp: "2026-07-25T00:00:00Z" });
  h.emit(SUBAGENT_REVIEW_EVENT, { taskId: "task-1", timestamp: "2026-07-25T00:00:00Z" });
  const signals = h.emitted.filter((event) => event.name === KNOWLEDGE_SIGNAL_EVENT);
  assert.equal(signals.length, 4);
  assert.equal(h.emitted.some((event) => event.name === LEARNING_OBSERVATION_EVENT), false);
});
