import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadDurableSessionStateFromPath,
  saveDurableSessionStateToPath,
  type DurableSessionState,
} from "./storage.js";
import { sessionStateFromDurable } from "./compress-state-storage.js";

function state(version: 1 | 2 = 2): DurableSessionState {
  return {
    version,
    sessionId: "session-1",
    sessionKey: "session-key",
    blocks: [],
    artifacts: [],
    processedMessageIds: [],
    compressEventCount: 0,
    lastCompressTurn: 0,
    updatedAt: 1,
  };
}

describe("DCP durable reference state", () => {
  it("migrates V1 and old V2 state without inventing content", () => {
    const dir = mkdtempSync(join(tmpdir(), "dcp-state-"));
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify(state(1)));

    const restored = loadDurableSessionStateFromPath(path);

    expect(restored?.version).toBe(2);
    expect(restored?.knowledgeReferences).toEqual({
      version: 2,
      usage: [],
      checkpoints: [],
    });
  });

  it("rejects truncated state and ignores an incomplete temp file", () => {
    const dir = mkdtempSync(join(tmpdir(), "dcp-state-"));
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify(state()));
    writeFileSync(`${path}.tmp`, '{"version":2,"blocks":[');

    expect(loadDurableSessionStateFromPath(path)).toBeDefined();
    writeFileSync(path, '{"version":2,"blocks":[');
    expect(loadDurableSessionStateFromPath(path)).toBeUndefined();
  });

  it("writes a complete checkpoint atomically and fsyncs the directory boundary", () => {
    const dir = mkdtempSync(join(tmpdir(), "dcp-state-"));
    const path = join(dir, "state.json");
    const current = state();
    const tagged = (character: string) => `sha256:v1:${character.repeat(64)}`;
    current.knowledgeReferences = {
      version: 2,
      usage: [{
        version: 1,
        usageId: tagged("a"),
        projectId: "project-1",
        trustEpoch: "trust-1",
        sessionGeneration: "session-1",
        consumer: { kind: "subagent", id: "task-1" },
        correlationId: "corr-1",
        requestDigest: tagged("b"),
        queryDigest: tagged("c"),
        learningId: "l1",
        learningRevision: 1,
        learningDigest: tagged("d"),
        returnedAt: "2026-07-26T00:00:00.000Z",
      }],
      checkpoints: [{
        version: 1,
        eventId: "checkpoint-event-1",
        checkpointId: "c1",
        blockId: "block-1",
        subjectDigest: tagged("e"),
        occurredAt: "2026-07-26T00:01:00.000Z",
        usageIds: [tagged("a")],
      }],
    };

    saveDurableSessionStateToPath(current, path);
    const restored = loadDurableSessionStateFromPath(path);

    expect(restored?.knowledgeReferences).toEqual(current.knowledgeReferences);
    expect(sessionStateFromDurable(restored!).knowledgeReferences).toEqual(current.knowledgeReferences);
    expect(Bun.file(`${path}.tmp`).size).toBe(0);
  });
});
