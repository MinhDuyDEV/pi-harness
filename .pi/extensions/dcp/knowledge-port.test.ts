import { describe, expect, it } from "bun:test";

import {
  appendDcpCheckpointReference,
  appendDcpUsageReference,
  createDcpKnowledgeEvent,
  emptyDcpKnowledgeReferences,
  parseDcpUsageReference,
} from "./knowledge-port.js";

const digest = (character: string) => `sha256:v1:${character.repeat(64)}`;
const usage = {
  version: 1 as const,
  usageId: digest("a"),
  projectId: "project-1",
  trustEpoch: "trust-1",
  sessionGeneration: "session-1",
  consumer: { kind: "subagent" as const, id: "task-1" },
  correlationId: "corr-1",
  requestDigest: digest("b"),
  queryDigest: digest("c"),
  learningId: "learning-1",
  learningRevision: 1,
  learningDigest: digest("d"),
  returnedAt: "2026-07-26T00:00:00.000Z",
};

describe("DCP V2 knowledge references", () => {
  it("persists complete usage receipts without candidate text and deduplicates them", () => {
    const empty = emptyDcpKnowledgeReferences();
    const first = appendDcpUsageReference(empty, usage);
    const duplicate = appendDcpUsageReference(first, usage);
    expect(first.version).toBe(2);
    expect(first.usage).toEqual([usage]);
    expect(duplicate).toBe(first);
    expect(JSON.stringify(first)).not.toMatch(/summary|transcript|embedding|prompt|content|body/i);
    expect(empty.usage).toEqual([]);
  });

  it("emits one replayable checkpoint event with all exact usage bindings", () => {
    let references = appendDcpUsageReference(emptyDcpKnowledgeReferences(), usage);
    references = appendDcpCheckpointReference(references, {
      checkpointId: "checkpoint-1",
      blockId: "block-1",
      subjectDigest: digest("e"),
      occurredAt: "2026-07-26T00:01:00.000Z",
      usageIds: [usage.usageId],
    });
    const event = createDcpKnowledgeEvent({
      checkpoint: references.checkpoints[0]!,
      usage: references.usage,
      sequence: 1,
    });
    expect(event).toEqual(expect.objectContaining({
      type: "dcp_checkpointed",
      sequence: 1,
      subjectDigest: digest("e"),
      usageBindings: [usage],
    }));
    expect(JSON.stringify(event)).not.toContain("compacted text");
  });

  it("fails closed on receipt-id-only and secret-bearing references", () => {
    expect(parseDcpUsageReference({ usageId: usage.usageId })).toBeUndefined();
    expect(parseDcpUsageReference({
      ...usage,
      consumer: { kind: "subagent", id: "token=secret-value" },
    })).toBeUndefined();
  });
});
