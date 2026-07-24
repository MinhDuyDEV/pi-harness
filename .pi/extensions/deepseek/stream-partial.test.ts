import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context, Model } from "@earendil-works/pi-ai";
import {
  appendThinkingDelta,
  appendToolDelta,
  createDeepseekPartialState,
} from "./partial.js";
import { deepseekStreamSimple } from "./stream.js";

const model: Model<"openai-completions"> = {
  id: "deepseek-chat",
  name: "DeepSeek Chat",
  api: "openai-completions",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

const context: Context = {
  messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};

test("DeepSeek partial snapshots accumulate thinking and tool state", () => {
  const state = createDeepseekPartialState(model);
  const firstThinking = appendThinkingDelta(state, "plan");
  const secondThinking = appendThinkingDelta(state, " more");
  const tool = appendToolDelta(state, 0, "call-1", "search");

  assert.deepEqual(firstThinking.partial.content, [{ type: "thinking", thinking: "plan" }]);
  assert.deepEqual(secondThinking.partial.content, [{ type: "thinking", thinking: "plan more" }]);
  assert.equal(tool.contentIndex, 1);
  assert.deepEqual(tool.partial.content, [
    { type: "thinking", thinking: "plan more" },
    { type: "toolCall", id: "call-1", name: "search", arguments: {} },
  ]);
});

test("DeepSeek text deltas carry cumulative partial content", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const body = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"lo"}}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  globalThis.fetch = Object.assign(
    async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    { preconnect: () => undefined },
  );
  process.env.DEEPSEEK_API_KEY = "test-key";

  try {
    const events = [];
    for await (const event of deepseekStreamSimple(model, context)) events.push(event);
    const deltas = events.filter((event) => event.type === "text_delta");
    assert.equal(deltas.length, 2);
    assert.deepEqual(deltas.map((event) => event.partial.content), [
      [{ type: "text", text: "Hel" }],
      [{ type: "text", text: "Hello" }],
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test("DeepSeek reasoning and tool deltas carry cumulative partial content", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const body = [
    'data: {"choices":[{"delta":{"reasoning_content":"plan"}}]}',
    "",
    'data: {"choices":[{"delta":{"reasoning_content":" more"}}]}',
    "",
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"sea","arguments":"{\\"q\\":\\""}}]}}]}',
    "",
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"rch","arguments":"world\\"}"}}]}}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  globalThis.fetch = Object.assign(
    async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    { preconnect: () => undefined },
  );
  process.env.DEEPSEEK_API_KEY = "test-key";

  try {
    const events = [];
    for await (const event of deepseekStreamSimple(model, context)) events.push(event);

    const thinkingDeltas = events.filter((event) => event.type === "thinking_delta");
    assert.deepEqual(thinkingDeltas.map((event) => event.partial.content), [
      [{ type: "thinking", thinking: "plan" }],
      [{ type: "thinking", thinking: "plan more" }],
    ]);

    const toolDeltas = events.filter((event) => event.type === "toolcall_delta");
    assert.deepEqual(toolDeltas.map((event) => ({
      contentIndex: event.contentIndex,
      content: event.partial.content,
    })), [
      {
        contentIndex: 1,
        content: [
          { type: "thinking", thinking: "plan more" },
          { type: "toolCall", id: "call-1", name: "sea", arguments: {} },
        ],
      },
      {
        contentIndex: 1,
        content: [
          { type: "thinking", thinking: "plan more" },
          { type: "toolCall", id: "call-1", name: "search", arguments: {} },
        ],
      },
    ]);

    const toolEnd = events.find((event) => event.type === "toolcall_end");
    assert.deepEqual(toolEnd?.toolCall, {
      type: "toolCall",
      id: "call-1",
      name: "search",
      arguments: { q: "world" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});
