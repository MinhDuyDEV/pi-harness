import { describe, expect, it } from "bun:test";

import dcpExtension from "./index.js";

function createMockPi() {
  const handlers = new Map<string, Array<(event: any) => unknown>>();

  return {
    api: {
      on(event: string, handler: (event: any) => unknown) {
        const existing = handlers.get(event) ?? [];
        existing.push(handler);
        handlers.set(event, existing);
      },
      appendEntry() {},
      registerTool() {},
      registerCommand() {},
    },
    getHandlers(event: string) {
      return handlers.get(event) ?? [];
    },
  };
}

describe("dcp extension turn-end compaction behavior", () => {
  it("does not proactively call ctx.compact after crossing the default threshold", async () => {
    const mock = createMockPi();

    dcpExtension(mock.api as any);

    const [turnEndHandler] = mock.getHandlers("turn_end");
    const [beforeCompactHandler] = mock.getHandlers("session_before_compact");

    expect(turnEndHandler).toBeDefined();
    expect(beforeCompactHandler).toBeDefined();

    let compactCalls = 0;
    await turnEndHandler({
      sessionId: "session-1",
      model: { id: "test-model", contextWindow: 1_000 },
      getContextUsage() {
        return { currentTokens: 960, maxTokens: 1_000, percentage: 96 };
      },
      async compact() {
        compactCalls += 1;
      },
      sessionManager: {
        async getBranch() {
          return [];
        },
      },
    });

    expect(compactCalls).toBe(0);
  });
});
