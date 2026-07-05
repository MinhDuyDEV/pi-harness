/**
 * DCP Extension — Nudge System
 *
 * Gradual context pressure on turn_end.
 * Three zones: below min (no nudge), between min and max (gentle),
 * above max (critical). Fires a pending nudge that gets injected
 * on the next before_agent_start event.
 *
 * P3: Block-aware nudges — suggests which compression block to merge
 * and includes quality metrics when available.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DCPConfig } from "./config.js";
import type { ContextMeterSnapshot } from "./context-meter.js";
import {
  resolveAutoCompactThreshold,
  resolveContextPressure,
  type ContextPressureSource,
} from "./pressure.js";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NudgeState {
  pendingNudge: string | null;
  lastNudgeTurn: number;
  autoCompactTriggered: boolean;
  lastContextPercent: number | null;
  lastContextTokens: number | null;
  /** P3: Number of existing compression blocks (for block-aware messages) */
  blockCount: number;
  /** P3: Quality status line to include in nudges */
  qualityStatus: string;
  /** Suppress all nudges until this turn (set after compress) */
  suppressUntilTurn: number;
  /** Last branch vs outbound meter snapshot (for /dcp and debugging) */
  lastMeter: ContextMeterSnapshot | null;
  lastPressurePercent: number | null;
  lastPressureSource: ContextPressureSource | null;
}

// ---------------------------------------------------------------------------
// Nudge Manager
// ---------------------------------------------------------------------------

export class NudgeManager {
  private config: DCPConfig;
  protected state: NudgeState;
  private currentTurn = 0;

  constructor(config: DCPConfig) {
    this.config = config;
    this.state = {
      pendingNudge: null,
      lastNudgeTurn: 0,
      autoCompactTriggered: false,
      lastContextPercent: null,
      lastContextTokens: null,
      blockCount: 0,
      qualityStatus: "",
      suppressUntilTurn: 0,
      lastMeter: null,
      lastPressurePercent: null,
      lastPressureSource: null,
    };
  }

  /** Increment turn counter (call from `input` event) */
  incTurn(): void {
    this.currentTurn++;
  }

  /** Record a compress call to suppress nudges briefly */
  recordCompress(): void {
    this.state.lastNudgeTurn = this.currentTurn;
    // NOTE: do NOT reset autoCompactTriggered here. The auto-compact
    // trigger should stay armed while context is still over the
    // threshold; it's re-armed (set back to false) in checkContext
    // only when context has actually dropped below it. Resetting it
    // here causes Zone 4 to re-fire the critical nudge as soon as the
    // 3-turn cooldown expires, even when the agent just compressed.
    this.state.suppressUntilTurn = this.currentTurn + this.config.compress.compressNudgeCooldown;
  }

  /**
   * P3: Update block count and quality status (called externally by index.ts)
   */
  updateBlockContext(blockCount: number, qualityStatus: string): void {
    this.state.blockCount = blockCount;
    this.state.qualityStatus = qualityStatus;
  }

  /**
   * Refresh branch/outbound meter for status (/dcp) without nudge side effects.
   */
  refreshContextMeter(ctx: ExtensionContext, meter: ContextMeterSnapshot): void {
    const usage = ctx.getContextUsage();
    const contextWindow = meter.contextWindow;
    const branchTokens = usage?.tokens ?? meter.branchTokens ?? 0;
    this.state.lastContextTokens = branchTokens;
    this.state.lastContextPercent =
      branchTokens > 0 ? (branchTokens / contextWindow) * 100 : meter.branchPercent;
    this.state.lastMeter = meter;
    const pressure = resolveContextPressure(
      meter,
      this.config.autoCompact.pressureSource ?? "max",
    );
    this.state.lastPressurePercent = pressure.percent;
    this.state.lastPressureSource = pressure.source;
  }

  /**
   * Check context usage and update nudge state.
   * Call from `turn_end` event.
   *
   * @returns the pending nudge message, if any
   */
  checkContext(
    ctx: ExtensionContext,
    meter?: ContextMeterSnapshot,
  ): string | null {
    const usage = ctx.getContextUsage();
    if (!usage?.tokens) return null;

    if (meter) {
      this.state.lastMeter = meter;
    }
    const contextTokens = usage.tokens;
    const config = this.config.compress;
    const autoCfg = this.config.autoCompact;

    const model = ctx.model;
    const contextWindow = model?.contextWindow ?? 200_000;
    const branchPercent = (contextTokens / contextWindow) * 100;

    this.state.lastContextTokens = contextTokens;
    this.state.lastContextPercent = branchPercent;

    const meterSnap: ContextMeterSnapshot =
      meter ??
      ({
        branchTokens: contextTokens,
        outboundTokens: 0,
        branchPercent,
        outboundPercent: null,
        contextWindow,
        deltaTokens: null,
        strippedByDcp: false,
      } satisfies ContextMeterSnapshot);

    const pressure = resolveContextPressure(
      meterSnap,
      autoCfg.pressureSource ?? "max",
    );
    const autoThreshold = resolveAutoCompactThreshold(autoCfg, contextWindow);
    const contextPercent = pressure.percent;
    this.state.lastPressurePercent = pressure.percent;
    this.state.lastPressureSource = pressure.source;
    if (this.currentTurn < this.state.suppressUntilTurn) return null;

    if (
      this.state.autoCompactTriggered &&
      contextPercent < autoThreshold.percent
    ) {
      this.state.autoCompactTriggered = false;
    }

    if (contextPercent < config.minContextLimit) return null;

    if (
      autoCfg.enabled &&
      contextPercent >= autoThreshold.percent &&
      !this.state.autoCompactTriggered
    ) {
      this.state.autoCompactTriggered = true;
      if (!autoCfg.invokeNativeCompact) {
        this.state.pendingNudge = this.buildCriticalNudge(
          contextTokens,
          contextPercent,
          meterSnap,
        );
        return this.state.pendingNudge;
      }
      return null;
    }

    if (contextPercent >= config.maxContextLimit) {
      if (this.state.autoCompactTriggered) return null;
      this.state.pendingNudge = this.buildCriticalNudge(
        contextTokens,
        contextPercent,
        meterSnap,
      );
      this.state.lastNudgeTurn = this.currentTurn;
      return this.state.pendingNudge;
    }

    const turnsSinceLastNudge = this.currentTurn - this.state.lastNudgeTurn;
    if (turnsSinceLastNudge < config.nudgeFrequency) return null;

    this.state.pendingNudge =
      config.nudgeForce === "strong"
        ? this.buildStrongNudge(contextTokens, contextPercent)
        : this.buildGentleNudge(contextTokens, contextPercent);
    this.state.lastNudgeTurn = this.currentTurn;

    return this.state.pendingNudge;
  }

  /**
   * Consume and return the pending nudge message.
   * Call from `before_agent_start` event to inject.
   */
  consumeNudge(): string | null {
    const msg = this.state.pendingNudge;
    this.state.pendingNudge = null;
    return msg;
  }

  /** Reset state (e.g., after compaction) */
  reset(): void {
    this.state = {
      pendingNudge: null,
      lastNudgeTurn: this.currentTurn,
      autoCompactTriggered: false,
      lastContextPercent: this.state.lastContextPercent,
      lastContextTokens: this.state.lastContextTokens,
      blockCount: this.state.blockCount,
      qualityStatus: this.state.qualityStatus,
      suppressUntilTurn: this.state.suppressUntilTurn,
      lastMeter: this.state.lastMeter,
      lastPressurePercent: this.state.lastPressurePercent,
      lastPressureSource: this.state.lastPressureSource,
    };
  }

  /** Get current turn */
  getTurn(): number {
    return this.currentTurn;
  }

  /** Get state for /dcp display */
  getState(): NudgeState {
    return { ...this.state };
  }

  // ── P3: Nudge message builders ──

  /**
   * Build block-aware action suggestion.
   * Tells the LLM which old block to re-compress with structured fields.
   */
  private buildActionSuggestion(): string {
    const bc = this.state.blockCount;
    if (bc <= 1) return "Use `compress` with structured fields (files_read, files_modified, decisions, next_steps).";
    return `Use \`compress\` on the oldest block (b1) adding structured fields.`;
  }

  private buildGentleNudge(tokens: number, percent: number): string {
    const parts = [
      `[DCP] Context at ${Math.round(tokens / 1000)}k tokens (${Math.round(percent)}%).`,
      this.buildActionSuggestion(),
    ];
    if (this.state.qualityStatus) {
      parts.push(`Quality: ${this.state.qualityStatus}`);
    }
    return parts.join(" ");
  }

  private buildStrongNudge(tokens: number, percent: number): string {
    const parts = [
      `[DCP] Context at ${Math.round(tokens / 1000)}k tokens (${Math.round(percent)}%).`,
      this.buildActionSuggestion(),
    ];
    if (this.state.qualityStatus) {
      parts.push(`Quality: ${this.state.qualityStatus}`);
    }
    return parts.join(" ");
  }

  private buildCriticalNudge(
    tokens: number,
    percent: number,
    meter?: ContextMeterSnapshot,
  ): string {
    const parts = [
      `[DCP] CRITICAL: Context at ${Math.round(tokens / 1000)}k tokens (${Math.round(percent)}%) — approaching limit.`,
      this.buildActionSuggestion(),
    ];
    if (meter?.strippedByDcp && meter.deltaTokens != null && meter.deltaTokens > 0) {
      parts.push(
        `Branch meter is ~${Math.round(meter.deltaTokens / 1000)}k tokens above what DCP sends to the model (${Math.round(meter.outboundTokens / 1000)}k outbound); Pi may still compact on branch usage.`,
      );
    }
    if (this.state.qualityStatus) {
      parts.push(`Quality: ${this.state.qualityStatus}`);
    }
    return parts.join(" ");
  }

  /** Build status string for /dcp command */
  getStatusLine(): string {
    const s = this.state;
    if (s.lastContextTokens === null) return "DCP: inactive (no context data)";
    const pct = s.lastContextPercent !== null ? ` (${Math.round(s.lastContextPercent)}%)` : "";
    const nudge = s.pendingNudge ? " \uF071 pending" : "";
    const qual = s.qualityStatus ? ` | ${s.qualityStatus}` : "";
    const meter = s.lastMeter
      ? ` | outbound ${Math.round(s.lastMeter.outboundTokens / 1000)}k${s.lastMeter.strippedByDcp ? ` (Δ${Math.round((s.lastMeter.deltaTokens ?? 0) / 1000)}k)` : ""}`
      : "";
    return `DCP: ${Math.round(s.lastContextTokens / 1000)}k branch${pct}${meter}${nudge}${qual}`;
  }
}
