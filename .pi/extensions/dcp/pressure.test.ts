import { describe, it, expect } from "bun:test";
import { resolveAutoCompactThreshold, resolveContextPressure } from "./pressure";
import type { ContextMeterSnapshot } from "./context-meter";

function meter(partial: Partial<ContextMeterSnapshot>): ContextMeterSnapshot {
  return {
    branchTokens: 170_000,
    outboundTokens: 110_000,
    branchPercent: 85,
    outboundPercent: 55,
    contextWindow: 200_000,
    deltaTokens: 60_000,
    strippedByDcp: true,
    ...partial,
  };
}

describe("resolveContextPressure", () => {
  it("max: branch 85 outbound 55 — pressure 85 (would not arm if threshold 80 only when both matter)", () => {
    const p = resolveContextPressure(meter({}), "max");
    expect(p.percent).toBe(85);
    expect(p.source).toBe("branch");
  });

  it("max: branch 85 outbound 55 — outbound source stays 55 (no Zone 4 at 80%)", () => {
    const p = resolveContextPressure(meter({}), "outbound");
    expect(p.percent).toBe(55);
  });

  it("max after compress: low branch and outbound", () => {
    const p = resolveContextPressure(
      meter({
        branchPercent: 22,
        outboundPercent: 12,
        branchTokens: 44_000,
        outboundTokens: 24_000,
      }),
      "max",
    );
    expect(p.percent).toBe(22);
  });

  it("branch 85% outbound 82% max picks 85", () => {
    const p = resolveContextPressure(
      meter({ branchPercent: 85, outboundPercent: 82 }),
      "max",
    );
    expect(p.percent).toBe(85);
  });
});

describe("resolveAutoCompactThreshold", () => {
  it("uses thresholdRatio against the current context window", () => {
    const t = resolveAutoCompactThreshold(
      {
        enabled: true,
        thresholdPercent: 80,
        thresholdRatio: 0.72,
        invokeNativeCompact: true,
        pressureSource: "max",
      },
      300_000,
    );
    expect(t.percent).toBe(72);
    expect(t.tokens).toBe(216_000);
  });

  it("falls back to thresholdPercent when ratio is omitted", () => {
    const t = resolveAutoCompactThreshold(
      {
        enabled: true,
        thresholdPercent: 65,
        invokeNativeCompact: true,
        pressureSource: "branch",
      },
      200_000,
    );
    expect(t.percent).toBe(65);
    expect(t.tokens).toBe(130_000);
  });
});