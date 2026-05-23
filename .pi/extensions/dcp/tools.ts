/**
 * DCP Extension — Compress Tool
 *
 * Registers the `compress` tool that allows the AI agent to crystallize
 * completed conversation ranges into dense summaries.
 *
 * Ported from @tarquinen/opencode-dcp compress tool.
 *
 * In DCP v2, the compress tool stores the summary in SQLite AND the
 * context event handler strips the compressed range from messages on
 * every subsequent LLM call. The summary replaces the original messages.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type {
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { type DCPConfig } from "./config.js";
import { getSessionId } from "./context.js";
import {
	getActiveBlocks,
	getNextBlockId,
	getSessionStats,
	storeCompressionBlock,
	updateSessionStats,
} from "./db.js";
import type { PriorityMap } from "./strategies.js";
import { estimateTokens } from "./utils.js";

// Token estimation imported from shared utils
// (estimateTokens imported above from ./utils.js)

// ---------------------------------------------------------------------------
// Compress tool description (from DCP's compress prompt)
// ---------------------------------------------------------------------------

const COMPRESS_DESCRIPTION = `Collapse a range in the conversation into a detailed summary.

COMPRESSION MODES
- "range" (default): Select a conversation range by start/end boundaries → replace with summary.
- "message" (experimental, advisory in the Pi port): Use when sessions are dense with no clear
  phase boundaries. The agent should choose message-sized slices by priority, but this tool still
  stores a normal compression block with the provided boundaries and summary.

THE PHILOSOPHY OF COMPRESS
compress transforms verbose conversation sequences into dense, high-fidelity summaries. This is not cleanup — it is crystallization. Your summary becomes the authoritative record of what transpired.

THE SUMMARY
Your summary must be EXHAUSTIVE. Capture file paths, function signatures, decisions made, constraints discovered, key findings — EVERYTHING that maintains context integrity. This is not a brief note — it is an authoritative record so faithful that the original conversation adds no value.

USER INTENT FIDELITY
When the compressed range includes user messages, preserve the user's intent with extra care. Directly quote user messages when they are short enough to include safely.

Yet be LEAN. Strip away failed attempts, verbose tool outputs, back-and-forth exploration. What remains should be pure signal.

WHEN TO USE
- Research concluded and findings are clear
- Implementation finished and verified
- Exploration exhausted and patterns understood
- A closed portion unlikely to be referenced immediately

WHEN NOT TO USE
- You may need exact code, error messages, or file contents in the immediate next steps
- Work in that area is still active or likely to resume immediately

IMPORTANT: Never run multiple compress calls in parallel. Always serialize compression calls.

ITERATIVE COMPRESSION
When compressing for the 2nd+ time in a session, prior compression summaries are shown in the tool output. Build on them — reference prior blocks by [bN] ID instead of repeating information. Each successive summary should capture only NEW information not already in prior blocks.

Before compressing, ask: "Is this range closed enough to become summary-only right now?"`;

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCompressTool(
	pi: ExtensionAPI,
	config: DCPConfig,
	getPriorityMap?: () => PriorityMap | null,
): void {
	if (config.compress.permission === "deny") {
		return;
	}

	pi.registerTool({
		name: "compress",
		label: "Compress Context",
		description: COMPRESS_DESCRIPTION,
		promptSnippet:
			"Collapse a conversation range into a dense, exhaustive summary.",
		promptGuidelines: [
			"Compress completed research or implementation phases to free context space — don't let context fill up silently.",
			"Before compressing, verify the range is truly closed — never compress work you may need exact details from in the immediate next steps.",
			"Write exhaustive summaries that capture file paths, function signatures, decisions, and constraints — the summary replaces the original conversation.",
		],
		parameters: Type.Object({
			topic: Type.String({
				description:
					"Short label (3-5 words) for display — e.g., 'Auth System Exploration'",
			}),
			startId: Type.Optional(
				Type.String({
					description:
						"Description of where the range starts — e.g., 'beginning of auth research'. Omit in batch mode.",
				}),
			),
			endId: Type.Optional(
				Type.String({
					description:
						"Description of where the range ends — e.g., 'auth implementation verified'. Omit in batch mode.",
				}),
			),
			summary: Type.String({
				description:
					"Complete technical summary replacing all content in range. Must be exhaustive.",
			}),
			mode: Type.Optional(
				Type.Union([Type.Literal("range"), Type.Literal("message"), Type.Literal("batch")], {
					description:
						'Compression mode: "range" (default) collapses a conversation range; "message" is advisory in the Pi port and records that the agent selected message-sized slices by priority before summarizing; "batch" auto-crystallizes everything since the last compression point — omit startId/endId in this mode.',
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: {
				topic: string;
				startId?: string;
				endId?: string;
				summary: string;
				mode?: "range" | "message" | "batch";
			},
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<{
				blockId: number;
				topic: string;
				mode: "range" | "message" | "batch";
				summaryTokens: number;
				totalActive: number;
				summaryBufferUsed: string;
			}> | undefined,
			ctx: ExtensionContext,
		) {
			const compressMode = params.mode ?? config.compress.mode;
			const modeLabel =
				compressMode === "message"
					? 'message (advisory in Pi port)'
					: compressMode;

			if (!params.topic?.trim()) {
				throw new Error("topic is required and must be a non-empty string");
			}

			if (!params.summary?.trim()) {
				throw new Error("summary is required and must be a non-empty string");
			}

			// ---------------------------------------------------------------
			// Turn protection: prevent compressing recent working context
			//
			// The compress strategy (strategies.ts) strips ALL messages before
			// the compress tool call. So if an agent calls compress, everything
			// in the conversation prior to this call gets replaced by the summary.
			// We protect against nuking recent work by counting user turns
			// (which accurately represent interaction rounds regardless of how
			// many tool calls each round generates).
			// ---------------------------------------------------------------
			if (config.turnProtection.enabled && config.turnProtection.turns > 0) {
				try {
					// getBranch() returns root → leaf order, no Map needed
					const branch = ctx.sessionManager.getBranch();
					const protectedTurns = config.turnProtection.turns;

					// Walk the branch and count user turns since the last
					// compaction boundary (or start of conversation).
					// A compaction entry means prior history was already
					// summarized — sufficient context exists beyond it.
					let userTurnsSinceBoundary = 0;
					let hasCompactionBoundary = false;

					for (const entry of branch) {
						if (entry.type === "compaction") {
							// Reset: compaction summarizes prior context
							userTurnsSinceBoundary = 0;
							hasCompactionBoundary = true;
						} else if (entry.type === "message") {
							const msg = entry as { message?: { role?: string } };
							if (msg.message?.role === "user") {
								userTurnsSinceBoundary++;
							}
						}
					}

					// If there's a compaction boundary, the conversation has
					// sufficient prior history — only check turns since boundary.
					// Without compaction, check total user turns from start.
					if (userTurnsSinceBoundary <= protectedTurns) {
						const context = hasCompactionBoundary
							? "since the last compaction"
							: "in this session";
						throw new Error(
							`Cannot compress: only ${userTurnsSinceBoundary} user turn(s) ${context}. ` +
							`At least ${protectedTurns + 1} user turns are required before compression ` +
							`to ensure there is completed work worth crystallizing. ` +
							`Complete the current phase first, then compress it.`
						);
					}
				} catch (err) {
					// Re-throw our own validation errors, swallow infrastructure errors
					if (err instanceof Error && err.message.startsWith("Cannot compress:")) {
						throw err;
					}
					// Best-effort: if session access fails, allow compression
				}
			}

			// Batch mode: auto-detect range from last compression point
			if (compressMode === "batch" || !params.startId || !params.endId) {
				// Auto-detect start from last active compression block
				const lastBlock = getActiveBlocks(sessionId)
					.sort((a: any, b: any) => b.block_id - a.block_id)[0];
				params.startId = params.startId?.trim() || 
					(lastBlock ? `after "${lastBlock.topic}" (block ${lastBlock.block_id})` : "beginning of session");
				params.endId = params.endId?.trim() || "current conversation state";
			}

			if (config.compress.permission === "ask") {
				if (!ctx.hasUI) {
					throw new Error(
						"Compression requires user confirmation, but no UI is available to ask.",
					);
				}

				const approved = await ctx.ui.confirm(
					"Compress context?",
					`Topic: ${params.topic}\nMode: ${modeLabel}\nRange: ${params.startId} → ${params.endId}`,
				);
				if (!approved) {
					throw new Error("Compression cancelled by user.");
				}
			}

			// Use a session ID (derive from context)
			const sessionId = getSessionId(ctx);

			// Allocate block ID
			const blockId = getNextBlockId(sessionId);

			// Estimate tokens in summary
			const summaryTokens = estimateTokens(params.summary);

			// Store the compression block
			storeCompressionBlock(
				sessionId,
				blockId,
				params.topic.trim(),
				params.startId.trim(),
				params.endId.trim(),
				params.summary.trim(),
				summaryTokens,
			);

			// Update session stats
			const existing = getSessionStats(sessionId);
			const newSummaryTokens =
				(existing?.total_summary_tokens ?? 0) + summaryTokens;
			updateSessionStats(sessionId, {
				total_compressions:
					(existing?.total_compressions ?? 0) + 1,
				total_compressed_tokens:
					(existing?.total_compressed_tokens ?? 0) +
					summaryTokens,
				total_summary_tokens: newSummaryTokens,
			});

			// Build response
			const activeBlocks = getActiveBlocks(sessionId);
			const totalActive = activeBlocks.length;

			// Check summaryBuffer status
			const summaryBufferLimit = config.compress.summaryBuffer;
			const summaryBufferUsed = Math.round(
				(newSummaryTokens / summaryBufferLimit) * 100,
			);

			// Build response
			const resultLines = [
				`[Compressed conversation section b${blockId}]`,
				`Topic: ${params.topic}`,
				`Mode: ${modeLabel}`,
				`Range: ${params.startId} → ${params.endId}`,
				`Summary tokens: ~${summaryTokens}`,
				`Active compressions: ${totalActive}`,
				`Summary buffer: ~${newSummaryTokens}/${summaryBufferLimit} tokens (${summaryBufferUsed}%)`,
				"",
				"The following is the authoritative summary of the compressed range:",
				"",
				params.summary,
			];

			// Iterative summary support: show prior blocks so agent builds
			// on previous summaries instead of starting from scratch.
			const priorBlocks = getActiveBlocks(sessionId).filter(
				(b) => b.block_id !== blockId,
			);
			if (priorBlocks.length > 0) {
				resultLines.push("");
				resultLines.push(
					"--- Prior compression summaries (build on these, don't repeat) ---",
				);
				for (const prior of priorBlocks) {
					resultLines.push(
						`[b${prior.block_id}: ${prior.topic}] (~${prior.compressed_tokens} tokens)`,
					);
					// Truncate prior summaries to avoid ballooning token cost
					const truncated =
						prior.summary.length > 500
							? prior.summary.slice(0, 500) + "... [truncated]"
							: prior.summary;
					resultLines.push(truncated);
					resultLines.push("");
				}
				resultLines.push(
					"Tip: Reference prior block findings by [bN] instead of repeating them. Focus your summary on NEW information.",
				);
			}

			// Message-mode: include priority suggestions for next compression targets
			if (compressMode === "message" && getPriorityMap) {
				const map = getPriorityMap();
				if (map && map.topTargets.length > 0) {
					resultLines.push("");
					resultLines.push("--- Next compression targets (by token size) ---");
					for (const target of map.topTargets) {
						resultLines.push(`  • ${target}`);
					}
					if (map.high.length > 0) {
						resultLines.push(`Tip: ${map.high.length} high-priority tool groups (>5k tokens each). Consider compressing ranges containing these results.`);
					}
				}
			}

			const result = resultLines.join("\n");

			return {
				content: [{ type: "text", text: result }],
				details: {
					blockId,
					topic: params.topic,
					mode: compressMode,
					summaryTokens,
					totalActive,
					summaryBufferUsed: `${summaryBufferUsed}%`,
				},
			};
		},
	});
}

// ---------------------------------------------------------------------------
// DCP stats tool
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Resolve Reference Tool — reads back offloaded ref files by marker
// ---------------------------------------------------------------------------


const REFS_BASE = join(homedir(), ".config", "pi", "dcp", "refs");

export function registerResolveRefTool(
	pi: ExtensionAPI,
	config: DCPConfig,
): void {
	pi.registerTool({
		name: "resolve_ref",
		label: "Resolve Ref",
		description:
			"Read back the original content of a reference marker in the conversation, " +
			"e.g. \"[offloaded to refs/abc.md]\". The ref marker contains tool output that was " +
			"offloaded to save context space. Pass the exact marker text or the ref filename.",
		parameters: Type.Object({
			ref: Type.String({
				description: "The ref filename (e.g. \"read_tc-001.md\") or marker text to resolve",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				// Extract filename from marker text like "[offloaded to refs/filename.md]"
				let filename = params.ref;
				const markerMatch = filename.match(/\[offloaded to refs\/([^\]]+)\]/);
				if (markerMatch) {
					filename = markerMatch[1];
				}
				if (!filename.endsWith(".md")) {
					filename += ".md";
				}

				// Search session refs dir first, then global
				const sessionId = await ctx.sessionManager.getSessionFile?.() ?? "unknown";
				const sessionName = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
				const searchPaths = [
					join(REFS_BASE, sessionName, filename),
					join(REFS_BASE, filename),
				];

				for (const refPath of searchPaths) {
					if (existsSync(refPath)) {
						const content = readFileSync(refPath, "utf-8");
						return {
							content: [{ type: "text", text: content }],
							details: { source: refPath },
						};
					}
				}

				return {
					content: [{ type: "text", text: `[Ref not found: ${filename}. Searched: ${searchPaths.join(", ")}]` }],
					details: { found: false, searched: searchPaths },
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `[Error resolving ref: ${err instanceof Error ? err.message : String(err)}]` }],
					details: { error: true },
				};
			}
		},
	});
}
