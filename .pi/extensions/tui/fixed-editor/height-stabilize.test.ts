import { describe, it, expect } from "bun:test";
import {
  createHeightStabilizeState,
  suppressClusterDrivenHeightChange,
  type PiTuiHeightFields,
} from "./height-stabilize.ts";

describe("suppressClusterDrivenHeightChange", () => {
  it("does not suppress on first observation / real terminal resize", () => {
    const state = createHeightStabilizeState();
    const tui: PiTuiHeightFields = {
      previousHeight: 40,
      previousLines: Array.from({ length: 40 }, (_, i) => `L${i}`),
      previousViewportTop: 0,
    };

    // First call always tracks rawRows and does not suppress.
    expect(suppressClusterDrivenHeightChange(state, tui, 50, 40)).toBe(false);
    expect(tui.previousHeight).toBe(40);

    // Real terminal resize (rawRows changed) must not suppress.
    expect(suppressClusterDrivenHeightChange(state, tui, 60, 50)).toBe(false);
    expect(tui.previousHeight).toBe(40);
  });

  it("suppresses cluster growth so pi-tui will not full-clear", () => {
    const state = createHeightStabilizeState();
    const lines = Array.from({ length: 40 }, (_, i) => `L${i}`);
    const tui: PiTuiHeightFields = {
      previousHeight: 40,
      previousLines: lines,
      previousViewportTop: 0,
    };

    // Establish baseline rawRows.
    expect(suppressClusterDrivenHeightChange(state, tui, 50, 40)).toBe(false);

    // Slash autocomplete grows cluster: scrollable 40 → 30, rawRows still 50.
    expect(suppressClusterDrivenHeightChange(state, tui, 50, 30)).toBe(true);
    expect(tui.previousHeight).toBe(30);
    expect(tui.previousViewportTop).toBe(0);
    // Bottom of previous window preserved for better differential match at offset=0.
    expect(tui.previousLines).toEqual(lines.slice(-30));
  });

  it("suppresses cluster shrink without truncating shorter previousLines", () => {
    const state = createHeightStabilizeState();
    const lines = Array.from({ length: 30 }, (_, i) => `L${i}`);
    const tui: PiTuiHeightFields = {
      previousHeight: 30,
      previousLines: lines,
      previousViewportTop: 0,
    };

    expect(suppressClusterDrivenHeightChange(state, tui, 50, 30)).toBe(false);
    // Autocomplete closes: scrollable 30 → 40.
    expect(suppressClusterDrivenHeightChange(state, tui, 50, 40)).toBe(true);
    expect(tui.previousHeight).toBe(40);
    expect(tui.previousLines).toEqual(lines);
  });

  it("no-ops when previousHeight already matches scrollableRows", () => {
    const state = createHeightStabilizeState();
    const tui: PiTuiHeightFields = {
      previousHeight: 35,
      previousLines: ["a", "b"],
    };
    expect(suppressClusterDrivenHeightChange(state, tui, 50, 35)).toBe(false);
    expect(suppressClusterDrivenHeightChange(state, tui, 50, 35)).toBe(false);
    expect(tui.previousHeight).toBe(35);
  });

  it("no-ops when previousHeight is 0 (first pi-tui frame)", () => {
    const state = createHeightStabilizeState();
    const tui: PiTuiHeightFields = { previousHeight: 0, previousLines: [] };
    expect(suppressClusterDrivenHeightChange(state, tui, 50, 40)).toBe(false);
    expect(suppressClusterDrivenHeightChange(state, tui, 50, 30)).toBe(false);
    expect(tui.previousHeight).toBe(0);
  });
});
