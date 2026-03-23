/**
 * DCP Extension — Entry Point
 *
 * Dynamic Context Pruning extension for Pi coding agents.
 * Ported from @tarquinen/opencode-dcp v3.0.4.
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
import { closeDCPDB, getDCPDB, recordToolCall } from "./dcp/db.js";
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

	// 2. Register tools
	registerCompressTool(pi, config);

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
			const tokenEstimate = event?.result
				? Math.ceil(
						(typeof event.result === "string"
							? event.result.length
							: JSON.stringify(event.result).length) / 4,
					)
				: 0;

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

	// 4. Register /dcp command
	pi.registerCommand("dcp", {
		description: "Show DCP context pruning status and statistics",
		async handler(ctx: any) {
			try {
				const {
					getGlobalStats,
					getActiveBlocks,
				} = await import("./dcp/db.js");

				const stats = getGlobalStats();
				const sessionId = ctx?.sessionId ?? "default";
				const activeBlocks = getActiveBlocks(sessionId);

				const lines = [
					"## DCP Status",
					"",
					`**Sessions**: ${stats.totalSessions}`,
					`**Total compressions**: ${stats.totalCompressions}`,
					`**Tokens compressed**: ~${stats.totalCompressedTokens}`,
					`**Tokens pruned**: ~${stats.totalPrunedTokens}`,
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

	// 5. Cleanup on shutdown
	pi.on("session_shutdown", () => {
		closeDCPDB();
	});
}
