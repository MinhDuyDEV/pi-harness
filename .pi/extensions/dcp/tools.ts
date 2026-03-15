/**
 * DCP Extension — Compress Tool
 *
 * Registers the `compress` tool that allows the AI agent to crystallize
 * completed conversation ranges into dense summaries.
 *
 * Ported from @tarquinen/opencode-dcp compress tool.
 *
 * Pi limitation: Cannot modify messages in-flight (no message transform hooks).
 * Instead, stores compression summaries in SQLite for cross-session persistence
 * and returns the summary to the agent for reference.
 */

import { Type } from "@sinclair/typebox";

import { COMPRESS_PROTECTED_TOOLS, type DCPConfig } from "./config.js";
import {
	getActiveBlocks,
	getAllBlocks,
	getGlobalStats,
	getNextBlockId,
	getSessionStats,
	getToolCallDedupAnalysis,
	getToolCallFrequency,
	storeCompressionBlock,
	updateSessionStats,
	deactivateBlock,
} from "./db.js";

// ---------------------------------------------------------------------------
// Token estimation (lightweight, no external tokenizer dependency)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
	// ~4 chars per token (rough estimate, matches Anthropic's rule of thumb)
	return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Compress tool description (from DCP's compress prompt)
// ---------------------------------------------------------------------------

const COMPRESS_DESCRIPTION = `Collapse a range in the conversation into a detailed summary.

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

Before compressing, ask: "Is this range closed enough to become summary-only right now?"`;

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCompressTool(pi: any, config: DCPConfig): void {
	if (config.compress.permission === "deny") {
		return;
	}

	pi.registerTool({
		name: "compress",
		label: "Compress Context",
		description: COMPRESS_DESCRIPTION,
		parameters: Type.Object({
			topic: Type.String({
				description:
					"Short label (3-5 words) for display — e.g., 'Auth System Exploration'",
			}),
			startId: Type.String({
				description:
					"Description of where the range starts — e.g., 'beginning of auth research'",
			}),
			endId: Type.String({
				description:
					"Description of where the range ends — e.g., 'auth implementation verified'",
			}),
			summary: Type.String({
				description:
					"Complete technical summary replacing all content in range. Must be exhaustive.",
			}),
		}),
		async execute(
			toolCallId: string,
			params: {
				topic: string;
				startId: string;
				endId: string;
				summary: string;
			},
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			ctx: any,
		) {
			try {
				// Validate args
				if (!params.topic?.trim()) {
					return {
						content: [
							{
								type: "text",
								text: "Error: topic is required and must be a non-empty string",
							},
						],
						details: {},
					};
				}

				if (!params.summary?.trim()) {
					return {
						content: [
							{
								type: "text",
								text: "Error: summary is required and must be a non-empty string",
							},
						],
						details: {},
					};
				}

				// Use a session ID (from context or fallback)
				const sessionId =
					ctx?.sessionId ?? "default";

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
				updateSessionStats(sessionId, {
					total_compressions:
						(existing?.total_compressions ?? 0) + 1,
					total_compressed_tokens:
						(existing?.total_compressed_tokens ?? 0) +
						summaryTokens,
				});

				// Build response
				const activeBlocks = getActiveBlocks(sessionId);
				const totalActive = activeBlocks.length;

				const result = [
					`[Compressed conversation section b${blockId}]`,
					`Topic: ${params.topic}`,
					`Range: ${params.startId} → ${params.endId}`,
					`Summary tokens: ~${summaryTokens}`,
					`Active compressions: ${totalActive}`,
					"",
					"The following is the authoritative summary of the compressed range:",
					"",
					params.summary,
				].join("\n");

				return {
					content: [{ type: "text", text: result }],
					details: {
						blockId,
						topic: params.topic,
						summaryTokens,
						totalActive,
					},
				};
			} catch (err) {
				const errMsg =
					err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Error during compression: ${errMsg}`,
						},
					],
					details: {},
				};
			}
		},
	});
}

// ---------------------------------------------------------------------------
// DCP stats tool
// ---------------------------------------------------------------------------

export function registerDCPStatsTool(pi: any, config: DCPConfig): void {
	pi.registerTool({
		name: "dcp-stats",
		label: "DCP Statistics",
		description:
			"Show context pruning statistics for the current session or globally. Use to monitor context savings.",
		parameters: Type.Object({
			scope: Type.Optional(
				Type.String({
					description:
						'"session" (default) for current session stats, "global" for all sessions',
				}),
			),
			session_id: Type.Optional(
				Type.String({ description: "Specific session ID to query" }),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { scope?: string; session_id?: string },
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			ctx: any,
		) {
			try {
				const scope = params.scope ?? "session";

				if (scope === "global") {
					const stats = getGlobalStats();
					const dedup = getToolCallDedupAnalysis();
					const freq = getToolCallFrequency();

					const result = [
						"## DCP Global Statistics",
						"",
						`Sessions tracked: ${stats.totalSessions}`,
						`Total compressions: ${stats.totalCompressions}`,
						`Total compressed tokens: ~${stats.totalCompressedTokens}`,
						`Total pruned tokens: ~${stats.totalPrunedTokens}`,
						"",
						`### Tool Call Analysis (${dedup.totalCalls} total, ${dedup.uniqueCalls} unique)`,
						...(freq.length > 0
							? freq.map((f) => `  ${f.tool_name}: ${f.calls}`)
							: ["  (no tool calls tracked)"]),
						...(dedup.duplicates.length > 0
							? [
									"",
									`### Duplicate Calls (${dedup.duplicates.length} patterns)`,
									...dedup.duplicates.map(
										(d) =>
											`  ${d.tool_name} [${d.parameters_hash}]: ${d.calls}x`,
									),
								]
							: []),
					].join("\n");

					return {
						content: [{ type: "text", text: result }],
						details: {},
					};
				}

				// Session stats
				const sessionId =
					params.session_id ??
					ctx?.sessionId ??
					"default";
				const stats = getSessionStats(sessionId);
				const blocks = getAllBlocks(sessionId);
				const activeBlocks = blocks.filter((b) => b.active);

				if (!stats && blocks.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No DCP data found for session: ${sessionId}`,
							},
						],
						details: {},
					};
				}

				const blockLines = activeBlocks.map(
					(b) =>
						`  b${b.block_id}: "${b.topic}" (~${b.compressed_tokens} tokens)`,
				);

				const dedup = getToolCallDedupAnalysis(sessionId);
				const freq = getToolCallFrequency(sessionId);

				const result = [
					`## DCP Session Statistics — ${sessionId}`,
					"",
					`Compressions: ${stats?.total_compressions ?? 0}`,
					`Compressed tokens: ~${stats?.total_compressed_tokens ?? 0}`,
					`Pruned tokens: ~${stats?.total_pruned_tokens ?? 0}`,
					`Current turn: ${stats?.current_turn ?? 0}`,
					"",
					`### Active Compression Blocks (${activeBlocks.length})`,
					...(blockLines.length > 0
						? blockLines
						: ["  (none)"]),
					"",
					`### Total Blocks: ${blocks.length} (${blocks.length - activeBlocks.length} deactivated)`,
					"",
					`### Tool Calls (${dedup.totalCalls} total, ${dedup.uniqueCalls} unique)`,
					...(freq.length > 0
						? freq.map((f) => `  ${f.tool_name}: ${f.calls}`)
						: ["  (no tool calls tracked)"]),
					...(dedup.duplicates.length > 0
						? [
								"",
								`### Duplicate Calls (${dedup.duplicates.length} patterns — compress candidates)`,
								...dedup.duplicates.map(
									(d) =>
										`  ${d.tool_name} [${d.parameters_hash}]: ${d.calls}x`,
								),
							]
						: []),
				].join("\n");

				return {
					content: [{ type: "text", text: result }],
					details: {},
				};
			} catch (err) {
				const errMsg =
					err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Error fetching DCP stats: ${errMsg}`,
						},
					],
					details: {},
				};
			}
		},
	});
}

// ---------------------------------------------------------------------------
// DCP decompress tool
// ---------------------------------------------------------------------------

export function registerDecompressTool(pi: any, config: DCPConfig): void {
	if (config.compress.permission === "deny") {
		return;
	}

	pi.registerTool({
		name: "decompress",
		label: "Decompress Block",
		description:
			"Restore a specific compression block by ID, returning the full stored summary. Use to review what was compressed.",
		parameters: Type.Object({
			block_id: Type.Optional(
				Type.Number({
					description:
						"Block ID to decompress. Omit to list available blocks.",
				}),
			),
			session_id: Type.Optional(
				Type.String({ description: "Specific session ID" }),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { block_id?: number; session_id?: string },
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			ctx: any,
		) {
			try {
				const sessionId =
					params.session_id ??
					ctx?.sessionId ??
					"default";

				if (params.block_id === undefined) {
					// List available blocks
					const blocks = getActiveBlocks(sessionId);
					if (blocks.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No active compression blocks found.",
								},
							],
							details: {},
						};
					}

					const lines = blocks.map(
						(b) =>
							`  b${b.block_id}: "${b.topic}" (~${b.compressed_tokens} tokens, ${new Date(b.created_at).toISOString().slice(0, 19)})`,
					);

					const result = [
						"## Active Compression Blocks",
						"",
						...lines,
						"",
						"Use decompress with a block_id to view the full summary.",
					].join("\n");

					return {
						content: [{ type: "text", text: result }],
						details: {},
					};
				}

				// Fetch specific block
				const blocks = getAllBlocks(sessionId);
				const block = blocks.find(
					(b) => b.block_id === params.block_id,
				);

				if (!block) {
					return {
						content: [
							{
								type: "text",
								text: `Block b${params.block_id} not found in session ${sessionId}.`,
							},
						],
						details: {},
					};
				}

				const status = block.active ? "active" : "deactivated";
				const result = [
					`## Compression Block b${block.block_id}`,
					"",
					`Topic: ${block.topic}`,
					`Status: ${status}`,
					`Range: ${block.start_id} → ${block.end_id}`,
					`Tokens: ~${block.compressed_tokens}`,
					`Created: ${new Date(block.created_at).toISOString().slice(0, 19)}`,
					"",
					"### Summary",
					"",
					block.summary,
				].join("\n");

				return {
					content: [{ type: "text", text: result }],
					details: {},
				};
			} catch (err) {
				const errMsg =
					err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Error during decompress: ${errMsg}`,
						},
					],
					details: {},
				};
			}
		},
	});
}
