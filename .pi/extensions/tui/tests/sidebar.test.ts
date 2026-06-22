import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultSidebarState, renderSidebar, sidebarTotalWidth } from "../sidebar.js";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function plain(line: string): string {
  return line.replace(ANSI_RE, "");
}

test("sidebar stays disabled below configured width or when toggled off", () => {
  const state = createDefaultSidebarState();
  state.enabled = true;
  state.minTerminalWidth = 150;
  state.width = 30;

  assert.equal(sidebarTotalWidth(state, 120), 0);
  assert.equal(sidebarTotalWidth(state, 180), 54);

  state.enabled = false;
  assert.equal(sidebarTotalWidth(state, 180), 0);
});

test("sidebar omits the queue section when there is no pending queue", () => {
  const state = createDefaultSidebarState();
  state.enabled = true;
  state.modelLabel = "OpenAI / GPT-5.5";
  state.git = { branch: "main", staged: 0, unstaged: 0, untracked: 0 };
  state.cwd = `${process.env.HOME ?? "/Users/test"}/dev/projects/pikit/.pi`;
  state.piVersion = "1.2.3";

  const text = renderSidebar(state, 34, 18).map(plain).join("\n");

  assert.doesNotMatch(text, /Queue/);
  assert.doesNotMatch(text, /idle/);
  assert.doesNotMatch(text, /Git/);
  assert.doesNotMatch(text, /not a repo/);
});


test("sidebar omits the TODO section when all tracked tasks are complete", () => {
  const state = createDefaultSidebarState();
  state.enabled = true;
  state.modelLabel = "OpenAI / GPT-5.5";
      state.todos = {
        sourceFile: "TODO.md",
        sourceCount: 1,
            items: [{ text: "Finished", done: true, sourceFile: "TODO.md", blockTitle: null, status: null }],
      };
  state.git = { branch: "main", staged: 0, unstaged: 0, untracked: 0 };
  state.cwd = `${process.env.HOME ?? "/Users/test"}/dev/projects/pikit/.pi`;
  state.piVersion = "1.2.3";

  const text = renderSidebar(state, 34, 18).map(plain).join("\n");

  assert.doesNotMatch(text, /TODOs/);
  assert.doesNotMatch(text, /✓ all done/);
});


test("sidebar renders compact session todos queue and bottom identity rows", () => {
  const state = createDefaultSidebarState();
  state.enabled = true;
  state.modelLabel = "OpenAI / GPT-5.5";
  state.tokenCount = 117_700;
  state.contextWindow = 272_000;
  state.totalCostUsd = 0.03;
      state.todos = {
        sourceFile: "TODO.md",
        sourceCount: 1,
            items: [
          { text: "Verify TODO panel appears in the TUI", done: false, sourceFile: "TODO.md", blockTitle: null, status: null },
          { text: "Try checking this item manually", done: false, sourceFile: "TODO.md", blockTitle: null, status: null },
          { text: "Completed task", done: true, sourceFile: "TODO.md", blockTitle: null, status: null },
        ],
  };
  state.queue = { steerCount: 1, followUpCount: 2, hasPending: true };
  state.git = { branch: "main", staged: 1, unstaged: 2, untracked: 3 };
  const home = process.env.HOME ?? "/Users/test";
  state.cwd = `${home}/dev/projects/pikit/.pi`;
  state.piVersion = "1.2.3";

  const lines = renderSidebar(state, 34, 22);
  const text = lines.join("\n");

  assert.ok(lines.every((line) => !line.includes("│")), "sidebar has no left border");
  assert.ok(lines.every((line) => plain(line).startsWith("   ")), "sidebar content has left padding");
  assert.ok(lines.every((line) => !line.includes("<surface>")), "sidebar does not apply a background surface wrapper");
  assert.match(text, /\x1b\[97mSession\s+\x1b\[0m/);
  assert.match(text, /\x1b\[2mOpenAI \/ GPT-5\.5\s+\x1b\[0m/);
  assert.match(text, /117\.7K \(43\.3%\) · \$0\.03/);
  assert.match(text, /TODOs/);
  assert.match(text, /☐ Verify TODO panel appears/);
  assert.doesNotMatch(text, /Completed task/);
  assert.match(text, /1 steering/);
  assert.match(text, /2 follow-up/);
  assert.doesNotMatch(plain(text), /\n\s*Git\s*\n/);
  assert.doesNotMatch(text, /\x1b\[32m\+1\x1b\[0m \x1b\[31m-2\x1b\[0m \x1b\[33m\?3\x1b\[0m/);
  assert.doesNotMatch(text, /Resources|collapsed/);
  assert.match(plain(lines.at(-2) ?? ""), /~\/dev\/projects\/pikit\/\.pi:main\s*$/);
  assert.match(plain(lines.at(-1) ?? ""), /Pi 1\.2\.3\s*$/);
});
