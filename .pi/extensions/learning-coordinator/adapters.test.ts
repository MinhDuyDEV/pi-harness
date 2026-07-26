import assert from "node:assert/strict";
import test from "node:test";
import { buildSignalsFromProducerEvent } from "./adapters.js";

const digest = (character: string) => `sha256:v1:${character.repeat(64)}`;
const usage = {
  version: 1,
  usageId: "usage-1",
  projectId: "project-1",
  trustEpoch: "trust-1",
  sessionGeneration: "session-1",
  consumer: { kind: "subagent", id: "task-1" },
  correlationId: "corr-1",
  requestDigest: digest("a"),
  queryDigest: digest("b"),
  learningId: "learning-1",
  learningRevision: 1,
  learningDigest: digest("c"),
  returnedAt: "2026-07-26T00:00:00.000Z",
} as const;

test("creates exactly one signal per complete usage binding", () => {
  const signals = buildSignalsFromProducerEvent("pi-subagents", {
    version: 1,
    id: "event-1",
    sequence: 1,
    timestamp: "2026-07-26T00:01:00.000Z",
    type: "review_completed",
    reviewStatus: "approved",
    taskId: "task-1",
    usageBindings: [usage],
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.usage.usageId, usage.usageId);
  assert.equal(signals[0]?.outcome, "passed");
});

test("TODO, DCP, and review events without complete bindings remain non-learning", () => {
  for (const producer of ["pi-subagents", "pi-todo", "dcp"] as const) {
    assert.deepEqual(buildSignalsFromProducerEvent(producer, {
      version: 1,
      id: "event-1",
      sequence: 1,
      timestamp: "2026-07-26T00:01:00.000Z",
      type: producer === "pi-subagents" ? "review_completed" : "completed",
      usageReceiptIds: ["usage-1"],
    }), []);
  }
});

test("fans out independent usage bindings without candidate text", () => {
  const signals = buildSignalsFromProducerEvent("pi-todo", {
    version: 1,
    eventId: "todo-event-1",
    sequence: 3,
    occurredAt: "2026-07-26T00:01:00.000Z",
    type: "todo_item_completed",
    subjectDigest: digest("d"),
    usageBindings: [usage, { ...usage, usageId: "usage-2", learningId: "learning-2" }],
  });
  assert.equal(signals.length, 2);
  assert.equal(JSON.stringify(signals).includes("TODO text"), false);
  assert.deepEqual(signals.map((signal) => signal.usage.usageId), ["usage-1", "usage-2"]);
});
