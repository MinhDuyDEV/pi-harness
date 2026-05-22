/**
 * DCP Extension — Real Nudge System (v2.1)
 *
 * Replaces behavioral-only nudge system with runtime-enforced nudges.
 * Uses Pi's turn_end event + ctx.getContextUsage() for real threshold checks.
 *
 * v2.1 additions (from v3.1.4 research):
 *   - summaryBuffer: active summary tokens extend effective maxContextLimit
 *   - CompressionPriorityMap: nudges include biggest compression targets
 *   - Hardened nudge format: clear prefixes, structured priority info
 */

import type { DCPConfig } from "./config.js";
import type { PriorityMap } from "./strategies.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NudgeState {
	/** Pending nudge message to inject on next before_agent_start */
	pendingNudge: string | null;
	/** Last turn a nudge was injected (for debounce) */
	lastNudgeTurn: number;

	/** Whether auto-compact was triggered this cycle */
	autoCompactTriggered: boolean;
	/** Last known context usage for display */
	lastContextPercent: number | null;
	/** Last known context tokens */
	lastContextTokens: number | null;
	/** Current priority map from context event */
	priorityMap: PriorityMap | null;
	/** Current summary buffer tokens in use */
	summaryTokens: number;
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
			autoCompactTriggered: false,
			lastContextPercent: null,
			lastContextTokens: null,
			priorityMap: null,
			summaryTokens: 0,
		};
	}



	/**
	 * Record that the agent recently called compress — suppress nudges briefly.
	 */
	recordCompressCall(currentTurn: number): void {
		this.state.lastNudgeTurn = currentTurn;
		this.state.autoCompactTriggered = false;
	}

	/**
	 * Update the priority map from the latest context event.
	 * Called by dcp.ts after computing the map in the context handler.
	 */
	setPriorityMap(map: PriorityMap): void {
		this.state.priorityMap = map;
	}

	/**
	 * Check whether a nudge or auto-compact should fire.
	 * Called on turn_end with current context usage.
	 *
	 * summaryTokens: active summary block tokens. These extend the effective
	 * maxContextLimit because they represent already-compressed content that
	 * shouldn't trigger premature nudges. Capped at config.compress.summaryBuffer.
	 */
	check(
		contextTokens: number | null,
		contextPercent: number | null,
		currentTurn: number,
		summaryTokens: number = 0,
	): NudgeCheckResult {

		this.state.lastContextPercent = contextPercent;
		this.state.lastContextTokens = contextTokens;
		this.state.summaryTokens = summaryTokens;

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

		const { minContextLimit, maxContextLimit, nudgeForce, summaryBuffer } = this.config.compress;
		const { autoCompact } = this.config;

		// summaryBuffer: extend effective max by active summary tokens
		// Summary blocks are already-compressed content — they shouldn't
		// trigger nudges. Cap the extension at summaryBuffer config value.
		const summaryExtension = Math.min(summaryTokens, summaryBuffer);
		const effectiveMax = maxContextLimit + summaryExtension;

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

		// Phase 3: Above effective max — critical nudge
		if (contextTokens >= effectiveMax) {
			result.shouldNudge = true;
			result.nudgeMessage = this.buildCriticalNudge(contextTokens, contextPercent);
			this.state.lastNudgeTurn = currentTurn;
			return result;
		}

		// Phase 2: Between min and effective max — gentle nudges
		// Don't nudge if we recently sent one (frequency control)
		const turnsSinceLastNudge = currentTurn - this.state.lastNudgeTurn;
		if (turnsSinceLastNudge < this.config.compress.nudgeFrequency) {
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
	 * Get current priority map (for compress tool message-mode suggestions).
	 */
	getPriorityMap(): PriorityMap | null {
		return this.state.priorityMap;
	}

	/**
	 * Reset state (e.g. after compaction).
	 */
	reset(): void {
		this.state = {
			pendingNudge: null,
			lastNudgeTurn: 0,
			autoCompactTriggered: false,
			lastContextPercent: null,
			lastContextTokens: null,
			priorityMap: null,
			summaryTokens: 0,
		};
	}

	// -----------------------------------------------------------------------
	// Private nudge message builders (hardened format with priority info)
	// -----------------------------------------------------------------------

	private buildStatusText(tokens: number | null, percent: number | null): string {
		if (tokens === null) return "DCP: waiting for context data";
		const pct = percent !== null ? `${Math.round(percent)}%` : "?%";
		const tokensK = Math.round(tokens / 1000);
		const summaryK = Math.round(this.state.summaryTokens / 1000);
		return summaryK > 0
			? `DCP: ${tokensK}k tokens (${pct}) [${summaryK}k summary buffer]`
			: `DCP: ${tokensK}k tokens (${pct})`;
	}

	/**
	 * Build a priority map section for inclusion in nudge messages.
	 * Shows the model which tool results are biggest compression targets.
	 */
	private buildPrioritySection(): string {
		const map = this.state.priorityMap;
		if (!map || map.topTargets.length === 0) return "";

		const lines: string[] = [];

		if (map.high.length > 0) {
			const highList = map.high.map((e) => `${e.toolName} (${e.count}x, ~${Math.round(e.totalTokens / 1000)}k)`).join(", ");
			lines.push(`**High-priority targets**: ${highList}`);
		}

		if (map.medium.length > 0 && lines.length < 2) {
			const medList = map.medium.slice(0, 3).map((e) => `${e.toolName} (${e.count}x, ~${Math.round(e.totalTokens / 1000)}k)`).join(", ");
			lines.push(`**Medium targets**: ${medList}`);
		}

		return lines.length > 0 ? "\nCompression targets: " + lines.join(". ") : "";
	}

	private buildGentleNudge(tokens: number, percent: number): string {
		const tokensK = Math.round(tokens / 1000);
		const priority = this.buildPrioritySection();
		return [
			`[DCP Nudge] Context at ${tokensK}k tokens (${Math.round(percent)}%).`,
			"Consider using `compress` to crystallize completed conversation ranges.",
			"Focus on closed phases: finished research, verified implementations, resolved debugging.",
			priority,
		].filter(Boolean).join(" ");
	}

	private buildStrongNudge(tokens: number, percent: number): string {
		const tokensK = Math.round(tokens / 1000);
		const priority = this.buildPrioritySection();
		return [
			`[DCP Warning] Context at ${tokensK}k tokens (${Math.round(percent)}%).`,
			"You SHOULD compress completed conversation ranges now.",
			"Use the `compress` tool on your largest closed phase.",
			"If no phases are closed, consider which work is least likely to be re-referenced.",
			priority,
		].filter(Boolean).join(" ");
	}

	private buildCriticalNudge(tokens: number, percent: number): string {
		const tokensK = Math.round(tokens / 1000);
		const priority = this.buildPrioritySection();
		return [
			`[DCP CRITICAL] Context at ${tokensK}k tokens (${Math.round(percent)}%) — approaching limit.`,
			"IMMEDIATELY compress the largest completed conversation range.",
			"Auto-compaction will trigger at 80% if no action is taken.",
			priority,
		].filter(Boolean).join(" ");
	}


}
