import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasOpenTodos, renderTodosWidget, scanTodos, type TodosState } from "../todos-panel.js";

const markedTheme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function renderTodos(state: TodosState, width = 120): string[] {
  return renderTodosWidget(state, {} as any, markedTheme as any)
    .render(width)
    .map((line) => line.trimEnd());
}

test("scanTodos finds artifacts when Pi is launched from the .pi directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-todos-scan-"));
  try {
    const piDir = join(dir, ".pi");
    const planDir = join(piDir, "artifacts", "example");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "TODO.md"), "- [ ] Visible from dot-pi cwd\n- [x] Done item\n");

    const state = scanTodos(piDir);

    assert.equal(state.sourceCount, 1);
    assert.deepEqual(state.items.map((item) => ({ text: item.text, done: item.done })), [
      { text: "Visible from dot-pi cwd", done: false },
      { text: "Done item", done: true },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanTodos tracks only the current artifact TODO when launched inside an artifact", () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-todos-active-artifact-"));
  try {
    const piDir = join(dir, ".pi");
    const activeDir = join(piDir, "artifacts", "active", "notes");
    const oldDir = join(piDir, "artifacts", "old");
    mkdirSync(activeDir, { recursive: true });
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(piDir, "artifacts", "active", "TODO.md"), "- [ ] Active task\n");
    writeFileSync(join(oldDir, "TODO.md"), "- [ ] Old task\n");

    const state = scanTodos(activeDir);

    assert.equal(state.sourceCount, 1);
    assert.deepEqual(state.items.map((item) => item.text), ["Active task"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanTodos falls back to the most recently changed artifact TODO from .pi cwd", () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-todos-latest-artifact-"));
  try {
    const piDir = join(dir, ".pi");
    const oldDir = join(piDir, "artifacts", "old");
    const latestDir = join(piDir, "artifacts", "latest");
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(latestDir, { recursive: true });
    const oldTodo = join(oldDir, "TODO.md");
    const latestTodo = join(latestDir, "TODO.md");
    writeFileSync(oldTodo, "- [ ] Old task\n");
    writeFileSync(latestTodo, "- [ ] Latest task\n");
    utimesSync(oldTodo, new Date("2024-01-01T00:00:00Z"), new Date("2024-01-01T00:00:00Z"));
    utimesSync(latestTodo, new Date("2024-02-01T00:00:00Z"), new Date("2024-02-01T00:00:00Z"));

    const state = scanTodos(piDir);

    assert.equal(state.sourceCount, 1);
    assert.deepEqual(state.items.map((item) => item.text), ["Latest task"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasOpenTodos is false when every parsed task is complete", () => {
  assert.equal(hasOpenTodos({ sourceCount: 1, items: [{ text: "Finished", done: true, sourceFile: "TODO.md" }] }), false);
  assert.equal(hasOpenTodos({ sourceCount: 1, items: [{ text: "Open", done: false, sourceFile: "TODO.md" }] }), true);
});

test("todos widget renders missing TODO.md empty state", () => {
  assert.deepEqual(renderTodos({ items: [], sourceCount: 0 }), [
    " <muted>TODOs — No TODO.md files found in .pi/artifacts/</muted>",
  ]);
});

test("todos widget renders all-done state when source files have no open items", () => {
  assert.deepEqual(renderTodos({ items: [], sourceCount: 2 }), [
    " <muted>TODOs — 2 file(s), all done</muted>",
  ]);
});

test("todos widget renders only open checklist items", () => {
  const lines = renderTodos({
    sourceCount: 1,
    items: [
      { text: "Ship footer metrics", done: false, sourceFile: "/tmp/TODO.md" },
      { text: "Document restore behavior", done: true, sourceFile: "/tmp/TODO.md" },
    ],
  });

  assert.deepEqual(lines, [
    " TODOs — 1 file(s):",
    "   <warning>☐</warning> Ship footer metrics",
    "",
  ]);
});
