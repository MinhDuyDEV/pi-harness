/**
 * DCP Extension — Entry Point
 *
 * Dynamic Context Pruning extension for Pi coding agents.
 * Ported from @tarquinen/opencode-dcp v3.1.2.
 *
 * WHAT THIS EXTENSION DOES:
 *   - Registers `compress` tool for crystallizing conversation ranges into summaries
 *   - Tracks tool calls for automatic strategy suggestions
 *   - Persists compression state in SQLite (~/.config/pi/dcp/dcp.db)
 *   - Registers /dcp command for quick status
 *
 * WHAT IT DOES NOT DO (Pi architectural limits):
 *   - No message transform hooks — agent must follow behavioral patterns
 *   - No automatic message pruning — use dynamic-context-pruning skill
 *   - No system prompt injection — use SKILL.md for agent instructions
 *
 * DEPENDENCIES:
 *   better-sqlite3 (via .pi/extensions/package.json)
 *   @sinclair/typebox (bundled by Pi runtime)
 *   @mariozechner/pi-coding-agent (bundled by Pi runtime — types only)
 *
 * The agent should use the dynamic-context-pruning skill (.pi/skills/)
 * for behavioral patterns: when to compress, auto-strategies, nudge thresholds.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionCommandContext,
	ToolResultEvent,
	SessionCompactEvent,
} from "@mariozechner/pi-coding-agent";

import { DEFAULT_CONFIG, type DCPConfig } from "./dcp/config.js";
import { getSessionId } from "./dcp/context.js";
import { closeDCPDB, getDCPDB, recordToolCall, resetSessionState } from "./dcp/db.js";
import { registerCompressTool } from "./dcp/tools.js";

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

function estimateToolTokens(event: ToolResultEvent): number {
	let total = 0;

	// Count tool argument tokens
	const input = event.input;
	if (input) {
		const inputStr = JSON.stringify(input);
		total += Math.ceil(inputStr.length / 4);
	}

	// Count result content tokens
	for (const part of event.content) {
		if (part.type === "text") {
			total += Math.ceil(part.text.length / 4);
		}
	}

	return total;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function dcpExtension(pi: ExtensionAPI): void {
	const config: DCPConfig = { ...DEFAULT_CONFIG };

	if (!config.enabled) {
		return;
	}

	// 1. Initialize database
	try {
		getDCPDB();
	} catch (err) {
		console.error("[dcp] Failed to initialize database:", err);
		return;
	}

	// 2. Register tools
	// In the Pi behavioral port, `manualMode` does not disable the tool itself.
	// It only affects agent behavior documented in the skill.
	registerCompressTool(pi, config);

	// 3. Track tool calls for dedup strategy
	let currentTurn = 0;

	pi.on("input", () => {
		currentTurn++;
	});

	// tool_result fires after each tool execution with result content
	// See: ToolResultEvent { toolCallId, toolName, input, content, isError }
	pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
		if (!config.strategies.deduplication.enabled) return;

		try {
			const { toolName, toolCallId, input, isError } = event;
			const sessionId = getSessionId(ctx);

			if (!toolName || !toolCallId) return;

			const dedupProtectedTools = new Set([
				...config.compress.protectedTools,
				...config.strategies.deduplication.protectedTools,
			]);
			if (dedupProtectedTools.has(toolName)) return;

			const paramsHash = hashParams(input);
			const status = isError ? "error" : "completed";
			const tokenEstimate = estimateToolTokens(event);

			recordToolCall(
				sessionId,
				toolCallId,
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
	// Event name is "session_compact" in the Pi SDK
	pi.on("session_compact", (_event: SessionCompactEvent, ctx: ExtensionContext) => {
		try {
			const sessionId = getSessionId(ctx);
			resetSessionState(sessionId);
			currentTurn = 0;
		} catch {
			// best-effort reset
		}
	});

	// 5. Register /dcp command
	// Pi command handler signature: (args: string, ctx: ExtensionCommandContext)
	pi.registerCommand("dcp", {
		description: "Show DCP context pruning status and statistics",
		async handler(_args: string, ctx: ExtensionCommandContext) {
			try {
				const {
					getGlobalStats,
					getActiveBlocks,
					getSummaryTokens,
				} = await import("./dcp/db.js");

				const stats = getGlobalStats();
				const sessionId = getSessionId(ctx);
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
						(b) =>
							`  b${b.block_id}: "${b.topic}" (~${b.compressed_tokens} tokens)`,
					),
					"",
					"Use `compress` tool to crystallize completed conversation ranges.",
				];

				if (ctx.hasUI) {
					ctx.ui.notify(lines.join("\n"), "info");
				}
			} catch (err) {
				if (ctx.hasUI) {
					ctx.ui.notify(`DCP status error: ${err}`, "error");
				}
			}
		},
	});

	// 6. Cleanup on shutdown
	pi.on("session_shutdown", () => {
		closeDCPDB();
	});
}
