import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractModel,
  extractProvider,
  fallbackUsageFromMessage,
  normalizeUsage,
} from "./normalize.js";

describe("usage normalization", () => {
  it("normalizes provider token and nested cost fields", () => {
    assert.deepEqual(normalizeUsage({
      input_tokens: 10,
      completion_tokens: 4,
      cache_read_tokens: 3,
      reasoning: 2,
      cost: { total: 0.25 },
    }), {
      input: 10,
      output: 4,
      cacheRead: 3,
      cacheWrite: 0,
      thinking: 2,
      cost: 0.25,
    });
  });

  it("estimates fallback usage from assistant text blocks", () => {
    assert.deepEqual(fallbackUsageFromMessage({
      content: [{ type: "text", text: "12345678" }, { type: "thinking", text: "ignored" }],
    }, 5), {
      input: 5,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      thinking: 0,
      cost: 0,
    });
  });

  it("splits provider-qualified model identifiers", () => {
    assert.equal(extractProvider("xai/grok-4"), "xai");
    assert.equal(extractModel("xai/grok-4"), "grok-4");
  });
});
