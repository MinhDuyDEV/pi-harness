import { describe, it, expect } from "bun:test";
import {
  createScrollState,
  scrollBy,
  scrollTo,
  scrollIntoView,
  updateAfterRender,
  updateViewport,
  isAtBottom,
  firstVisibleLine,
  lastVisibleLine,
  scrollbarGeometry,
  scrollOffsetForRow,
  clipToViewport,
  wheelToScrollOffset,
} from "./scroll-state.ts";

describe("createScrollState", () => {
  it("creates a state with defaults", () => {
    const s = createScrollState();
    expect(s.offset).toBe(0);
    expect(s.maxOffset).toBe(0);
    expect(s.totalLines).toBe(0);
    expect(s.viewportRows).toBe(0);
  });

  it("accepts initial viewportRows", () => {
    const s = createScrollState(20);
    expect(s.viewportRows).toBe(20);
  });

  it("creates a fresh copy each time", () => {
    const a = createScrollState(20);
    const b = createScrollState(20);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("scrollBy", () => {
  it("returns same object for zero delta", () => {
    const s = createScrollState(20);
    s.maxOffset = 50; // bypass frozen for test setup
    const next = scrollBy(s, 0);
    expect(next).toBe(s);
  });

  it("scrolls up (positive delta)", () => {
    const s = { ...createScrollState(20), offset: 0, maxOffset: 50, totalLines: 70 };
    const next = scrollBy(s, 10);
    expect(next.offset).toBe(10);
    expect(next).not.toBe(s);
  });

  it("scrolls down (negative delta)", () => {
    const s = { ...createScrollState(20), offset: 30, maxOffset: 50, totalLines: 70 };
    const next = scrollBy(s, -10);
    expect(next.offset).toBe(20);
  });

  it("clamps to maxOffset", () => {
    const s = { ...createScrollState(20), offset: 45, maxOffset: 50, totalLines: 70 };
    const next = scrollBy(s, 20);
    expect(next.offset).toBe(50);
  });

  it("clamps to 0", () => {
    const s = { ...createScrollState(20), offset: 5, maxOffset: 50, totalLines: 70 };
    const next = scrollBy(s, -20);
    expect(next.offset).toBe(0);
  });

  it("returns same object when clamped to current value", () => {
    const s = { ...createScrollState(20), offset: 0, maxOffset: 50, totalLines: 70 };
    const next = scrollBy(s, -10);
    expect(next).toBe(s);
  });
});

describe("scrollTo", () => {
  it("scrolls to a specific offset", () => {
    const s = { ...createScrollState(20), offset: 0, maxOffset: 50, totalLines: 70 };
    const next = scrollTo(s, 25);
    expect(next.offset).toBe(25);
  });

  it("clamps to maxOffset", () => {
    const s = { ...createScrollState(20), offset: 0, maxOffset: 50, totalLines: 70 };
    expect(scrollTo(s, 100).offset).toBe(50);
  });

  it("clamps to 0", () => {
    const s = { ...createScrollState(20), offset: 25, maxOffset: 50, totalLines: 70 };
    expect(scrollTo(s, -10).offset).toBe(0);
  });

  it("returns same object when already at target", () => {
    const s = { ...createScrollState(20), offset: 25, maxOffset: 50, totalLines: 70 };
    expect(scrollTo(s, 25)).toBe(s);
  });
});

describe("scrollIntoView", () => {
  it("does nothing if line is already visible", () => {
    // totalLines=70, viewportRows=20, offset=10
    // visible window: lines [40, 60)
    const s = { ...createScrollState(20), offset: 10, maxOffset: 50, totalLines: 70 };
    expect(scrollIntoView(s, 45)).toBe(s);
  });

  it("scrolls up if line is above visible area", () => {
    const s = { ...createScrollState(20), offset: 10, maxOffset: 50, totalLines: 70 };
    // visible: [40, 60). line 30 is above
    const next = scrollIntoView(s, 30);
    expect(next.offset).toBeGreaterThan(10);
  });

  it("scrolls down if line is below visible area", () => {
    const s = { ...createScrollState(20), offset: 10, maxOffset: 50, totalLines: 70 };
    // visible: [40, 60). line 65 is below
    const next = scrollIntoView(s, 65);
    expect(next.offset).toBeLessThan(10);
  });
});

describe("updateAfterRender", () => {
  it("auto-scrolls to bottom when user is at bottom", () => {
    const s = { ...createScrollState(20), offset: 0, maxOffset: 50, totalLines: 70 };
    const next = updateAfterRender(s, 80, 20, true);
    expect(next.offset).toBe(0);
    expect(next.maxOffset).toBe(60);
    expect(next.totalLines).toBe(80);
  });

  it("pushes offset when content grows above viewport", () => {
    const s = { ...createScrollState(20), offset: 10, maxOffset: 50, totalLines: 70 };
    const next = updateAfterRender(s, 80, 20, false);
    // content grew by 10 lines, offset should increase by 10
    expect(next.offset).toBe(20);
    expect(next.maxOffset).toBe(60);
  });

  it("clamps offset when maxOffset shrinks", () => {
    const s = { ...createScrollState(20), offset: 40, maxOffset: 50, totalLines: 70 };
    const next = updateAfterRender(s, 50, 20, false);
    expect(next.maxOffset).toBe(30);
    expect(next.offset).toBe(30);
  });
});

describe("updateViewport", () => {
  it("updates viewport and clamps offset", () => {
    const s = { ...createScrollState(20), offset: 30, maxOffset: 50, totalLines: 70 };
    const next = updateViewport(s, 30);
    expect(next.viewportRows).toBe(30);
    expect(next.maxOffset).toBe(40);
    expect(next.offset).toBe(30);
  });

  it("clamps offset when new viewport is smaller", () => {
    const s = { ...createScrollState(30), offset: 45, maxOffset: 40, totalLines: 70 };
    // maxOffset was 40, new maxOffset = 70-10 = 60, so offset 45 stays
    const next = updateViewport(s, 10);
    expect(next.offset).toBe(45);
    expect(next.maxOffset).toBe(60);
  });

  it("returns same object when viewport unchanged", () => {
    const s = { ...createScrollState(20), offset: 10, maxOffset: 50, totalLines: 70 };
    expect(updateViewport(s, 20)).toBe(s);
  });
});

describe("isAtBottom", () => {
  it("returns true when offset is 0", () => {
    expect(isAtBottom({ ...createScrollState(), offset: 0, maxOffset: 50, totalLines: 70, viewportRows: 20 })).toBe(true);
  });

  it("returns true when offset is negative (clamped edge)", () => {
    expect(isAtBottom({ ...createScrollState(), offset: -1, maxOffset: 50, totalLines: 70, viewportRows: 20 })).toBe(true);
  });

  it("returns false when scrolled up", () => {
    expect(isAtBottom({ ...createScrollState(), offset: 10, maxOffset: 50, totalLines: 70, viewportRows: 20 })).toBe(false);
  });
});

describe("firstVisibleLine / lastVisibleLine", () => {
  it("computes correctly for scrolled state", () => {
    const s = { ...createScrollState(20), offset: 10, maxOffset: 50, totalLines: 70, viewportRows: 20 };
    expect(firstVisibleLine(s)).toBe(40);
    expect(lastVisibleLine(s)).toBe(60);
  });

  it("is 0 when at bottom", () => {
    const s = { ...createScrollState(20), offset: 0, maxOffset: 50, totalLines: 70, viewportRows: 20 };
    expect(firstVisibleLine(s)).toBe(50);
    expect(lastVisibleLine(s)).toBe(70);
  });
});

describe("scrollbarGeometry", () => {
  it("returns null when no scrolling is needed", () => {
    const s = { ...createScrollState(20), offset: 0, maxOffset: 0, totalLines: 15, viewportRows: 20 };
    expect(scrollbarGeometry(s, 20)).toBeNull();
  });

  it("returns correct geometry for a scrolled state", () => {
    const s = { ...createScrollState(20), offset: 25, maxOffset: 50, totalLines: 70, viewportRows: 20 };
    const g = scrollbarGeometry(s, 20);
    expect(g).not.toBeNull();
    expect(g!.height).toBeGreaterThanOrEqual(1);
    expect(g!.start).toBeGreaterThanOrEqual(0);
    expect(g!.start + g!.height).toBeLessThanOrEqual(g!.trackRows);
  });
});

describe("scrollOffsetForRow", () => {
  it("maps scrollbar rows to offsets", () => {
    const s = { ...createScrollState(20), offset: 0, maxOffset: 50, totalLines: 70, viewportRows: 20 };
    const offset = scrollOffsetForRow(s, 10, 20);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThanOrEqual(50);
  });
});

describe("clipToViewport", () => {
  it("returns null for off-screen lines", () => {
    const s = { ...createScrollState(20), offset: 10, maxOffset: 50, totalLines: 70, viewportRows: 20 };
    // visible: [40, 60)
    expect(clipToViewport(s, 30)).toBeNull();
    expect(clipToViewport(s, 65)).toBeNull();
  });

  it("returns 0-based viewport row for visible lines", () => {
    const s = { ...createScrollState(20), offset: 10, maxOffset: 50, totalLines: 70, viewportRows: 20 };
    // line 45 → row 5 (45-40)
    expect(clipToViewport(s, 45)).toBe(5);
  });
});

describe("wheelToScrollOffset", () => {
  it("computes scroll delta from speed", () => {
    // High scroll speed = more lines per tick, but floored at 1
    expect(wheelToScrollOffset(1)).toBeGreaterThanOrEqual(3);
    expect(wheelToScrollOffset(4)).toBeGreaterThanOrEqual(12);
  });
});
