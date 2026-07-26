import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  KNOWLEDGE_SIGNAL_ACK_EVENT,
  KNOWLEDGE_SIGNAL_REQUEST_EVENT,
  deliverReplayEvent,
  knowledgeSignalDigest,
  readCursor,
  type EventBusPort,
  type KnowledgeSignalAckV1,
  type KnowledgeSignalV1,
  type StreamCursorV1,
} from "./delivery.js";

class Bus implements EventBusPort {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  on(event: string, handler: (payload: unknown) => void): () => void {
    const current = this.handlers.get(event) ?? new Set();
    current.add(handler);
    this.handlers.set(event, current);
    return () => current.delete(handler);
  }
  emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) queueMicrotask(() => handler(payload));
  }
}

function cursor(sequence = 1): StreamCursorV1 {
  return {
    version: 1,
    producer: "pi-todo",
    streamId: "todo-lifecycle",
    streamGeneration: "generation-1",
    sequence,
    eventId: `event-${sequence}`,
    prefixHash: `sha256:v1:${"a".repeat(64)}`,
    payloadDigest: `sha256:v1:${"b".repeat(64)}`,
  };
}

function signal(sequence = 1): KnowledgeSignalV1 {
  return {
    version: 1,
    producer: "pi-todo",
    streamId: "todo-lifecycle",
    sequence,
    eventId: `event-${sequence}`,
    idempotencyKey: `todo:event-${sequence}:usage-1`,
    occurredAt: "2026-07-26T00:00:00.000Z",
    projectId: "project-1",
    trustEpoch: "trust-1",
    sessionGeneration: "session-1",
    usage: {
      usageId: "usage-1",
      consumer: { kind: "subagent", id: "task-1" },
      correlationId: "corr-1",
      requestDigest: `sha256:v1:${"c".repeat(64)}`,
      learningId: "learning-1",
      learningRevision: 1,
      learningDigest: `sha256:v1:${"d".repeat(64)}`,
    },
    subject: { kind: "todo-item", digest: `sha256:v1:${"e".repeat(64)}` },
    outcome: "completed",
  };
}

test("subscribes before send and advances the cursor only after durable ack", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase5-delivery-"));
  try {
    const bus = new Bus();
    bus.on(KNOWLEDGE_SIGNAL_REQUEST_EVENT, (payload) => {
      const request = payload as { requestId: string; signal: KnowledgeSignalV1 };
      const ack: KnowledgeSignalAckV1 = {
        version: 1,
        requestId: request.requestId,
        signalDigest: knowledgeSignalDigest(request.signal),
        status: "committed-applied",
        ledgerEventIds: ["ledger-1"],
      };
      bus.emit(KNOWLEDGE_SIGNAL_ACK_EVENT, ack);
    });
    const cursorPath = join(directory, "cursor.json");
    await deliverReplayEvent({
      bus,
      cursorPath,
      cursor: cursor(),
      signals: [signal()],
      timeoutMs: 100,
      retries: 0,
    });
    assert.deepEqual(await readCursor(cursorPath), cursor());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cursor persistence failure is surfaced after ack without creating a cursor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase5-delivery-cursor-failure-"));
  try {
    const bus = new Bus();
    bus.on(KNOWLEDGE_SIGNAL_REQUEST_EVENT, (payload) => {
      const request = payload as { requestId: string; signal: KnowledgeSignalV1 };
      bus.emit(KNOWLEDGE_SIGNAL_ACK_EVENT, {
        version: 1,
        requestId: request.requestId,
        signalDigest: knowledgeSignalDigest(request.signal),
        status: "committed-applied",
        ledgerEventIds: ["ledger-1"],
      } satisfies KnowledgeSignalAckV1);
    });
    const cursorPath = join(directory, "cursor.json");
    await assert.rejects(
      deliverReplayEvent({
        bus,
        cursorPath,
        cursor: cursor(),
        signals: [signal()],
        timeoutMs: 100,
        retries: 0,
        persist: async () => { throw new Error("simulated cursor fsync failure"); },
      }),
      /simulated cursor fsync failure/,
    );
    assert.equal(await readCursor(cursorPath), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sink timeout leaves the durable cursor unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase5-delivery-timeout-"));
  try {
    const cursorPath = join(directory, "cursor.json");
    await assert.rejects(
      deliverReplayEvent({
        bus: new Bus(),
        cursorPath,
        cursor: cursor(),
        signals: [signal()],
        timeoutMs: 5,
        retries: 1,
      }),
      /acknowledgment timeout/,
    );
    await assert.rejects(readFile(cursorPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("retries with the same deterministic request identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase5-delivery-retry-"));
  try {
    const bus = new Bus();
    const requestIds: string[] = [];
    bus.on(KNOWLEDGE_SIGNAL_REQUEST_EVENT, (payload) => {
      const request = payload as { requestId: string; signal: KnowledgeSignalV1 };
      requestIds.push(request.requestId);
      if (requestIds.length === 2) {
        bus.emit(KNOWLEDGE_SIGNAL_ACK_EVENT, {
          version: 1,
          requestId: request.requestId,
          signalDigest: knowledgeSignalDigest(request.signal),
          status: "duplicate",
          ledgerEventIds: [],
        } satisfies KnowledgeSignalAckV1);
      }
    });
    await deliverReplayEvent({
      bus,
      cursorPath: join(directory, "cursor.json"),
      cursor: cursor(),
      signals: [signal()],
      timeoutMs: 5,
      retries: 1,
    });
    assert.equal(requestIds.length, 2);
    assert.equal(requestIds[0], requestIds[1]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fanout advances only after every usage-bound signal is acknowledged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase5-delivery-fanout-"));
  try {
    const bus = new Bus();
    let requests = 0;
    bus.on(KNOWLEDGE_SIGNAL_REQUEST_EVENT, (payload) => {
      requests += 1;
      const request = payload as { requestId: string; signal: KnowledgeSignalV1 };
      if (requests === 1) {
        bus.emit(KNOWLEDGE_SIGNAL_ACK_EVENT, {
          version: 1,
          requestId: request.requestId,
          signalDigest: knowledgeSignalDigest(request.signal),
          status: "duplicate",
          ledgerEventIds: [],
        } satisfies KnowledgeSignalAckV1);
      }
    });
    const cursorPath = join(directory, "cursor.json");
    await assert.rejects(
      deliverReplayEvent({
        bus,
        cursorPath,
        cursor: cursor(),
        signals: [signal(1), { ...signal(1), idempotencyKey: "todo:event-1:usage-2", usage: { ...signal(1).usage, usageId: "usage-2" } }],
        timeoutMs: 5,
        retries: 0,
      }),
      /acknowledgment timeout/,
    );
    assert.equal(await readCursor(cursorPath), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
