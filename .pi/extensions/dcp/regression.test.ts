import { describe, it, expect } from "bun:test";
import { scanNewReReads, shouldLogRegression } from "./regression";
import type { Message } from "@earendil-works/pi-ai";
import { assistantMessage } from "./tests/message-fixtures.js";

function assistantRead(id: string, path: string): Message {
  return assistantMessage([
    {
      type: "toolCall",
      id,
      name: "read",
      arguments: { path },
    },
  ]);
}

describe("scanNewReReads", () => {
  it("dedupes same tool call id and path", () => {
    const seen = new Set<string>();
    const files = new Set(["a.ts"]);
    const msgs = [assistantRead("tc1", "a.ts"), assistantRead("tc1", "a.ts")];
    const r = scanNewReReads(msgs, files, seen);
    expect(r.newKeys).toHaveLength(1);
  });

  it("ignores grep", () => {
    const seen = new Set<string>();
    const files = new Set(["a.ts"]);
    const msgs: Message[] = [
      assistantMessage([
        {
          type: "toolCall",
          id: "g1",
          name: "grep",
          arguments: { path: "a.ts", pattern: "x" },
        },
      ]),
    ];
    const r = scanNewReReads(msgs, files, seen);
    expect(r.newKeys).toHaveLength(0);
  });
});

describe("shouldLogRegression", () => {
  it("skips gap 1 verify reads", () => {
    expect(shouldLogRegression(1)).toBe(false);
    expect(shouldLogRegression(2)).toBe(true);
  });
});