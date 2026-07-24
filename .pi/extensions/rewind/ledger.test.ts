import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSessionLedgerContent } from "./ledger.js";

describe("rewind ledger parsing", () => {
  it("reconstructs bindings, labels, current/undo state, and fork pending state", () => {
    const content = [
      JSON.stringify({ type: "session", id: "session-1", cwd: "/repo", parentSession: null }),
      JSON.stringify({ type: "custom", customType: "rewind-turn", timestamp: "2026-07-22T00:00:00.000Z", data: { v: 2, snapshots: ["a"], bindings: [["entry-1", 0]] } }),
      JSON.stringify({ type: "label", id: "label-1", parentId: "entry-1", timestamp: "2026-07-22T00:01:00.000Z", targetId: "entry-1", label: "keep" }),
      JSON.stringify({ type: "custom", customType: "rewind-op", timestamp: "2026-07-22T00:02:00.000Z", data: { v: 2, snapshots: ["b", "c"], current: 0, undo: 1 } }),
      JSON.stringify({ type: "custom", customType: "rewind-fork-pending", data: { v: 2, current: "b", undo: "c" } }),
      "not json",
    ].join("\n");

    const ledger = parseSessionLedgerContent("/tmp/session.jsonl", content);
    assert.equal(ledger.sessionId, "session-1");
    assert.equal(ledger.cwd, "/repo");
    assert.equal(ledger.entryToCommit.get("entry-1"), "a");
    assert.ok(ledger.labeledEntryIds.has("entry-1"));
    assert.equal(ledger.latestCurrentCommitSha, "b");
    assert.equal(ledger.latestUndoCommitSha, "c");
    assert.deepEqual(ledger.latestForkPending, { v: 2, current: "b", undo: "c" });
    assert.equal(ledger.references.length, 3);
  });

  it("removes a label when the latest label entry is empty", () => {
    const content = [
      JSON.stringify({ type: "label", id: "label-1", parentId: null, timestamp: "2026-07-22T00:00:00.000Z", targetId: "entry-1", label: "keep" }),
      JSON.stringify({ type: "label", id: "label-2", parentId: "label-1", timestamp: "2026-07-22T00:01:00.000Z", targetId: "entry-1", label: "" }),
    ].join("\n");
    assert.equal(parseSessionLedgerContent("session.jsonl", content).labeledEntryIds.has("entry-1"), false);
  });
});
