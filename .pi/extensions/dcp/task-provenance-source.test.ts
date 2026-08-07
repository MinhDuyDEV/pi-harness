import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadTaskProvenanceRecall,
  normalizeTaskProvenanceEntries,
} from "./task-provenance-source.js";

const validEntry = {
  version: 1,
  producer: "pi-subagents",
  taskId: "task-auth-migration",
  invocationId: "invocation-1",
  agentType: "worker",
  description: "Migrate authentication sessions safely",
  executionPhase: "completed",
  reportedOutcome: "success",
  verificationPhase: "passed",
  reviewPhase: "accepted",
  startedAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T11:00:00.000Z",
  resultDigest: `sha256:${"a".repeat(64)}`,
};

describe("task provenance recall source", () => {
  it("normalizes only bounded versioned metadata into path-free recall entries", () => {
    const entries = normalizeTaskProvenanceEntries([
      validEntry,
      { ...validEntry, invocationId: "bad", executionPhase: "invented" },
      { ...validEntry, invocationId: "huge", description: "x".repeat(1_001) },
      { transcript: "/private/session.jsonl" },
    ]);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.source, "task");
    assert.match(entries[0]?.title ?? "", /task-auth-migration/);
    assert.match(entries[0]?.text ?? "", /Verification: passed/);
    assert.doesNotMatch(JSON.stringify(entries), /private\/session/);
  });

  it("loads the public pi-subagents replay export and reports real load failures", async () => {
    const loaded = await loadTaskProvenanceRecall("/project", async (specifier) => {
      assert.equal(specifier, "@minhduydev/pi-subagents/replay");
      return { listTaskProvenance: async () => [validEntry] };
    });
    assert.equal(loaded.status, "loaded");
    assert.equal(loaded.entries.length, 1);

    const broken = await loadTaskProvenanceRecall("/project", async () => {
      throw new Error("producer initialization failed");
    });
    assert.equal(broken.status, "error");
    assert.match(broken.warning ?? "", /producer initialization failed/);
  });
});
