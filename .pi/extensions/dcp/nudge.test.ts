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
    },
  } as unknown as DCPConfig;
}

describe("NudgeManager.autoCompactTriggered", () => {
  it("does not re-fire Zone 4 after a compress if context is still above threshold", () => {
    const cfg = defaultConfig();
    const m = new NudgeManager(cfg);
    const highCtx = makeCtx({ tokens: 170_000, contextWindow: 200_000 }); // 85%

    // Turn 1: input
    m.incTurn();
    // turn_end: Zone 4 should trigger at 85%
    const first = m.checkContext(highCtx);
    expect(first).not.toBeNull();
    expect(first).toMatch(/CRITICAL/);

    // Turn 2: input, before_agent_start consumes the pending nudge
    m.incTurn();
    const consumed = m.consumeNudge();
    expect(consumed).toBe(first);

    // Agent runs, calls compress
    m.recordCompress();

    // turn_end: still in suppression
    expect(m.checkContext(highCtx)).toBeNull();

    // Advance through cooldown (3 turns total: current + 2 more)
    m.incTurn();
    expect(m.checkContext(highCtx)).toBeNull();
    m.incTurn();
    expect(m.checkContext(highCtx)).toBeNull();
    m.incTurn();
    // Now past cooldown (currentTurn === suppressUntilTurn)

    // REGRESSION: even though cooldown ended, Zone 4 must NOT re-fire
    // because autoCompactTriggered is still true. Before the fix, the
    // second nudge fired here, causing the prompt to be injected
    // twice in close succession.
    expect(m.checkContext(highCtx)).toBeNull();
  });

  it("re-arms autoCompactTriggered when context drops below threshold", () => {
    const cfg = defaultConfig();
    const m = new NudgeManager(cfg);
    const highCtx = makeCtx({ tokens: 170_000, contextWindow: 200_000 }); // 85%
    const lowCtx = makeCtx({ tokens: 70_000, contextWindow: 200_000 }); // 35% (below min 65)

    // Arm the trigger by exceeding threshold once
    m.incTurn();
    expect(m.checkContext(highCtx)).not.toBeNull();

    // Consume + compress + clear suppression window
    m.incTurn();
    m.consumeNudge();
    m.recordCompress();
    m.incTurn();
    m.checkContext(highCtx); // suppression
    m.incTurn();
    m.checkContext(highCtx); // suppression
    m.incTurn();
    m.checkContext(highCtx); // suppression ends; still 85% so no re-arm

    // Context drops to 35% (below threshold and below min)
    // → re-arm autoCompactTriggered; Zone 1 returns null (below min)
    const reArmed = m.checkContext(lowCtx);
    expect(reArmed).toBeNull();

    // Context goes back to 85% → Zone 4 fires again (re-armed)
    const fired = m.checkContext(highCtx);
    expect(fired).not.toBeNull();
  });

  it("Zone 2 (gentle nudge) still respects nudgeFrequency after a compress", () => {
    const cfg = defaultConfig();
    const m = new NudgeManager(cfg);
    const midCtx = makeCtx({ tokens: 140_000, contextWindow: 200_000 }); // 70% (between min 65 and max 80)

    // First nudge: need 5 turns of context in Zone 2 before it fires
    for (let i = 0; i < 4; i++) {
      m.incTurn();
      expect(m.checkContext(midCtx)).toBeNull();
    }
    // 5th turn: nudgeFrequency (5) - 0 = 5 >= 5, Zone 2 fires
    m.incTurn();
    const first = m.checkContext(midCtx);
    expect(first).not.toBeNull();

    // Consume + compress
    m.incTurn();
    m.consumeNudge();
    m.recordCompress();

    // Suppression covers the current turn + 2 more
    expect(m.checkContext(midCtx)).toBeNull();
    m.incTurn();
    expect(m.checkContext(midCtx)).toBeNull();
    m.incTurn();
    expect(m.checkContext(midCtx)).toBeNull();

    // Now past suppression but only 3 turns since lastNudgeTurn
    // (Zone 2 frequency is 5), so still no nudge
    m.incTurn();
    expect(m.checkContext(midCtx)).toBeNull();

    m.incTurn();
    expect(m.checkContext(midCtx)).toBeNull();

    // 5 turns since lastNudgeTurn → Zone 2 fires again
    m.incTurn();
    const second = m.checkContext(midCtx);
    expect(second).not.toBeNull();
  });
});
