import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  KNOWLEDGE_SIGNAL_ACK_EVENT,
  KNOWLEDGE_SIGNAL_REQUEST_EVENT,
  knowledgeSignalDigest,
  type EventBusPort,
  type KnowledgeSignalV1,
  type StreamCursorV1,
} from "./delivery.js";
import { replayPortToSink, type ReplayPort } from "./public-replay.js";

class AckBus implements EventBusPort {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  requests = 0;
  on(event: string, handler: (payload: unknown) => void): () => void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }
  emit(event: string, payload: unknown): void {
    if (event === KNOWLEDGE_SIGNAL_REQUEST_EVENT) {
      this.requests += 1;
      const request = payload as { requestId: string; signal: KnowledgeSignalV1 };
      this.emit(KNOWLEDGE_SIGNAL_ACK_EVENT, {
        version: 1,
        requestId: request.requestId,
        signalDigest: knowledgeSignalDigest(request.signal),
        status: "committed-applied",
        ledgerEventIds: ["ledger-1"],
      });
      return;
    }
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

const digest = (value: string) => `sha256:v1:${value.repeat(64)}`;
const cursor: StreamCursorV1 = {
  version: 1,
  producer: "pi-todo",
  streamId: "todo",
  streamGeneration: "generation-1",
  sequence: 1,
  eventId: "event-1",
  prefixHash: digest("a"),
  payloadDigest: digest("b"),
};
const usage = {
  version: 1,
  usageId: "usage-1",
  projectId: "project-1",
  trustEpoch: "trust-1",
  sessionGeneration: "session-1",
  consumer: { kind: "subagent", id: "task-1" },
  correlationId: "corr-1",
  requestDigest: digest("c"),
  queryDigest: digest("b"),
  learningId: "learning-1",
  learningRevision: 1,
  learningDigest: digest("d"),
  returnedAt: "2026-07-26T00:00:00.000Z",
} as const;

test("consumes only a public replay port and persists its opaque next cursor after ack", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phase5-public-replay-"));
  try {
    let calls = 0;
    const port: ReplayPort<Record<string, unknown>> = {
      async replay() {
        calls += 1;
        return calls === 1
          ? {
              events: [{
                version: 1,
                eventId: "event-1",
                sequence: 1,
                occurredAt: "2026-07-26T00:00:01.000Z",
                type: "todo_item_completed",
                subjectDigest: digest("e"),
                usageBindings: [usage],
              }],
              next: cursor,
            }
          : { events: [] };
      },
    };
    const bus = new AckBus();
    await replayPortToSink({
      producer: "pi-todo",
      port,
      bus,
      cursorPath: join(directory, "cursor.json"),
      timeoutMs: 50,
      retries: 0,
    });
    assert.equal(bus.requests, 1);
    assert.equal(calls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
