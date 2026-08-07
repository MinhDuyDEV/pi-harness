import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { browseRecallEntries, filterRecallEntries, rankRecallEntries } from "./recall-ranking.js";
import type { RecallEntry } from "./recall-types.js";

const entries: RecallEntry[] = [
  {
    index: 1,
    source: "dcp",
    title: "Alpha decision",
    text: "Use the stable parser",
    role: "user",
    timestamp: Date.parse("2026-07-21T00:00:00.000Z"),
  },
  {
    index: 2,
    source: "jsonl",
    title: "Beta note",
    text: "Unrelated content",
    role: "user",
    timestamp: Date.parse("2026-07-22T00:00:00.000Z"),
  },
  {
    index: 3,
    source: "task",
    title: "[task:auth-migration] Migrate authentication sessions",
    text: "Execution: completed\nVerification: passed\nReview: accepted",
    timestamp: Date.parse("2026-07-23T00:00:00.000Z"),
  },
];

describe("recall ranking", () => {
  it("filters by source and case-insensitive query", () => {
    assert.deepEqual(filterRecallEntries(entries, "STABLE", "dcp"), [entries[0]]);
    assert.deepEqual(filterRecallEntries(entries, undefined, "jsonl"), [entries[1]]);
  });

  it("ranks exact phrase matches before recency", () => {
    const ranked = rankRecallEntries(entries, "stable parser");
    assert.equal(ranked[0]?.title, "Alpha decision");
  });

  it("keeps exact durable task provenance above transcript chatter", () => {
    const ranked = rankRecallEntries(entries, "auth migration");
    assert.equal(ranked[0]?.source, "task");
  });

  it("browses newest entries first with pagination", () => {
    const browsed = browseRecallEntries(entries, 1, 1);
    assert.deepEqual(browsed, [entries[2]]);
  });
});
