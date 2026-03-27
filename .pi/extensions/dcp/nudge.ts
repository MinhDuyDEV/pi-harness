/**
 * DCP Extension — Real Nudge System (v2)
 *
 * Replaces behavioral-only nudge system with runtime-enforced nudges.
 * Uses Pi's turn_end event + ctx.getContextUsage() for real threshold checks.
 * Can trigger ctx.compact() automatically at critical thresholds.
 */

import type { DCPConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NudgeState {
	/** Pending nudge message to inject on next before_agent_start */
	pendingNudge: string | null;
	/** Last turn a nudge was injected (for debounce) */
	lastNudgeTurn: number;
	/** Consecutive assistant turns without user input */
	consecutiveAssistantTurns: number;
	/** Whether auto-compact was triggered this cycle */
	autoCompactTriggered: boolean;
	/** Last known context usage for display */
	lastContextPercent: number | null;
	/** Last known context tokens */
	lastContextTokens: number | null;
}

export interface NudgeCheckResult {
	/** Whether a nudge should be injected */
	shouldNudge: boolean;
	/** The nudge message to inject (if shouldNudge) */
	nudgeMessage: string | null;
	/** Whether auto-compact should be triggered */
	shouldAutoCompact: boolean;
	/** Whether a status update should be shown */
	shouldUpdateStatus: boolean;
	/** Status text for footer */
	statusText: string;
}

// ---------------------------------------------------------------------------
// Nudge Manager
// ---------------------------------------------------------------------------

export class NudgeManager {
	private config: DCPConfig;
	private state: NudgeState;

	constructor(config: DCPConfig) {
		this.config = config;
		this.state = {
			pendingNudge: null,
			lastNudgeTurn: 0,
			consecutiveAssistantTurns: 0,
			autoCompactTriggered: false,
			lastContextPercent: null,
			lastContextTokens: null,
		};
	}

	/**
	 * Record a user input — resets consecutive assistant turn counter.
	 */
	recordUserInput(): void {
		this.state.consecutiveAssistantTurns = 0;
	}

	/**
	 * Record that the agent recently called compress — suppress nudges briefly.
	 */
	recordCompressCall(currentTurn: number): void {
		this.state.lastNudgeTurn = currentTurn;
		this.state.autoCompactTriggered = false;
	}

	/**
	 * Check whether a nudge or auto-compact should fire.
	 * Called on turn_end with current context usage.
	 */
	check(
		contextTokens: number | null,
		contextPercent: number | null,
		currentTurn: number,
	): NudgeCheckResult {
		this.state.consecutiveAssistantTurns++;
		this.state.lastContextPercent = contextPercent;
		this.state.lastContextTokens = contextTokens;

		const result: NudgeCheckResult = {
			shouldNudge: false,
			nudgeMessage: null,
			shouldAutoCompact: false,
			shouldUpdateStatus: true,
			statusText: this.buildStatusText(contextTokens, contextPercent),
		};

		// No context data yet (e.g. right after compaction)
		if (contextTokens === null || contextPercent === null) {
			return result;
		}

		const { minContextLimit, maxContextLimit, iterationNudgeThreshold, nudgeForce } = this.config.compress;
		const { autoCompact } = this.config;

		// Phase 1: Below minimum — no pressure
		if (contextTokens < minContextLimit) {
			return result;
		}

		// Phase 4: Auto-compact threshold (critical)
		if (autoCompact.enabled && contextPercent >= autoCompact.thresholdPercent && !this.state.autoCompactTriggered) {
			result.shouldAutoCompact = true;
			this.state.autoCompactTriggered = true;
			return result;
		}

		// Phase 3: Above max — critical nudge
		if (contextTokens >= maxContextLimit) {
			result.shouldNudge = true;
			result.nudgeMessage = this.buildCriticalNudge(contextTokens, contextPercent);
			this.state.lastNudgeTurn = currentTurn;
			return result;
		}

		// Phase 2: Between min and max — gentle nudges
		// Check if enough turns since last nudge (frequency control)
		const turnsSinceLastNudge = currentTurn - this.state.lastNudgeTurn;
		if (turnsSinceLastNudge < this.config.compress.nudgeFrequency) {
			// Check iteration nudge separately
			if (this.state.consecutiveAssistantTurns >= iterationNudgeThreshold) {
				result.shouldNudge = true;
				result.nudgeMessage = this.buildIterationNudge(this.state.consecutiveAssistantTurns, contextTokens, contextPercent);
				this.state.lastNudgeTurn = currentTurn;
			}
			return result;
		}

		// Gentle nudge
		result.shouldNudge = true;
		result.nudgeMessage = nudgeForce === "strong"
			? this.buildStrongNudge(contextTokens, contextPercent)
			: this.buildGentleNudge(contextTokens, contextPercent);
		this.state.lastNudgeTurn = currentTurn;

		return result;
	}

	/**
	 * Get the pending nudge message and clear it.
	 */
	consumePendingNudge(): string | null {
		const nudge = this.state.pendingNudge;
		this.state.pendingNudge = null;
		return nudge;
	}

	/**
	 * Set a pending nudge to be injected on the next before_agent_start.
	 */
	setPendingNudge(message: string): void {
		this.state.pendingNudge = message;
	}

	/**
	 * Get current state for /dcp status display.
	 */
	getState(): NudgeState {
		return { ...this.state };
	}

	/**
	 * Reset state (e.g. after compaction).
	 */
	reset(): void {
		this.state = {
			pendingNudge: null,
			lastNudgeTurn: 0,
			consecutiveAssistantTurns: 0,
			autoCompactTriggered: false,
			lastContextPercent: null,
			lastContextTokens: null,
		};
	}

	// -----------------------------------------------------------------------
	// Private nudge message builders
	// -----------------------------------------------------------------------

	private buildStatusText(tokens: number | null, percent: number | null): string {
		if (tokens === null) return "DCP: waiting for context data";
		const pct = percent !== null ? `${Math.round(percent)}%` : "?%";
		const tokensK = Math.round(tokens / 1000);
		return `DCP: ${tokensK}k tokens (${pct})`;
	}

	private buildGentleNudge(tokens: number, percent: number): string {
		const tokensK = Math.round(tokens / 1000);
		return [
			`[DCP Nudge] Context at ${tokensK}k tokens (${Math.round(percent)}%).`,
			"Consider using `compress` to crystallize completed conversation ranges.",
			"Focus on closed phases: finished research, verified implementations, resolved debugging.",
		].join(" ");
	}

	private buildStrongNudge(tokens: number, percent: number): string {
		const tokensK = Math.round(tokens / 1000);
		return [
			`[DCP Warning] Context at ${tokensK}k tokens (${Math.round(percent)}%).`,
			"You SHOULD compress completed conversation ranges now.",
			"Use the `compress` tool on your largest closed phase.",
			"If no phases are closed, consider which work is least likely to be re-referenced.",
		].join(" ");
	}

	private buildCriticalNudge(tokens: number, percent: number): string {
		const tokensK = Math.round(tokens / 1000);
		return [
			`[DCP CRITICAL] Context at ${tokensK}k tokens (${Math.round(percent)}%) — approaching limit.`,
			"IMMEDIATELY compress the largest completed conversation range.",
			"Auto-compaction will trigger at 80% if no action is taken.",
		].join(" ");
	}

	private buildIterationNudge(consecutiveTurns: number, tokens: number, percent: number): string {
		const tokensK = Math.round(tokens / 1000);
		return [
			`[DCP Iteration] ${consecutiveTurns} consecutive turns without user input.`,
			`Context at ${tokensK}k tokens (${Math.round(percent)}%).`,
			"Check if any phases are complete and can be compressed.",
		].join(" ");
	}
}
