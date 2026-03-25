/**
 * DCP Extension — Entry Point
 *
 * Dynamic Context Pruning extension for Pi coding agents.
 * Ported from @tarquinen/opencode-dcp v3.1.0.
 *
 * WHAT THIS EXTENSION DOES:
 *   - Registers `compress` tool for crystallizing conversation ranges into summaries
 *   - Tracks tool calls for automatic strategy suggestions
 *   - Persists compression state in SQLite (~/.config/pi/dcp/dcp.db)
 *   - Registers /dcp command for quick status
 *
 * WHAT IT DOES NOT DO (Pi architectural limits):
 *   - No message transform hooks (Pi doesn't intercept LLM messages)
 *   - No automatic message pruning (agent must follow behavioral patterns)
 *   - No system prompt injection (use SKILL.md for agent instructions)
 *
 * DEPENDENCIES:
 *   better-sqlite3 (shared with memory extension)
 *   @sinclair/typebox (for tool parameter schemas)
 *
 * The agent should use the dynamic-context-pruning skill (.pi/skills/)
 * for behavioral patterns: when to compress, auto-strategies, nudge thresholds.
 */

import { DEFAULT_CONFIG, type DCPConfig } from "./dcp/config.js";
import { closeDCPDB, getDCPDB, recordToolCall, resetSessionState } from "./dcp/db.js";
import {
	registerCompressTool,
} from "./dcp/tools.js";

// ---------------------------------------------------------------------------
// Simple hash for tool parameter dedup tracking
// ---------------------------------------------------------------------------

function hashParams(params: unknown): string {
	try {
		if (!params || typeof params !== "object") return "";
		const sorted = JSON.stringify(
			params,
			Object.keys(params as Record<string, unknown>).sort(),
		);
		// Simple djb2 hash — good enough for dedup signatures
		let hash = 5381;
		for (let i = 0; i < sorted.length; i++) {
			hash = (hash * 33) ^ sorted.charCodeAt(i);
		}
		return (hash >>> 0).toString(36);
	} catch {
		return "";
	}
}

// ---------------------------------------------------------------------------
// Improved token estimation (counts both args and result)
// ---------------------------------------------------------------------------

function estimateToolTokens(event: any): number {
	let total = 0;

	// Count tool argument tokens (new in v3.1.0 — args were previously ignored)
	const input = event?.input ?? event?.params;
	if (input) {
		const inputStr =
			typeof input === "string" ? input : JSON.stringify(input);
		total += Math.ceil(inputStr.length / 4);
	}

	// Count result tokens
	const result = event?.result;
	if (result) {
		const resultStr =
			typeof result === "string" ? result : JSON.stringify(result);
		total += Math.ceil(resultStr.length / 4);
	}

	return total;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function dcpExtension(pi: any): void {
	const config: DCPConfig = { ...DEFAULT_CONFIG };

	// 1. Initialize database
	try {
		getDCPDB();
	} catch (err) {
		console.error("[dcp] Failed to initialize database:", err);
		return;
	}

	// 2. Register tools (skip in manual mode unless allowSubAgents is enabled)
	if (!config.manualMode.enabled || config.experimental.allowSubAgents) {
		registerCompressTool(pi, config);
	}

	// 3. Track tool calls for dedup strategy
	let currentTurn = 0;

	pi.on("input", () => {
		currentTurn++;
	});

	pi.on("tool_result", (event: any) => {
		if (!config.strategies.deduplication.enabled) return;

		try {
			const toolName = event?.name ?? event?.toolName;
			const callId = event?.toolCallId ?? event?.id;
			const params = event?.input ?? event?.params;
			const status = event?.error ? "error" : "completed";
			const sessionId = event?.sessionId ?? "default";

			if (!toolName || !callId) return;

			// Skip protected tools
			if (config.compress.protectedTools.includes(toolName)) return;

			const paramsHash = hashParams(params);
			const tokenEstimate = estimateToolTokens(event);

			recordToolCall(
				sessionId,
				callId,
				toolName,
				paramsHash,
				status,
				currentTurn,
				tokenEstimate,
			);
		} catch {
			// Best-effort tracking
		}
	});

	// 4. Handle native /compact events — reset stale state
	pi.on("compact", (event: any) => {
		try {
			const sessionId = event?.sessionId ?? "default";
			resetSessionState(sessionId);
			currentTurn = 0;
		} catch {
			// best-effort reset
		}
	});

	// 5. Register /dcp command
	pi.registerCommand("dcp", {
		description: "Show DCP context pruning status and statistics",
		async handler(ctx: any) {
			try {
				const {
					getGlobalStats,
					getActiveBlocks,
					getSummaryTokens,
				} = await import("./dcp/db.js");

				const stats = getGlobalStats();
				const sessionId = ctx?.sessionId ?? "default";
				const activeBlocks = getActiveBlocks(sessionId);
				const summaryTokens = getSummaryTokens(sessionId);
				const summaryBufferPct = Math.round(
					(summaryTokens / config.compress.summaryBuffer) * 100,
				);

				const lines = [
					"## DCP Status",
					"",
					`**Sessions**: ${stats.totalSessions}`,
					`**Total compressions**: ${stats.totalCompressions}`,
					`**Tokens compressed**: ~${stats.totalCompressedTokens}`,
					`**Tokens pruned**: ~${stats.totalPrunedTokens}`,
					`**Summary buffer**: ~${summaryTokens}/${config.compress.summaryBuffer} (${summaryBufferPct}%)`,
					`**Mode**: ${config.compress.mode}`,
					"",
					`**Active blocks (current session)**: ${activeBlocks.length}`,
					...activeBlocks.map(
						(b: any) =>
							`  b${b.block_id}: "${b.topic}" (~${b.compressed_tokens} tokens)`,
					),
					"",
					"Use `compress` tool to crystallize completed conversation ranges.",
				];

				if (ctx?.ui) {
					ctx.ui.notify(lines.join("\n"));
				}
			} catch (err) {
				if (ctx?.ui) {
					ctx.ui.notify(`DCP status error: ${err}`);
				}
			}
		},
	});

	// 6. Cleanup on shutdown
	pi.on("session_shutdown", () => {
		closeDCPDB();
	});
}
