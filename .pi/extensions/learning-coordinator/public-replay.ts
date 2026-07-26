import {
  deliverReplayEvent,
  readCursor,
  type EventBusPort,
  type StreamCursorV1,
} from "./delivery.js";
import { buildSignalsFromProducerEvent } from "./adapters.js";

export interface ReplayPort<T> {
  replay(after?: StreamCursorV1, limit?: number): Promise<{
    events: T[];
    next?: StreamCursorV1;
  }>;
}

function validateNextCursor(
  producer: "pi-subagents" | "pi-todo" | "dcp",
  previous: StreamCursorV1 | undefined,
  next: StreamCursorV1 | undefined,
  eventCount: number,
): StreamCursorV1 | undefined {
  if (eventCount === 0) {
    if (next !== undefined) throw new Error("Replay port returned a cursor without events");
    return undefined;
  }
  if (!next) throw new Error("Replay port returned events without a durable next cursor");
  if (next.producer !== producer) throw new Error("Replay cursor producer mismatch");
  if (previous) {
    if (
      next.streamId !== previous.streamId ||
      next.streamGeneration !== previous.streamGeneration ||
      next.sequence <= previous.sequence
    ) {
      throw new Error("Replay cursor did not advance monotonically in the same stream generation");
    }
  }
  return next;
}

export async function replayPortToSink<T>(input: {
  producer: "pi-subagents" | "pi-todo" | "dcp";
  port: ReplayPort<T>;
  bus: EventBusPort;
  cursorPath: string;
  timeoutMs: number;
  retries: number;
  batchLimit?: number;
  maxBatches?: number;
}): Promise<void> {
  let cursor = await readCursor(input.cursorPath);
  const batchLimit = input.batchLimit ?? 64;
  const maxBatches = input.maxBatches ?? 1_000;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await input.port.replay(cursor, batchLimit);
    if (!Array.isArray(result.events)) throw new Error("Replay port returned invalid events");
    const next = validateNextCursor(input.producer, cursor, result.next, result.events.length);
    if (!next) return;
    const signals = result.events.flatMap((event) =>
      buildSignalsFromProducerEvent(input.producer, event),
    );
    await deliverReplayEvent({
      bus: input.bus,
      cursorPath: input.cursorPath,
      cursor: next,
      signals,
      timeoutMs: input.timeoutMs,
      retries: input.retries,
    });
    cursor = next;
  }
  throw new Error(`Replay exceeded ${maxBatches} batches without reaching source head`);
}
