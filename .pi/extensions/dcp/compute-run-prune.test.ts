import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { assistantMessage } from "./tests/message-fixtures.js";
import { computeRunPruneStats, runContextStrategies } from "./compress.js";
import { DEFAULT_CONFIG, type DCPConfig } from "./config.js";

function freshConfig(): DCPConfig {
  return structuredClone(DEFAULT_CONFIG);
}

function assistantToolResult(toolCallId: string, text: string): Message {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: toolCallId,
        name: "bash",
        arguments: { command: "echo hi" },
      },
      { type: "text", text },
    ],
  } as AssistantMessage;
}

function toolResultMessage(
  toolCallId: string,
  toolName: string,
  text: string,
): Message {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
  } as Message;
}

describe("computeRunPruneStats", () => {
  test("returns zeros for an empty branch", () => {
    const run = computeRunPruneStats([], "session-x", freshConfig());
    expect(run.tokens).toBe(0);
    expect(run.count).toBe(0);
  });

  test("runContextStrategies does not mutate caller messages", () => {
    const text = "a".repeat(40_000);
    const messages: Message[] = [
      assistantToolResult("t1", text),
      toolResultMessage("t1", "bash", text),
    ];
    const before = JSON.stringify(messages);
    const { prunedCount } = runContextStrategies(
      messages,
      "session-y",
      freshConfig(),
    );
    expect(JSON.stringify(messages)).toBe(before);
    expect(prunedCount).toBeGreaterThanOrEqual(0);
  });

  test("runContextStrategies does not mutate nested tool-call arguments or tool-result content", () => {
    const cfg = freshConfig();
    cfg.compress.protectedTools = [];
    const asst: Message = assistantMessage([
      {
        type: "toolCall",
        id: "t1",
        name: "bash",
        arguments: { command: "ls", cwd: "/tmp" },
      },
    ]);
    const result: Message = toolResultMessage("t1", "bash", "x".repeat(1000));
    const asstArgsBefore = JSON.parse(
      JSON.stringify((asst as AssistantMessage).content[0]),
    );
    const resultContentBefore = JSON.parse(
      JSON.stringify((result as { content: unknown }).content),
    );
    runContextStrategies([asst, result], "session-m", cfg);
    expect(
      JSON.parse(
        JSON.stringify((asst as AssistantMessage).content[0]),
      ),
    ).toEqual(asstArgsBefore);
    expect(
      JSON.parse(JSON.stringify((result as { content: unknown }).content)),
    ).toEqual(resultContentBefore);
  });

});
