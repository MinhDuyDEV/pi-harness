import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultFooterState, createFooterRenderer } from "../footer.js";
import {
  editorBorderColorForThinkingLevel,
  editorPromptForState,
  streamingPromptFramesForThinkingLevel,
} from "../editor-prompt.js";
import { displayedTurnUsage, restoreUsageSnapshotFromBranch } from "../usage.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function renderFooter(state = createDefaultFooterState(), width = 160): string {
  return createFooterRenderer(state)({ requestRender() {} } as any, plainTheme as any).render(width).at(-1) ?? "";
}

test("footer renders visible icon turn stats by default", () => {
  const state = createDefaultFooterState();
  state.modelLabel = "model";

  const line = renderFooter(state, 120);

  assert.match(line, /󰁝 0 · 󰁅 0 · 󰆼 0\/0/);
  assert.doesNotMatch(line, / 0\.0s|\bin 0\b|\bout 0\b|\bcache 0\/0\b|\bturn 0\.0s\b/);
});

test("footer does not render a duplicate custom streaming indicator", () => {
  const state = createDefaultFooterState();
  state.modelLabel = "model";
  state.isStreaming = true;

  const line = renderFooter(state, 120);

  assert.doesNotMatch(line, /⠼ Crunching tokens\.\.\./);
  assert.match(line, /model/);
});


test("editor prompt keeps glyph stable and only changes by state/color", () => {
  assert.equal(
    editorPromptForState({ isShell: false, streamingPrompt: null, thinkingLevel: "medium" }),
    " ",
  );
  assert.equal(
    editorPromptForState({ isShell: false, streamingPrompt: null, thinkingLevel: "high" }),
    " ",
  );
  assert.equal(
    editorPromptForState({ isShell: false, streamingPrompt: null, thinkingLevel: "off" }),
    " ",
  );
  assert.equal(
    editorPromptForState({ isShell: false, streamingPrompt: "≈", thinkingLevel: "high" }),
    "≈ ",
  );
  assert.equal(
    editorPromptForState({ isShell: true, streamingPrompt: "≈", thinkingLevel: "high" }),
    "$ ",
  );
  assert.equal(editorBorderColorForThinkingLevel("off"), "thinkingOff");
  assert.equal(editorBorderColorForThinkingLevel("xhigh"), "thinkingXhigh");
  assert.deepEqual(streamingPromptFramesForThinkingLevel("low"), ["-", "~", "-"]);
});

test("turn usage display keeps previous turn until current turn usage arrives", () => {
  const previous = { input: 786, output: 438, cacheRead: 138_800, cacheWrite: 0, total: 1_224 };
  const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const live = { input: 900, output: 12, cacheRead: 140_000, cacheWrite: 0, total: 912 };

  assert.deepEqual(displayedTurnUsage(previous, empty, empty), previous);
  assert.deepEqual(displayedTurnUsage(previous, empty, live), live);
});

test("footer renders latest turn stats plus context and cost", () => {
  const state = createDefaultFooterState();
  state.modelLabel = "model";
  state.turnElapsed = 5300;
  state.turnInputTokens = 117_700;
  state.turnOutputTokens = 12_345;
  state.turnCacheReadTokens = 4_567;
  state.turnCacheWriteTokens = 89;
  state.tokenCount = 250_240;
  state.contextWindow = 272_000;
  state.totalCostUsd = 0.03;

  const line = renderFooter(state, 160);

  assert.match(line, /󰁝 117\.7K · 󰁅 12\.3K · 󰆼 4\.6K\/89 ·  5\.3s/);
  assert.match(line, /272\.0K \(92\.0%\) · \$0\.03/);
});

test("restoreUsageSnapshotFromBranch reconstructs last turn usage and total session cost", () => {
  const snapshot = restoreUsageSnapshotFromBranch([
    { type: "message", timestamp: "2026-06-03T00:00:00.000Z", message: { role: "user" } },
    {
      type: "message",
      timestamp: "2026-06-03T00:00:05.000Z",
      message: {
        role: "assistant",
        usage: {
          input: 100_000,
          output: 10_000,
          cacheRead: 1_000,
          cacheWrite: 100,
          totalTokens: 110_000,
          cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.002, total: 0 },
        },
      },
    },
    { type: "message", timestamp: "2026-06-03T00:01:00.000Z", message: { role: "user" } },
    {
      type: "message",
      timestamp: "2026-06-03T00:01:12.000Z",
      message: {
        role: "assistant",
        usage: {
          input: 117_700,
          output: 12_345,
          cacheRead: 4_567,
          cacheWrite: 89,
          totalTokens: 130_045,
          cost: { total: 0.03 },
        },
      },
    },
  ]);

  assert.deepEqual(snapshot.lastTurn, {
    input: 117_700,
    output: 12_345,
    cacheRead: 4_567,
    cacheWrite: 89,
    total: 130_045,
  });
  assert.equal(snapshot.elapsedMs, 12_000);
  assert.equal(snapshot.totalCostUsd, 0.063);
});

test("footer preserves a valid TUI attachment when a later render lacks one", () => {
  const state = createDefaultFooterState();
  const attachedTui = { requestRender() {} };
  const renderer = createFooterRenderer(state);

  renderer(attachedTui as any, plainTheme as any).render(80);
  renderer(undefined as any, plainTheme as any).render(80);

  assert.equal(state.tui, attachedTui);
});
