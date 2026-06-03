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
    };
  }

  /** Increment turn counter (call from `input` event) */
  incTurn(): void {
    this.currentTurn++;
  }

  /** Record a compress call to suppress nudges briefly */
  recordCompress(): void {
    this.state.lastNudgeTurn = this.currentTurn;
    this.state.autoCompactTriggered = false;
  }

  /**
   * P3: Update block count and quality status (called externally by index.ts)
   */
  updateBlockContext(blockCount: number, qualityStatus: string): void {
    this.state.blockCount = blockCount;
    this.state.qualityStatus = qualityStatus;
  }

  /**
   * Check context usage and update nudge state.
   * Call from `turn_end` event.
   *
   * @returns the pending nudge message, if any
   */
  checkContext(ctx: ExtensionContext): string | null {
    const usage = ctx.getContextUsage();
    if (!usage?.tokens) return null;

    const contextTokens = usage.tokens;
    const config = this.config.compress;
    const autoCfg = this.config.autoCompact;

    // Estimate context percentage from model info
    const model = ctx.model;
    const contextWindow = model?.contextWindow ?? 200_000;
    const contextPercent = (contextTokens / contextWindow) * 100;

    this.state.lastContextTokens = contextTokens;
    this.state.lastContextPercent = contextPercent;

    // Zone 1: Below minimum — no pressure
    if (contextPercent < config.minContextLimit) return null;

    // Zone 4: Auto-compact threshold
    if (autoCfg.enabled && contextPercent >= autoCfg.thresholdPercent && !this.state.autoCompactTriggered) {
      this.state.autoCompactTriggered = true;
      this.state.pendingNudge = this.buildCriticalNudge(contextTokens, contextPercent);
      return this.state.pendingNudge;
    }

    // Zone 3: Above effective max — critical nudge
    if (contextPercent >= config.maxContextLimit) {
      if (this.state.autoCompactTriggered) return null;
      this.state.pendingNudge = this.buildCriticalNudge(contextTokens, contextPercent);
      this.state.lastNudgeTurn = this.currentTurn;
      return this.state.pendingNudge;
    }

    // Zone 2: Between min and max — gentle nudges with frequency control
    const turnsSinceLastNudge = this.currentTurn - this.state.lastNudgeTurn;
    if (turnsSinceLastNudge < config.nudgeFrequency) return null;

    this.state.pendingNudge = config.nudgeForce === "strong"
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

  private buildCriticalNudge(tokens: number, percent: number): string {
    const parts = [
      `[DCP] CRITICAL: Context at ${Math.round(tokens / 1000)}k tokens (${Math.round(percent)}%) — approaching limit.`,
      this.buildActionSuggestion(),
    ];
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
    return `DCP: ${Math.round(s.lastContextTokens / 1000)}k tokens${pct}${nudge}${qual}`;
  }
}
