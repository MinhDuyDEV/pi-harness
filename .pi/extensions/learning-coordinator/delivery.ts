import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const KNOWLEDGE_SIGNAL_REQUEST_EVENT = "pi-learning:v1:knowledge-signal-request";
export const KNOWLEDGE_SIGNAL_ACK_EVENT = "pi-learning:v1:knowledge-signal-ack";

export interface EventBusPort {
  on(event: string, handler: (payload: unknown) => void): () => void;
  emit(event: string, payload: unknown): void;
}

export interface UsageBindingV1 {
  usageId: string;
  consumer: { kind: "parent-turn" | "subagent"; id: string };
  correlationId: string;
  requestDigest: string;
  learningId: string;
  learningRevision: number;
  learningDigest: string;
}

export interface KnowledgeSignalV1 {
  version: 1;
  producer: "pi-subagents-review" | "pi-todo" | "dcp";
  streamId: string;
  sequence: number;
  eventId: string;
  idempotencyKey: string;
  occurredAt: string;
  projectId: string;
  trustEpoch: string;
  sessionGeneration: string;
  usage: UsageBindingV1;
  subject: {
    kind: "todo-item" | "todo-phase" | "review" | "dcp-checkpoint";
    digest: string;
    ref?: string;
  };
  outcome: "completed" | "passed" | "failed" | "changes-requested" | "checkpointed";
}

export interface KnowledgeSignalRequestV1 {
  version: 1;
  requestId: string;
  signal: KnowledgeSignalV1;
}

export type KnowledgeSignalAckStatus =
  | "committed-pending-link"
  | "committed-applied"
  | "quarantined-conflict"
  | "duplicate";

export interface KnowledgeSignalAckV1 {
  version: 1;
  requestId: string;
  signalDigest: string;
  status: KnowledgeSignalAckStatus;
  ledgerEventIds: string[];
}

export interface StreamCursorV1 {
  version: 1;
  producer: "pi-subagents" | "pi-todo" | "dcp";
  streamId: string;
  streamGeneration: string;
  sequence: number;
  eventId: string;
  prefixHash: string;
  payloadDigest: string;
}

const TAGGED_DIGEST = /^sha256:v1:[0-9a-f]{64}$/;
const ACK_STATUSES = new Set<KnowledgeSignalAckStatus>([
  "committed-pending-link",
  "committed-applied",
  "quarantined-conflict",
  "duplicate",
]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(input)
      .sort()
      .flatMap((key) => input[key] === undefined ? [] : [[key, canonical(input[key])]]),
  );
}

export function knowledgeSignalDigest(value: unknown): string {
  return `sha256:v1:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}

function requestFor(signal: KnowledgeSignalV1): KnowledgeSignalRequestV1 {
  const signalDigest = knowledgeSignalDigest(signal);
  return {
    version: 1,
    requestId: knowledgeSignalDigest({
      producer: signal.producer,
      streamId: signal.streamId,
      eventId: signal.eventId,
      idempotencyKey: signal.idempotencyKey,
      signalDigest,
    }),
    signal,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseAck(value: unknown): KnowledgeSignalAckV1 | undefined {
  const input = record(value);
  if (
    !input ||
    Object.keys(input).some((key) => !["version", "requestId", "signalDigest", "status", "ledgerEventIds"].includes(key)) ||
    input.version !== 1 ||
    !TAGGED_DIGEST.test(String(input.requestId)) ||
    !TAGGED_DIGEST.test(String(input.signalDigest)) ||
    !ACK_STATUSES.has(input.status as KnowledgeSignalAckStatus) ||
    !Array.isArray(input.ledgerEventIds) ||
    !input.ledgerEventIds.every((item) => typeof item === "string" && item.length > 0 && item.length <= 200)
  ) return undefined;
  return {
    version: 1,
    requestId: String(input.requestId),
    signalDigest: String(input.signalDigest),
    status: input.status as KnowledgeSignalAckStatus,
    ledgerEventIds: [...input.ledgerEventIds] as string[],
  };
}

async function sendAndAwaitAck(
  bus: EventBusPort,
  request: KnowledgeSignalRequestV1,
  timeoutMs: number,
): Promise<KnowledgeSignalAckV1> {
  return new Promise((resolve, reject) => {
    const expectedSignalDigest = knowledgeSignalDigest(request.signal);
    const handler = (payload: unknown): void => {
      const ack = parseAck(payload);
      if (
        !ack ||
        ack.requestId !== request.requestId ||
        ack.signalDigest !== expectedSignalDigest
      ) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(ack);
    };
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Knowledge signal acknowledgment timeout for ${request.requestId}`));
    }, timeoutMs);
    const unsubscribe = bus.on(KNOWLEDGE_SIGNAL_ACK_EVENT, handler);
    bus.emit(KNOWLEDGE_SIGNAL_REQUEST_EVENT, request);
  });
}

async function deliverSignal(
  bus: EventBusPort,
  signal: KnowledgeSignalV1,
  timeoutMs: number,
  retries: number,
): Promise<void> {
  const request = requestFor(signal);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await sendAndAwaitAck(bus, request, timeoutMs);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Knowledge signal delivery failed");
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function persistCursor(path: string, cursor: StreamCursorV1): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(cursor)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  await syncDirectory(directory);
}

function parseCursor(value: unknown): StreamCursorV1 | undefined {
  const input = record(value);
  if (
    !input ||
    Object.keys(input).some((key) => !["version", "producer", "streamId", "streamGeneration", "sequence", "eventId", "prefixHash", "payloadDigest"].includes(key)) ||
    input.version !== 1 ||
    !["pi-subagents", "pi-todo", "dcp"].includes(String(input.producer)) ||
    !Number.isInteger(input.sequence) ||
    Number(input.sequence) < 0 ||
    !TAGGED_DIGEST.test(String(input.prefixHash)) ||
    !TAGGED_DIGEST.test(String(input.payloadDigest)) ||
    ![input.streamId, input.streamGeneration, input.eventId].every((item) => typeof item === "string" && item.length > 0 && item.length <= 200)
  ) return undefined;
  return {
    version: 1,
    producer: input.producer as StreamCursorV1["producer"],
    streamId: String(input.streamId),
    streamGeneration: String(input.streamGeneration),
    sequence: Number(input.sequence),
    eventId: String(input.eventId),
    prefixHash: String(input.prefixHash),
    payloadDigest: String(input.payloadDigest),
  };
}

export async function readCursor(path: string): Promise<StreamCursorV1 | undefined> {
  try {
    const cursor = parseCursor(JSON.parse(await readFile(path, "utf8")));
    if (!cursor) throw new Error("Durable replay cursor is invalid or corrupt");
    return cursor;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function deliverReplayEvent(input: {
  bus: EventBusPort;
  cursorPath: string;
  cursor: StreamCursorV1;
  signals: readonly KnowledgeSignalV1[];
  timeoutMs: number;
  retries: number;
  persist?: (path: string, cursor: StreamCursorV1) => Promise<void>;
}): Promise<void> {
  for (const signal of input.signals) {
    await deliverSignal(input.bus, signal, input.timeoutMs, input.retries);
  }
  await (input.persist ?? persistCursor)(input.cursorPath, input.cursor);
}
