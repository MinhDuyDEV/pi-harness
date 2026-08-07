import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "./config.ts";
import {
  buildContinuationPrompt,
  registerCompactionContinuation,
  shouldResumeCompaction,
} from "./compaction-continuation.ts";

type Handler = (event: any, ctx: any) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler>();
  const messages: Array<{ content: string; options?: { deliverAs?: string } }> = [];
  return {
    pi: {
      on(name: string, handler: Handler) {
        handlers.set(name, handler);
      },
      async sendUserMessage(content: string, options?: { deliverAs?: string }) {
        messages.push({ content, options });
      },
    } as unknown as ExtensionAPI,
    handlers,
    messages,
  };
}

const ctx = (idle = true) => ({ isIdle: () => idle });
const compact = (reason: string, willRetry = false, id = reason) => ({
  reason,
  willRetry,
  compactionEntry: { id },
});

test("continuation is enabled by default", () => {
  assert.equal(DEFAULT_CONFIG.continuation.enabled, true);
});

test("resume decision avoids native retry and threshold continuation loops", () => {
  assert.equal(shouldResumeCompaction({ reason: "overflow", willRetry: true }, false), false);
  assert.equal(shouldResumeCompaction({ reason: "threshold", willRetry: false }, true), false);
  assert.equal(shouldResumeCompaction({ reason: "manual", willRetry: false }, true), true);
  assert.equal(shouldResumeCompaction({ reason: "overflow", willRetry: false }, true), true);
  assert.equal(shouldResumeCompaction({ reason: "threshold", willRetry: false }, false), true);
});

test("prompt trusts the compacted state and names DCP recall without rereading raw JSONL", () => {
  const prompt = buildContinuationPrompt("entry-1");
  assert.match(prompt, /resume the existing task/i);
  assert.match(prompt, /dcp_recall/);
  assert.doesNotMatch(prompt, /JSONL|session file/i);
});

test("continuations coalesce, use followUp while busy, and clear after settle", async () => {
  const { pi, handlers, messages } = fakePi();
  registerCompactionContinuation(pi, { enabled: true, delayMs: 0 });

  handlers.get("session_compact")?.(compact("threshold", false, "old"), ctx(false));
  handlers.get("session_compact")?.(compact("manual", false, "new"), ctx(false));
  await wait(5);
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /new/);
  assert.deepEqual(messages[0].options, { deliverAs: "followUp" });

  handlers.get("session_compact")?.(compact("threshold", false, "loop"), ctx());
  await wait(5);
  assert.equal(messages.length, 1, "inflight threshold compaction must not loop");

  handlers.get("agent_settled")?.({}, ctx());
  handlers.get("session_compact")?.(compact("threshold", false, "fresh"), ctx());
  await wait(5);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].options, undefined);
});

test("native retry and shutdown never deliver a continuation", async () => {
  const { pi, handlers, messages } = fakePi();
  registerCompactionContinuation(pi, { enabled: true, delayMs: 5 });

  handlers.get("session_compact")?.(compact("overflow", true), ctx());
  handlers.get("session_compact")?.(compact("manual", false), ctx());
  handlers.get("session_shutdown")?.({}, ctx());
  await wait(10);
  assert.deepEqual(messages, []);
});
