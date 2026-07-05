import { describe, it, expect } from "bun:test";
import { buildContextMeterSnapshot } from "./context-meter";

describe("buildContextMeterSnapshot", () => {
  it("computes branch vs outbound delta", () => {
    const snap = buildContextMeterSnapshot(100_000, 40_000, 200_000);
    expect(snap.branchPercent).toBe(50);
    expect(snap.outboundPercent).toBe(20);
    expect(snap.deltaTokens).toBe(60_000);
    expect(snap.strippedByDcp).toBe(true);
  });

  it("does not flag stripped when outbound is zero (command ctx)", () => {
    const snap = buildContextMeterSnapshot(72_000, 0, 200_000);
    expect(snap.strippedByDcp).toBe(false);
  });

  it("marks small delta as not stripped", () => {
    const snap = buildContextMeterSnapshot(10_000, 9_500, 200_000);
    expect(snap.strippedByDcp).toBe(false);
  });
});