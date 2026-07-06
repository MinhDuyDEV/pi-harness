import { describe, it, expect } from "bun:test";
import {
  createSelectionState,
  beginSelection,
  extendSelection,
  finishSelection,
  clearSelection,
  getSelectionRangeForLine,
  isInSelection,
  getSelectionText,
  renderHighlightOnLine,
  wordRangeAtColumn,
} from "./selection-state.ts";
import type { SelectionState } from "./selection-state.ts";

// Simple ANSI strip for testing
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[\d;]*[a-zA-Z]/g, "");
}

// Column slice (simple: treat each char as 1 column)
function sliceColumns(s: string, start: number, end?: number): string {
  if (end === undefined || end === Number.POSITIVE_INFINITY) return s.slice(start);
  return s.slice(start, end);
}

describe("createSelectionState", () => {
  it("creates an empty selection state", () => {
    const s = createSelectionState();
    expect(s.area).toBeNull();
    expect(s.anchor).toBeNull();
    expect(s.focus).toBeNull();
    expect(s.highlightVisible).toBe(false);
    expect(s.dragging).toBe(false);
    expect(s.doubleClickLine).toBeNull();
  });
});

describe("beginSelection", () => {
  it("starts a selection at a point", () => {
    const s = createSelectionState();
    const next = beginSelection(s, "root", { line: 5, col: 3 }, false);
    expect(next.area).toBe("root");
    expect(next.anchor).toEqual({ line: 5, col: 3 });
    expect(next.focus).toEqual({ line: 5, col: 3 });
    expect(next.highlightVisible).toBe(true);
    expect(next.dragging).toBe(true);
    expect(next.doubleClickLine).toBeNull();
  });

  it("starts a full-line selection on double-click", () => {
    const s = createSelectionState();
    const next = beginSelection(s, "cluster", { line: 3, col: 7 }, true);
    expect(next.area).toBe("cluster");
    expect(next.anchor).toEqual({ line: 3, col: 0 });
    expect(next.focus).toEqual({ line: 3, col: Number.POSITIVE_INFINITY });
    expect(next.dragging).toBe(true);
    expect(next.doubleClickLine).toBe(3);
  });
});

describe("extendSelection", () => {
  it("extends the selection", () => {
    const s = beginSelection(createSelectionState(), "root", { line: 0, col: 0 }, false);
    const next = extendSelection(s, { line: 3, col: 10 });
    expect(next.focus).toEqual({ line: 3, col: 10 });
    expect(next.anchor).toEqual({ line: 0, col: 0 });
  });

  it("allows extending above the anchor", () => {
    const s = beginSelection(createSelectionState(), "root", { line: 5, col: 10 }, false);
    const next = extendSelection(s, { line: 2, col: 3 });
    // Ordered: start should be (2, 3), end should be (5, 10)
    expect(next.focus).toEqual({ line: 2, col: 3 });
    expect(next.anchor).toEqual({ line: 5, col: 10 });
  });

  it("is no-op if not dragging", () => {
    const s = { ...createSelectionState(), area: null, dragging: false } as SelectionState;
    const next = extendSelection(s, { line: 3, col: 3 });
    expect(next).toBe(s);
  });
});

describe("finishSelection", () => {
  it("preserves a non-empty selection with highlight off", () => {
    const started = beginSelection(createSelectionState(), "root", { line: 0, col: 0 }, false);
    const extended = extendSelection(started, { line: 3, col: 10 });
    const next = finishSelection(extended);
    expect(next.dragging).toBe(false);
    expect(next.highlightVisible).toBe(false);
    expect(next.anchor).toEqual({ line: 0, col: 0 });
    expect(next.focus).toEqual({ line: 3, col: 10 });
  });

  it("clears a zero-length selection", () => {
    const started = beginSelection(createSelectionState(), "root", { line: 5, col: 5 }, false);
    // No extend — anchor === focus
    const next = finishSelection(started);
    expect(next.anchor).toBeNull();
    expect(next.focus).toBeNull();
    expect(next.area).toBeNull();
  });
});

describe("clearSelection", () => {
  it("always returns a fresh empty state", () => {
    const s = clearSelection();
    expect(s.area).toBeNull();
    expect(s.anchor).toBeNull();
  });
});

describe("getSelectionRangeForLine", () => {
  it("returns null for non-selected area", () => {
    const s = beginSelection(createSelectionState(), "root", { line: 0, col: 0 }, false);
    expect(getSelectionRangeForLine(s, 5, "cluster")).toBeNull();
  });

  it("returns correct range for single line", () => {
    const s = extendSelection(
      beginSelection(createSelectionState(), "root", { line: 2, col: 3 }, false),
      { line: 2, col: 10 },
    );
    const rng = getSelectionRangeForLine(s, 2, "root");
    expect(rng).toEqual({ startCol: 3, endCol: 10 });
  });

  it("returns full-line range for start and end lines in multi-line selection", () => {
    const s = extendSelection(
      beginSelection(createSelectionState(), "root", { line: 1, col: 3 }, false),
      { line: 3, col: 7 },
    );
    expect(getSelectionRangeForLine(s, 1, "root")).toEqual({ startCol: 3, endCol: Number.POSITIVE_INFINITY });
    // Middle line: full width
    expect(getSelectionRangeForLine(s, 2, "root")).toEqual({ startCol: 0, endCol: Number.POSITIVE_INFINITY });
    // End line
    expect(getSelectionRangeForLine(s, 3, "root")).toEqual({ startCol: 0, endCol: 7 });
  });

  it("uses lineWidth when provided", () => {
    const s = extendSelection(
      beginSelection(createSelectionState(), "root", { line: 0, col: 3 }, false),
      { line: 0, col: 100 },
    );
    const rng = getSelectionRangeForLine(s, 0, "root", 80);
    expect(rng).toEqual({ startCol: 3, endCol: 80 });
  });
});

describe("isInSelection", () => {
  it("returns true for a point inside the selection", () => {
    const s = extendSelection(
      beginSelection(createSelectionState(), "root", { line: 2, col: 3 }, false),
      { line: 5, col: 10 },
    );
    expect(isInSelection(s, { line: 3, col: 5 }, "root")).toBe(true);
    expect(isInSelection(s, { line: 2, col: 5 }, "root")).toBe(true);
    expect(isInSelection(s, { line: 2, col: 3 }, "root")).toBe(true);
  });

  it("returns false for points outside", () => {
    const s = extendSelection(
      beginSelection(createSelectionState(), "root", { line: 2, col: 3 }, false),
      { line: 5, col: 10 },
    );
    expect(isInSelection(s, { line: 1, col: 5 }, "root")).toBe(false);
    expect(isInSelection(s, { line: 6, col: 5 }, "root")).toBe(false);
    expect(isInSelection(s, { line: 2, col: 2 }, "root")).toBe(false);
    expect(isInSelection(s, { line: 5, col: 10 }, "root")).toBe(false);
  });

  it("returns false for wrong area", () => {
    const s = beginSelection(createSelectionState(), "root", { line: 0, col: 0 }, false);
    expect(isInSelection(s, { line: 0, col: 0 }, "cluster")).toBe(false);
  });
});

describe("getSelectionText", () => {
  const mockLines: Record<string, string[]> = {
    root: ["line 0 abc", "line 1 def", "line 2 ghi"],
    cluster: ["prompt> ", "status"],
  };

  const getLine = (area: "root" | "cluster" | "sidebar", i: number) => mockLines[area]?.[i] ?? null;

  it("returns empty for no selection", () => {
    expect(getSelectionText(createSelectionState(), getLine, stripAnsi, sliceColumns)).toBe("");
  });

  it("extracts text from a single-line selection", () => {
    const s = extendSelection(
      beginSelection(createSelectionState(), "root", { line: 0, col: 2 }, false),
      { line: 0, col: 7 },
    );
    expect(getSelectionText(s, getLine, stripAnsi, sliceColumns)).toBe("ne 0");
      });

  it("extracts text from a multi-line selection", () => {
    const s = extendSelection(
      beginSelection(createSelectionState(), "root", { line: 0, col: 2 }, false),
      { line: 2, col: 4 },
    );
    const text = getSelectionText(s, getLine, stripAnsi, sliceColumns);
    expect(text).toBe("ne 0 abc\nline 1 def\nline");
  });
});

describe("renderHighlightOnLine", () => {
  it("returns line unchanged when no selection", () => {
    const s = createSelectionState();
    expect(renderHighlightOnLine("hello world", 0, "root", s, stripAnsi, sliceColumns)).toBe("hello world");
  });

  it("wraps selected portion in inverse video", () => {
    const s = extendSelection(
      beginSelection(createSelectionState(), "root", { line: 0, col: 2 }, false),
      { line: 0, col: 7 },
    );
    const rendered = renderHighlightOnLine("hello world", 0, "root", s, stripAnsi, sliceColumns);
    expect(rendered).toBe("he\x1b[7mllo w\x1b[27morld");
    // Inverse video actually toggled correctly
    const stripped = stripAnsi(rendered);
    expect(stripped).toBe("hello world");
  });

  it("handles full-line selection correctly", () => {
    const s = extendSelection(
      beginSelection(createSelectionState(), "root", { line: 0, col: 2 }, false),
      { line: 2, col: 4 },
    );
    // Line 1 (middle line) should have full-line highlight
    const rendered = renderHighlightOnLine("middle line", 1, "root", s, stripAnsi, sliceColumns);
    expect(rendered).toBe("\x1b[7mmiddle line\x1b[27m");
    expect(stripAnsi(rendered)).toBe("middle line");
  });
});

describe("wordRangeAtColumn", () => {
  it("finds word boundaries", () => {
    const rng = wordRangeAtColumn("hello world foo", 6);
    const text = "hello world foo".slice(rng.startCol, rng.endCol);
    expect(text).toBe("world");
  });

  it("handles leading edge of a word", () => {
    const rng = wordRangeAtColumn("hello world", 6); // 'w'
    expect("hello world".slice(rng.startCol, rng.endCol)).toBe("world");
  });

  it("handles trailing edge of a word", () => {
    const rng = wordRangeAtColumn("hello world", 10); // 'd'
    expect("hello world".slice(rng.startCol, rng.endCol)).toBe("world");
  });
});
