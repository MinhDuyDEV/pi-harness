import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hasOpenTodos, renderTodosWidget, scanTodos, type TodosState } from "../todos-panel.js";
import { findCanonicalTodo } from "../todos-panel.js";

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

test("findCanonicalTodo walks up to locate the canonical TODO.md", () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-todos-find-"));
  try {
    const artifactsDir = join(dir, ".pi", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    const todoPath = join(artifactsDir, "TODO.md");
    writeFileSync(todoPath, "### stub\nstatus: active\n");

    // From the project root
    assert.equal(findCanonicalTodo(dir), todoPath);
    // From a subdirectory — must walk up
    const subdir = join(dir, ".pi", "extensions", "tui");
    mkdirSync(subdir, { recursive: true });
    assert.equal(findCanonicalTodo(subdir), todoPath);
    // Outside the project — should return null
    const outside = mkdtempSync(join(tmpdir(), "tui-todos-outside-"));
    try {
      assert.equal(findCanonicalTodo(outside), null);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanTodos finds the canonical TODO.md from the project root", () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-todos-root-"));
  try {
    const artifactsDir = join(dir, ".pi", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      join(artifactsDir, "TODO.md"),
      `### 2026-06-23 - fix rate limit
status: active | updated: 2026-06-23

- [ ] Visible from project root
- [x] Done item
`,
    );

    const state = scanTodos(dir);

        assert.equal(state.sourceFile, join(dir, ".pi", "artifacts", "TODO.md"));
    assert.equal(state.sourceCount, 1);
    assert.deepEqual(
      state.items.map((item) => ({ text: item.text, done: item.done, block: item.blockTitle, status: item.status })),
      [
        { text: "Visible from project root", done: false, block: "2026-06-23 - fix rate limit", status: "active" },
        { text: "Done item", done: true, block: "2026-06-23 - fix rate limit", status: "active" },
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanTodos treats empty brackets `- []` as an open todo", () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-todos-empty-bracket-"));
  try {
    const artifactsDir = join(dir, ".pi", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      join(artifactsDir, "TODO.md"),
      "### 2026-06-29 - empty bracket regression\nstatus: active | updated: 2026-06-29\n\n- [] ship the widget\n",
    );
    const state = scanTodos(dir);
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].text, "ship the widget");
    assert.equal(state.items[0].done, false);
    assert.equal(state.items[0].blockTitle, "2026-06-29 - empty bracket regression");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanTodos parses multiple blocks with different statuses", () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-todos-multi-block-"));
  try {
    const artifactsDir = join(dir, ".pi", "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      join(artifactsDir, "TODO.md"),
      `### 2026-06-23 - active work
status: active | updated: 2026-06-23

- [ ] Open task

### 2026-06-22 - done work
status: done | updated: 2026-06-22

- [x] Done task
`,
    );

    const state = scanTodos(dir);

    assert.equal(state.items.length, 2);
    assert.deepEqual(
      state.items.map((item) => ({ text: item.text, done: item.done, block: item.blockTitle, status: item.status })),
      [
        { text: "Open task", done: false, block: "2026-06-23 - active work", status: "active" },
        { text: "Done task", done: true, block: "2026-06-22 - done work", status: "done" },
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanTodos walks up to find TODO.md when launched in a subdirectory", () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-todos-walkup-"));
  try {
    const artifactsDir = join(dir, ".pi", "artifacts");
    mkdirSync(join(artifactsDir, "nested", "deeper"), { recursive: true });
    writeFileSync(
      join(artifactsDir, "TODO.md"),
      `### 2026-06-23 - work
status: active | updated: 2026-06-23

- [ ] Found by walking up
`,
    );

    const deep = join(artifactsDir, "nested", "deeper");
    const state = scanTodos(deep);

    assert.equal(state.sourceFile, join(dir, ".pi", "artifacts", "TODO.md"));
    assert.equal(state.sourceCount, 1);
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].text, "Found by walking up");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanTodos returns empty state when no TODO.md is found", () => {
  const dir = mkdtempSync(join(tmpdir(), "tui-todos-empty-"));
  try {
    const state = scanTodos(dir);
    assert.equal(state.sourceFile, null);
    assert.equal(state.sourceCount, 0);
    assert.deepEqual(state.items, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasOpenTodos reflects only unchecked items", () => {
  assert.equal(
    hasOpenTodos({ sourceFile: "TODO.md", sourceCount: 1, items: [{ text: "Finished", done: true, blockTitle: null, status: null, sourceFile: "TODO.md" }] }),
    false,
  );
  assert.equal(
    hasOpenTodos({ sourceFile: "TODO.md", sourceCount: 1, items: [{ text: "Open", done: false, blockTitle: null, status: null, sourceFile: "TODO.md" }] }),
    true,
  );
});

test("todos widget renders missing TODO.md empty state", () => {
  assert.deepEqual(renderTodos({ sourceFile: null, sourceCount: 0, items: [] }), [
    " <muted>TODOs — No .pi/artifacts/TODO.md found</muted>",
  ]);
});

test("todos widget renders all-done state when no open items remain", () => {
  assert.deepEqual(renderTodos({ sourceFile: "TODO.md", sourceCount: 1, items: [] }), [
    " <muted>TODOs — all done</muted>",
  ]);
});

test("todos widget groups open items by work session block", () => {
  const lines = renderTodos({
    sourceFile: "TODO.md",
    sourceCount: 1,
    items: [
      {
        text: "Ship footer metrics",
        done: false,
        blockTitle: "2026-06-23 - ship footer",
        status: "active",
        sourceFile: "TODO.md",
      },
      {
        text: "Document restore behavior",
        done: true,
        blockTitle: "2026-06-23 - ship footer",
        status: "active",
        sourceFile: "TODO.md",
      },
      {
        text: "Pick a fix strategy",
        done: false,
        blockTitle: "2026-06-22 - rate limit",
        status: "active",
        sourceFile: "TODO.md",
      },
    ],
  });

  assert.deepEqual(lines, [
    " TODOs — 2 open across 2 block(s):",
    "   <accent>2026-06-23 - ship footer</accent>",
    "     <warning>☐</warning> Ship footer metrics",
    "   <accent>2026-06-22 - rate limit</accent>",
    "     <warning>☐</warning> Pick a fix strategy",
    "",
  ]);
});
