import assert from "node:assert/strict";
import test from "node:test";

import {
  findRenderableContainerWithChild,
  isRenderable,
} from "../render-tree.js";

test("finds the renderable container that owns the editor", () => {
  const editor = { render: () => ["editor"] };
  const editorContainer = {
    children: [editor],
    render: () => ["editor-container"],
  };
  const tui = {
    children: [
      { children: [], render: () => ["header"] },
      editorContainer,
      { children: [], render: () => ["footer"] },
    ],
  };

  assert.deepEqual(findRenderableContainerWithChild(tui, editor), {
    container: editorContainer,
    index: 1,
  });
});

test("rejects a matching container that Pi cannot render", () => {
  const editor = { render: () => ["editor"] };
  const tui = { children: [{ children: [editor] }] };

  assert.equal(findRenderableContainerWithChild(tui, editor), null);
});

test("returns null when the editor or TUI children are absent", () => {
  const editor = { render: () => ["editor"] };

  assert.equal(findRenderableContainerWithChild({ children: [] }, editor), null);
  assert.equal(findRenderableContainerWithChild({}, editor), null);
  assert.equal(findRenderableContainerWithChild(null, editor), null);
});

test("isRenderable requires a render function", () => {
  assert.equal(isRenderable({ render: () => [] }), true);
  assert.equal(isRenderable({ render: "not-a-function" }), false);
  assert.equal(isRenderable(null), false);
});
