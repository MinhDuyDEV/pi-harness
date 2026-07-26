import { createHash } from "node:crypto";
import { createDcpKnowledgeEvent } from "./knowledge-port.js";
import {
  listDurableSessionStates,
  loadDurableSessionState,
} from "./storage.js";

export interface DcpReplayCursorV1 {
  version: 1;
  producer: "dcp";
  streamId: "dcp-checkpoints";
  streamGeneration: string;
  sequence: number;
  eventId: string;
  prefixHash: string;
  payloadDigest: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonical(input[key])]));
}

function taggedDigest(value: unknown): string {
  return `sha256:v1:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}

async function events(): Promise<Record<string, unknown>[]> {
  const states = await listDurableSessionStates();
  const snapshots = states.flatMap((info) => {
    const state = loadDurableSessionState(info.sessionId);
    return state ? [state] : [];
  });
  const inputs = snapshots.flatMap((state) => {
    const refs = state.knowledgeReferences;
    if (!refs) return [];
    return refs.checkpoints.flatMap((checkpoint) => {
      const event = createDcpKnowledgeEvent({ checkpoint, usage: refs.usage, sequence: 1 });
      return event ? [event] : [];
    });
  });
  inputs.sort((left, right) =>
    String(left.occurredAt).localeCompare(String(right.occurredAt)) ||
    String(left.eventId).localeCompare(String(right.eventId)),
  );
  return inputs.map((event, index) => ({ ...event, sequence: index + 1 }));
}

function cursorEntries(source: readonly Record<string, unknown>[]): Array<{
  event: Record<string, unknown>;
  cursor: DcpReplayCursorV1;
}> {
  const streamGeneration = taggedDigest({
    producer: "dcp",
    firstEventId: source[0]?.eventId ?? "empty",
  });
  let prefixHash = taggedDigest({ producer: "dcp", streamGeneration });
  return source.map((event, index) => {
    const payloadDigest = taggedDigest(event);
    const sequence = index + 1;
    const eventId = String(event.eventId);
    prefixHash = taggedDigest({ prefixHash, payloadDigest, eventId, sequence });
    return {
      event,
      cursor: {
        version: 1,
        producer: "dcp",
        streamId: "dcp-checkpoints",
        streamGeneration,
        sequence,
        eventId,
        prefixHash,
        payloadDigest,
      },
    };
  });
}

function startAfter(
  entries: ReturnType<typeof cursorEntries>,
  cursor: DcpReplayCursorV1,
): number {
  if (cursor.version !== 1 || cursor.producer !== "dcp" || cursor.streamId !== "dcp-checkpoints") {
    throw new Error("DCP replay cursor belongs to another producer stream");
  }
  const index = entries.findIndex((entry) => entry.cursor.sequence === cursor.sequence);
  if (index < 0) throw new Error("DCP checkpoint stream was truncated or rewound");
  const actual = entries[index]!.cursor;
  if (
    actual.streamGeneration !== cursor.streamGeneration ||
    actual.eventId !== cursor.eventId ||
    actual.prefixHash !== cursor.prefixHash ||
    actual.payloadDigest !== cursor.payloadDigest
  ) throw new Error("DCP replay cursor prefix or payload mismatch");
  return index + 1;
}

export function createDcpReplayPort(_input: { projectDirectory: string }): {
  replay(
    after?: DcpReplayCursorV1,
    limit?: number,
  ): Promise<{ events: Record<string, unknown>[]; next?: DcpReplayCursorV1 }>;
} {
  return {
    async replay(after, limit = 64) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error("DCP replay limit is out of bounds");
      }
      const entries = cursorEntries(await events());
      const start = after ? startAfter(entries, after) : 0;
      const batch = entries.slice(start, start + limit);
      return {
        events: batch.map((entry) => entry.event),
        ...(batch.length > 0 ? { next: batch.at(-1)!.cursor } : {}),
      };
    },
  };
}
