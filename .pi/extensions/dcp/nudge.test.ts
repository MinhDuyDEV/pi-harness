import { describe, it, expect } from "bun:test";
import { NudgeManager } from "./nudge";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DCPConfig } from "./config";

type Usage = { tokens: number; contextWindow?: number };
type Model = { contextWindow?: number };

function makeCtx(opts: { tokens: number; contextWindow?: number } = { tokens: 0 }): ExtensionContext {
  const usage: Usage = { tokens: opts.tokens };
  if (opts.contextWindow !== undefined) usage.contextWindow = opts.contextWindow;
  const model: Model = {};
  if (opts.contextWindow !== undefined) model.contextWindow = opts.contextWindow;
  return {
    getContextUsage: () => usage,
    model,
  } as unknown as ExtensionContext;
}

function defaultConfig(): DCPConfig {
  return {
    compress: {
      permission: "allow",
      mode: "range",
      maxContextLimit: 80,
      minContextLimit: 65,
      nudgeFrequency: 5,
      nudgeForce: "gentle",
      compressNudgeCooldown: 3,
      contextBlockThreshold: 50,
    },
    autoCompact: {
      enabled: true,
      thresholdPercent: 80,
      invokeNativeCompact: false,
      pressureSource: "max",
    },
  } as unknown as DCPConfig;
}

describe("NudgeManager.autoCompactTriggered", () => {
  it("does not arm Zone 4 when pressureSource outbound and branch high but outbound low", () => {
    const cfg = defaultConfig();
    cfg.autoCompact.pressureSource = "outbound";
    const m = new NudgeManager(cfg);
    const highCtx = makeCtx({ tokens: 170_000, contextWindow: 200_000 });
    const meter = {
      branchTokens: 170_000,
      outboundTokens: 110_000,
      branchPercent: 85,
      outboundPercent: 55,
      contextWindow: 200_000,
      deltaTokens: 60_000,
      strippedByDcp: true,
    };
    m.incTurn();
    expect(m.checkContext(highCtx, meter)).toBeNull();
    expect(m.getState().autoCompactTriggered).toBe(false);
  });

  it("Zone 4 arms without nudge when invokeNativeCompact is true", () => {
    const cfg = defaultConfig();
    cfg.autoCompact.invokeNativeCompact = true;
    const m = new NudgeManager(cfg);
    const highCtx = makeCtx({ tokens: 170_000, contextWindow: 200_000 });
    m.incTurn();
    expect(m.checkContext(highCtx)).toBeNull();
    expect(m.getState().autoCompactTriggered).toBe(true);
  });

  it("does not re-fire Zone 4 after a compress if context is still above threshold", () => {
    const cfg = defaultConfig();
    const m = new NudgeManager(cfg);
    const highCtx = makeCtx({ tokens: 170_000, contextWindow: 200_000 }); // 85%

    m.incTurn();
    const first = m.checkContext(highCtx);
    expect(first).not.toBeNull();
    expect(first).toMatch(/CRITICAL/);

    m.incTurn();
    const consumed = m.consumeNudge();
    expect(consumed).toBe(first);

    m.recordCompress();

    expect(m.checkContext(highCtx)).toBeNull();

    m.incTurn();
    expect(m.checkContext(highCtx)).toBeNull();
    m.incTurn();
    expect(m.checkContext(highCtx)).toBeNull();
    m.incTurn();

    expect(m.checkContext(highCtx)).toBeNull();
  });

  it("re-arms autoCompactTriggered when context drops below threshold", () => {
    const cfg = defaultConfig();
    const m = new NudgeManager(cfg);
    const highCtx = makeCtx({ tokens: 170_000, contextWindow: 200_000 });
    const lowCtx = makeCtx({ tokens: 70_000, contextWindow: 200_000 });

    m.incTurn();
    expect(m.checkContext(highCtx)).not.toBeNull();

    m.incTurn();
    m.consumeNudge();
    m.recordCompress();
    m.incTurn();
    m.checkContext(highCtx);
    m.incTurn();
    m.checkContext(highCtx);
    m.incTurn();
    m.checkContext(highCtx);

    const reArmed = m.checkContext(lowCtx);
    expect(reArmed).toBeNull();

    const fired = m.checkContext(highCtx);
    expect(fired).not.toBeNull();
  });

  it("Zone 2 (gentle nudge) still respects nudgeFrequency after a compress", () => {
    const cfg = defaultConfig();
    const m = new NudgeManager(cfg);
    const midCtx = makeCtx({ tokens: 140_000, contextWindow: 200_000 });

    for (let i = 0; i < 4; i++) {
      m.incTurn();
      expect(m.checkContext(midCtx)).toBeNull();
    }
    m.incTurn();
    const first = m.checkContext(midCtx);
    expect(first).not.toBeNull();

    m.incTurn();
    m.consumeNudge();
    m.recordCompress();

    expect(m.checkContext(midCtx)).toBeNull();
    m.incTurn();
    expect(m.checkContext(midCtx)).toBeNull();
    m.incTurn();
    expect(m.checkContext(midCtx)).toBeNull();

    m.incTurn();
    expect(m.checkContext(midCtx)).toBeNull();
    m.incTurn();
    expect(m.checkContext(midCtx)).toBeNull();

    m.incTurn();
    const second = m.checkContext(midCtx);
    expect(second).not.toBeNull();
  });
});