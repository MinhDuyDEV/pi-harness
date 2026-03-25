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
	getNextBlockId,
	getSessionStats,
	storeCompressionBlock,
	updateSessionStats,
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

COMPRESSION MODES
- "range" (default): Select a conversation range by start/end boundaries → replace with summary.
- "message" (experimental): Compress individual messages by size priority. Use when sessions are dense
  with no clear phase boundaries. Targets the largest messages first for maximum token recovery.

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
		promptSnippet:
			"Collapse a conversation range into a dense, exhaustive summary.",
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
			mode: Type.Optional(
				Type.Union([Type.Literal("range"), Type.Literal("message")], {
					description:
						'Compression mode: "range" (default) collapses a conversation range; "message" (experimental) compresses individual messages by size priority.',
				}),
			),
		}),
		async execute(
			toolCallId: string,
			params: {
				topic: string;
				startId: string;
				endId: string;
				summary: string;
				mode?: "range" | "message";
			},
			_signal: AbortSignal,
			_onUpdate: (text: string) => void,
			ctx: any,
		) {
			try {
				const compressMode = params.mode ?? config.compress.mode;
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

				const result = [
					`[Compressed conversation section b${blockId}]`,
					`Topic: ${params.topic}`,
					`Mode: ${compressMode}`,
					`Range: ${params.startId} → ${params.endId}`,
					`Summary tokens: ~${summaryTokens}`,
					`Active compressions: ${totalActive}`,
					`Summary buffer: ~${newSummaryTokens}/${summaryBufferLimit} tokens (${summaryBufferUsed}%)`,
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
						mode: compressMode,
						summaryTokens,
						totalActive,
						summaryBufferUsed: `${summaryBufferUsed}%`,
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

