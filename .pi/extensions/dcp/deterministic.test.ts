import { test, expect } from "bun:test";
import { buildDeterministicSummary } from "./deterministic";

test("deterministic compaction is stable across repeated runs", () => {
  const messages = [
    { role: "user", content: "Fix auth bug and update src/auth/session.ts" },
    {
      role: "assistant",
      content:
        "We should refresh token because password reset invalidates sessions.",
    },
    {
      role: "tool",
      name: "edit",
      input: { path: "src/auth/session.ts" },
      content: "updated",
    },
    { role: "assistant", content: "Next: run tests. No remaining blocker." },
  ];

  const first = buildDeterministicSummary({ messages }).summary;
  const second = buildDeterministicSummary({ messages }).summary;

  expect(second).toBe(first);
  expect(first).toContain("## Goal");
  expect(first).toContain("src/auth/session.ts");
  expect(first).toContain("because password reset invalidates sessions");
});

test("deterministic summary records compaction reason metadata", () => {
  const summary = buildDeterministicSummary({
    messages: [{ role: "user", content: "Continue deploying DCP" }],
    compactionReason: "overflow",
    willRetry: true,
    customInstructions: "focus on current deployment blocker",
  }).summary;

  expect(summary).toContain("Compaction metadata:");
  expect(summary).toContain("Reason: overflow");
  expect(summary).toContain("Pi will retry the interrupted turn");
  expect(summary).toContain(
    "Manual compact instructions: focus on current deployment blocker",
  );
});

test("deterministic summary is shorter than repeated noisy transcript", () => {
  const messages = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 === 0 ? "assistant" : "tool",
    name: index % 2 === 0 ? undefined : "bash",
    content: `large repeated output ${index} ${"x".repeat(200)}`,
  }));

  const summary = buildDeterministicSummary({ messages }).summary;
  const transcript = messages.map((message) => message.content).join("\n");

  expect(summary.length).toBeLessThan(transcript.length);
});
