
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  KnowledgeSignalInbox,
  UsageReceiptStore,
  signalDigest,
  taggedDigest,
} from "@minhduydev/pi-learning";
import {
  createLifecycleJournal,
  createLifecycleRecord,
} from "@minhduydev/pi-todo/events";
import { createTodoReplayPort } from "@minhduydev/pi-todo/replay";
import {
  makeContextRequestPayloadV2,
  makeLearningClaimIntent,
  makeProofVerifiedPayload,
  parseContextRequestV2,
} from "@minhduydev/pi-subagents/events";
import { createOrchestrationReplayPort } from "@minhduydev/pi-subagents/replay";

const projectDirectory = join(process.cwd(), "project");
await mkdir(projectDirectory, { recursive: true });
const phase5Root = join(projectDirectory, ".pi", "artifacts", "learning", "phase5");
const receiptStore = new UsageReceiptStore(phase5Root);
const tagged = (character) => `sha256:v1:${character.repeat(64)}`;
const receipt = await receiptStore.issue({
  projectId: "project-1",
  trustEpoch: "trust-1",
  sessionGeneration: "session-1",
  consumer: { kind: "parent-turn", id: "parent-1" },
  correlationId: "corr-1",
  requestDigest: tagged("a"),
  queryDigest: tagged("b"),
  learningId: "learning-1",
  learningRevision: 1,
  learningDigest: tagged("c"),
});
const journal = createLifecycleJournal(join(projectDirectory, ".pi", "artifacts", "todo", "lifecycle"));
await journal.append(createLifecycleRecord({
  version: 1,
  streamId: journal.streamId,
  sequence: 1,
  eventId: tagged("d"),
  idempotencyKey: "todo-event-1",
  occurredAt: new Date(Date.now() + 1_000).toISOString(),
  itemId: "todo-item-1",
  completionEpoch: 1,
  beforeDigest: tagged("e"),
  afterDigest: tagged("f"),
  usage: receipt,
}));
const todoPort = createTodoReplayPort({ projectDirectory });
const page = await todoPort.replay(undefined, 10);
assert.equal(page.events.length, 1);
assert.equal(page.events[0].usageBindings[0].usageId, receipt.usageId);
assert.deepEqual(await todoPort.replay(page.next, 10), { events: [] });
let applied = 0;
const inbox = new KnowledgeSignalInbox(phase5Root, {
  receipts: receiptStore,
  activeBinding: () => ({
    trusted: true,
    projectId: "project-1",
    trustEpoch: "trust-1",
    sessionGeneration: "session-1",
  }),
  applySignal: async () => { applied += 1; return ["ledger-1"]; },
});
const event = page.events[0];
const signal = {
  version: 1,
  producer: "pi-todo",
  streamId: `pi-todo:${receipt.projectId}:${receipt.trustEpoch}`,
  sequence: event.sequence,
  eventId: event.eventId,
  idempotencyKey: `pi-todo:${event.eventId}:${receipt.usageId}`,
  occurredAt: event.occurredAt,
  projectId: receipt.projectId,
  trustEpoch: receipt.trustEpoch,
  sessionGeneration: receipt.sessionGeneration,
  usage: {
    usageId: receipt.usageId,
    consumer: receipt.consumer,
    correlationId: receipt.correlationId,
    requestDigest: receipt.requestDigest,
    learningId: receipt.learningId,
    learningRevision: receipt.learningRevision,
    learningDigest: receipt.learningDigest,
  },
  subject: { kind: "todo-item", digest: event.subjectDigest },
  outcome: "completed",
};
const ack = await inbox.ingest({ version: 1, requestId: taggedDigest({ signal: signalDigest(signal) }), signal });
assert.equal(ack.status, "committed-applied");
assert.equal(applied, 1);
const claim = makeLearningClaimIntent({
  version: 2,
  kind: "pattern",
  statement: "Run focused parser tests before the complete suite",
  applicability: "parser changes",
});
const context = makeContextRequestPayloadV2(
  "task-1",
  "general",
  "description only",
  "corr-1",
  [claim],
);
assert.deepEqual(
  parseContextRequestV2(context),
  context,
  "the packed producer must emit a V2 context request accepted by the packed parser",
);
assert.equal(context.learningIntents[0].claimId, claim.claimId);
const proof = makeProofVerifiedPayload("task-final", true, [], [], "corr-1", {
  requestDigest: context.requestDigest,
  projectId: "project-1", trustEpoch: "trust-1", sessionGeneration: "session-1",
  supportedClaims: [{ claimId: claim.claimId, supported: true, evidenceDigests: [tagged("9")] }],
});
assert.equal(proof.requestDigest, context.requestDigest);
assert.equal(typeof createOrchestrationReplayPort, "function");
console.log("phase5-packed-e2e: PASS");
