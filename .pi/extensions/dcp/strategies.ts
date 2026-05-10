/**
 * DCP Extension — Runtime Auto-Pruning Strategies (v2)
 *
 * Implements deduplication, supersede-writes, purge-errors, and compress-range
 * stripping as runtime message filters via Pi's `context` event hook.
 *
 * These strategies operate on AgentMessage[] deep copies — safe to mutate.
 * The `context` event fires before EVERY LLM call, so these run automatically.
 *
 * IMPORTANT: AgentMessage[] uses pi-agent-core internal format:
 *   - Tool calls: { role: "assistant", content: [{ type: "toolCall", name, arguments }] }
 *   - Tool results: { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }] }
 *   - Custom: { role: "custom", customType, content: string | ContentPart[] }
 *   - Compaction: { role: "compactionSummary", summary }
 * NOT the Anthropic API format (tool_use/tool_result).
 */

import type { DCPConfig } from "./config.js";
import { hashParams, estimateTokens } from "./utils.js";
import { getTagsForSession, type MessageTag } from "./db.js";

// ---------------------------------------------------------------------------
// AgentMessage type shapes (from @mariozechner/pi-agent-core + pi-ai)
//
// We use structural typing to avoid a hard dependency on the core package.
// The context event passes deep-cloned AgentMessage[] — we match their shape.
// ---------------------------------------------------------------------------

/** Assistant message tool call content block (pi-ai format) */
interface ToolCallContent {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

/** Text content block */
interface TextContent {
	type: "text";
	text: string;
}

/** Thinking content block */
interface ThinkingContent {
	type: "thinking";
	thinking: string;
}

type AssistantContentPart = ToolCallContent | TextContent | ThinkingContent | { type: string; [key: string]: unknown };

/** Assistant message */
interface AssistantMessage {
	role: "assistant";
	content: AssistantContentPart[];
	timestamp: number;
	[key: string]: unknown;
}

/** Tool result message (separate top-level message, NOT nested in content) */
interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: Array<TextContent | { type: string; [key: string]: unknown }>;
	isError: boolean;
	timestamp: number;
	[key: string]: unknown;
}

/** User message */
interface UserMessage {
	role: "user";
	content: string | Array<TextContent | { type: string; [key: string]: unknown }>;
	timestamp: number;
	[key: string]: unknown;
}

/** Custom message (extension-injected) */
interface CustomMessage {
	role: "custom";
	customType: string;
	content: string | Array<TextContent | { type: string; [key: string]: unknown }>;
	display: boolean;
	timestamp: number;
	[key: string]: unknown;
}

/** Compaction summary message */
interface CompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	timestamp: number;
	[key: string]: unknown;
}

type AgentMessage = AssistantMessage | ToolResultMessage | UserMessage | CustomMessage | CompactionSummaryMessage | { role: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Strategy result tracking
// ---------------------------------------------------------------------------

export interface StrategyResult {
	prunedTokens: number;
	prunedCount: number;
	actions: string[];
}

/** Raw messages from a compressed range, for ctx_expand storage */
export interface CompressedRange {
	/** Compression block ID (from the compress tool result, e.g. b3 → 3) */
	blockId: number;
	/** Raw messages in the compressed range (before stripping) */
	rawMessages: AgentMessage[];
}

// ---------------------------------------------------------------------------
// Compression Priority Map
//
// Token-classifies tool results by size so nudge messages can point the
// model at the biggest compression targets first.
// ---------------------------------------------------------------------------

export interface PriorityEntry {
	toolName: string;
	count: number;
	totalTokens: number;
}

export interface PriorityMap {
	/** Tool groups with >5000 total tokens */
	high: PriorityEntry[];
	/** Tool groups with 500-5000 total tokens */
	medium: PriorityEntry[];
	/** Tool groups with <500 total tokens */
	low: PriorityEntry[];
	/** Total tokens across all messages */
	totalTokens: number;
	/** Human-readable descriptions of biggest compression targets */
	topTargets: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// estimateTokens imported from ./utils.js

function estimateMessageTokens(msg: AgentMessage): number {
	if (msg.role === "toolResult") {
		const tr = msg as ToolResultMessage;
		let total = 0;
		for (const part of tr.content) {
			if (part.type === "text") total += estimateTokens((part as TextContent).text);
		}
		return total;
	}
	if (msg.role === "assistant") {
		const am = msg as AssistantMessage;
		let total = 0;
		for (const part of am.content) {
			if (part.type === "text") total += estimateTokens((part as TextContent).text);
			if (part.type === "toolCall") total += estimateTokens(JSON.stringify((part as ToolCallContent).arguments));
		}
		return total;
	}
	if (msg.role === "user") {
		const um = msg as UserMessage;
		if (typeof um.content === "string") return estimateTokens(um.content);
		let total = 0;
		for (const part of um.content) {
			if (part.type === "text") total += estimateTokens((part as TextContent).text);
		}
		return total;
	}
	if (msg.role === "custom") {
		const cm = msg as CustomMessage;
		if (typeof cm.content === "string") return estimateTokens(cm.content);
		let total = 0;
		for (const part of cm.content) {
			if (part.type === "text") total += estimateTokens((part as TextContent).text);
		}
		return total;
	}
	if (msg.role === "compactionSummary") {
		return estimateTokens((msg as CompactionSummaryMessage).summary);
	}
	return 50; // Unknown message type — conservative estimate
}

// isProtectedTool is now handled by the cached protectedToolSet in applyStrategies

// ---------------------------------------------------------------------------
// Tool operation extraction (pi-agent-core format)
// ---------------------------------------------------------------------------

interface ToolOp {
	/** Index of the message in the messages array */
	messageIndex: number;
	/** For assistant messages: index of the toolCall in content array */
	contentIndex: number;
	type: "call" | "result";
	toolName: string;
	toolCallId: string;
	paramsHash: string;
	isError: boolean;
	tokenEstimate: number;
}

/**
 * Extract tool calls and tool results from messages.
 *
 * In pi-agent-core format:
 * - Tool calls are content blocks in assistant messages: { type: "toolCall", name, arguments }
 * - Tool results are separate top-level messages: { role: "toolResult", toolName, toolCallId }
 */
function extractToolOps(messages: AgentMessage[]): ToolOp[] {
	const ops: ToolOp[] = [];

	for (let mi = 0; mi < messages.length; mi++) {
		const msg = messages[mi];

		// Tool calls: inside assistant message content array
		if (msg.role === "assistant") {
			const am = msg as AssistantMessage;
			if (!Array.isArray(am.content)) continue;

			for (let ci = 0; ci < am.content.length; ci++) {
				const part = am.content[ci];
				if (part.type === "toolCall") {
					const tc = part as ToolCallContent;
					ops.push({
						messageIndex: mi,
						contentIndex: ci,
						type: "call",
						toolName: tc.name,
						toolCallId: tc.id,
						paramsHash: hashParams(tc.arguments),
						isError: false,
						tokenEstimate: estimateTokens(JSON.stringify(tc.arguments)),
					});
				}
			}
		}

		// Tool results: separate messages with role "toolResult"
		if (msg.role === "toolResult") {
			const tr = msg as ToolResultMessage;
			let resultTokens = 0;
			for (const part of tr.content) {
				if (part.type === "text") resultTokens += estimateTokens((part as TextContent).text);
			}
			ops.push({
				messageIndex: mi,
				contentIndex: -1, // N/A — toolResult is a top-level message
				type: "result",
				toolName: tr.toolName,
				toolCallId: tr.toolCallId,
				paramsHash: "",
				isError: tr.isError,
				tokenEstimate: resultTokens,
			});
		}
	}

	return ops;
}

// ---------------------------------------------------------------------------
// Strategy 0: Compress Range Stripping
//
// When the agent calls `compress`, the summary is stored in the tool result.
// But the ORIGINAL messages in the range are still in context.
// This strategy finds compress tool results, identifies the messages BEFORE
// the compress call (up to the previous compress or start), and replaces
// them with a single compact summary message.
//
// Flow:
// 1. Find all compress tool_result messages in the array
// 2. For each compress result, find the corresponding assistant toolCall
// 3. Messages between [start or previous_compress, compress_call) are the range
// 4. Replace the range with a single user-role summary message
// 5. Remove the compress tool_use + tool_result pair (summary is inlined)
// ---------------------------------------------------------------------------

function applyCompressStripping(
	messages: AgentMessage[],
	config: DCPConfig,
): { messages: AgentMessage[]; result: StrategyResult; rawRanges: CompressedRange[] } {
	const result: StrategyResult = { prunedTokens: 0, prunedCount: 0, actions: [] };
	const rawRanges: CompressedRange[] = [];

	// Find compress tool results
	const compressResults: Array<{
		resultIndex: number;
		callIndex: number;
		callContentIndex: number;
		summary: string;
		topic: string;
		blockId: number;
	}> = [];

	const ops = extractToolOps(messages);

	for (const op of ops) {
		if (op.type === "result" && op.toolName === "compress" && !op.isError) {
			// Find the corresponding tool call
			const callOp = ops.find(
				(o) => o.type === "call" && o.toolCallId === op.toolCallId,
			);
			if (!callOp) continue;

			// Extract full text from the tool result
			const resultMsg = messages[op.messageIndex] as ToolResultMessage;
			let fullResultText = "";
			let topic = "";
			for (const part of resultMsg.content) {
				if (part.type === "text") {
					fullResultText += (part as TextContent).text;
				}
			}

			// Extract topic from the tool call arguments
			const callMsg = messages[callOp.messageIndex] as AssistantMessage;
			const toolCall = callMsg.content[callOp.contentIndex] as ToolCallContent;
			topic = (toolCall.arguments?.topic as string) ?? "compressed";

			if (!fullResultText) continue;

			// Parse block ID from result text: "[Compressed conversation section b3]"
			const blockIdMatch = fullResultText.match(/section b(\d+)/);
			const blockId = blockIdMatch ? parseInt(blockIdMatch[1], 10) : -1;

			// Extract just the summary (strip metadata headers and priority suggestions)
			const summaryMarker = "The following is the authoritative summary of the compressed range:";
			const markerIdx = fullResultText.indexOf(summaryMarker);
			let cleanSummary: string;
			if (markerIdx >= 0) {
				cleanSummary = fullResultText.substring(markerIdx + summaryMarker.length).trim();
				// Strip trailing priority suggestions if present
				const priorityIdx = cleanSummary.indexOf("--- Next compression targets");
				if (priorityIdx >= 0) {
					cleanSummary = cleanSummary.substring(0, priorityIdx).trim();
				}
			} else {
				cleanSummary = fullResultText;
			}

			compressResults.push({
				resultIndex: op.messageIndex,
				callIndex: callOp.messageIndex,
				callContentIndex: callOp.contentIndex,
				summary: cleanSummary,
				topic,
				blockId,
			});
		}
	}

	if (compressResults.length === 0) {
		return { messages, result, rawRanges };
	}

	// Sort by callIndex ascending
	compressResults.sort((a, b) => a.callIndex - b.callIndex);

	// Build the set of message indices to remove and summaries to inject
	const indicesToRemove = new Set<number>();
	const summariesToInject: Array<{ atIndex: number; summary: string; topic: string }> = [];

	// Build protected tool set once for all ranges
	const protectedToolSet = new Set(config.compress.protectedTools);

	for (let i = 0; i < compressResults.length; i++) {
		const cr = compressResults[i];

		// Range start: after the previous compress result (or 0 for the first)
		let rangeStart: number;
		if (i === 0) {
			// First compress — strip from the beginning of messages
			// But protect compactionSummary messages at the start (they're Pi's summaries)
			rangeStart = 0;
			while (rangeStart < cr.callIndex && messages[rangeStart]?.role === "compactionSummary") {
				rangeStart++;
			}
		} else {
			// After the previous compress result
			rangeStart = compressResults[i - 1].resultIndex + 1;
		}

		// Range end: just before the compress tool call message
		const rangeEnd = cr.callIndex;

		// Calculate tokens being stripped + collect nested block summaries + protected content
		let strippedTokens = 0;
		const nestedSummaries: string[] = [];
		const protectedContent: string[] = [];
		for (let j = rangeStart; j < rangeEnd; j++) {
			if (!indicesToRemove.has(j)) {
				strippedTokens += estimateMessageTokens(messages[j]);
				indicesToRemove.add(j);

				const m = messages[j];

				// Nested block overlap: preserve older compressed summaries
				if (m.role === "custom" && (m as CustomMessage).customType === "dcp-compressed-summary") {
					const content = (m as CustomMessage).content;
					if (typeof content === "string" && content.trim()) {
						nestedSummaries.push(content);
					}
				}

				// Protected tool outputs: auto-preserve results from protected tools
				// (mirrors OpenCode DCP range.ts — prevents info loss for observation, todowrite, etc.)
				if (m.role === "toolResult" && protectedToolSet.size > 0) {
					const tm = m as ToolResultMessage;
					if (protectedToolSet.has(tm.toolName) && !tm.isError) {
						let text = "";
						for (const part of tm.content) {
							if (part.type === "text") text += (part as TextContent).text;
						}
						if (text.trim()) {
							protectedContent.push(`[${tm.toolName}] ${text.trim()}`);
						}
					}
				}

				// Protected user messages: auto-preserve user intent
				if (config.compress.protectUserMessages && m.role === "user") {
					const um = m as UserMessage;
					let text = "";
					if (typeof um.content === "string") {
						text = um.content;
					} else if (Array.isArray(um.content)) {
						for (const part of um.content) {
							if (part.type === "text") text += (part as TextContent).text;
						}
					}
					if (text.trim()) {
						protectedContent.push(`[user] ${text.trim()}`);
					}
				}
			}
		}

		// Also remove the compress tool call + result themselves
		// (the summary replaces them)
		indicesToRemove.add(cr.callIndex);
		strippedTokens += estimateMessageTokens(messages[cr.callIndex]);
		indicesToRemove.add(cr.resultIndex);
		strippedTokens += estimateMessageTokens(messages[cr.resultIndex]);

		// Collect raw messages for ctx_expand (keyed by compression block ID)
		if (cr.blockId > 0) {
			const rawMessages: AgentMessage[] = [];
			for (let j = rangeStart; j < rangeEnd; j++) {
				rawMessages.push(messages[j]);
			}
			rawRanges.push({ blockId: cr.blockId, rawMessages });
		}

		// Inject the summary as a compact message at the range start position
		// If nested summaries exist, embed them to prevent info loss through compression layers
		let finalSummary = cr.summary;
		if (nestedSummaries.length > 0) {
			const nestedSection = nestedSummaries
				.map((s) => `[Previously compressed content]\n${s}`)
				.join("\n\n");
			finalSummary = `${nestedSection}\n\n[Current compression]\n${cr.summary}`;
		}

		// Auto-append protected content that the agent's summary may have missed
		// (mirrors OpenCode DCP range.ts: protected tool outputs + user messages)
		if (protectedContent.length > 0) {
			finalSummary += `\n\n## Auto-preserved content\n${protectedContent.join("\n")}`;
		}

		summariesToInject.push({
			atIndex: rangeStart,
			summary: finalSummary,
			topic: cr.topic,
		});

		result.prunedTokens += strippedTokens;
		result.prunedCount += (rangeEnd - rangeStart) + 2; // +2 for call+result
		result.actions.push(
			`compress-strip: "${cr.topic}" removed ${rangeEnd - rangeStart} msgs + call/result (~${strippedTokens} tokens)`,
		);
	}

	// Rebuild the message array:
	// 1. Insert summary messages at injection points
	// 2. Skip removed messages
	const newMessages: AgentMessage[] = [];
	const injectionPoints = new Map<number, Array<{ summary: string; topic: string }>>();
	for (const si of summariesToInject) {
		if (!injectionPoints.has(si.atIndex)) injectionPoints.set(si.atIndex, []);
		injectionPoints.get(si.atIndex)!.push(si);
	}

	for (let i = 0; i < messages.length; i++) {
		// Inject summaries at this position (before the message at this index)
		const injects = injectionPoints.get(i);
		if (injects) {
			for (const inj of injects) {
				// Create a custom message with the summary
				// This will be converted to a user message by convertToLlm
				newMessages.push({
					role: "custom",
					customType: "dcp-compressed-summary",
					content: inj.summary,
					display: false,
					timestamp: Date.now(),
				} as any);
			}
		}

		// Skip removed messages
		if (indicesToRemove.has(i)) continue;

		newMessages.push(messages[i]);
	}

	// Handle injections at positions beyond current messages (shouldn't happen, but safe)
	for (const [idx, injects] of injectionPoints) {
		if (idx >= messages.length) {
			for (const inj of injects) {
				newMessages.push({
					role: "custom",
					customType: "dcp-compressed-summary",
					content: inj.summary,
					display: false,
					timestamp: Date.now(),
				} as any);
			}
		}
	}

	return { messages: newMessages, result, rawRanges };
}

// ---------------------------------------------------------------------------
// Strategy 1: Deduplication
//
// When same tool + same args runs multiple times, strip content from older
// occurrences. Keep only the most recent result.
// ---------------------------------------------------------------------------

function applyDeduplication(
	messages: AgentMessage[],
	config: DCPConfig,
	ops: ToolOp[],
	protectedToolSet: Set<string>,
): StrategyResult {
	if (!config.strategies.deduplication.enabled) {
		return { prunedTokens: 0, prunedCount: 0, actions: [] };
	}

	const result: StrategyResult = { prunedTokens: 0, prunedCount: 0, actions: [] };

	// Group tool calls by name+paramsHash
	const groups = new Map<string, ToolOp[]>();
	for (const op of ops) {
		if (op.type !== "call") continue;
		if (!op.toolName || !op.paramsHash) continue;
		if (protectedToolSet.has(op.toolName)) continue;

		const key = `${op.toolName}:${op.paramsHash}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key)!.push(op);
	}

	// For each group with > 1 call, strip content from older calls + their results
	for (const [_key, calls] of groups) {
		if (calls.length <= 1) continue;

		const latestCall = calls[calls.length - 1];

		for (let i = 0; i < calls.length - 1; i++) {
			const oldCall = calls[i];

			// Strip the toolCall arguments in the assistant message
			const msg = messages[oldCall.messageIndex] as AssistantMessage;
			if (Array.isArray(msg.content)) {
				const tc = msg.content[oldCall.contentIndex] as ToolCallContent;
				const savedTokens = estimateTokens(JSON.stringify(tc.arguments));
				tc.arguments = { _dcp_deduped: true, _note: `Duplicate of later call at msg ${latestCall.messageIndex}` };
				result.prunedTokens += savedTokens;
				result.prunedCount++;
			}

			// Strip the corresponding toolResult message content
			for (const op of ops) {
				if (op.type === "result" && op.toolCallId === oldCall.toolCallId) {
					const rmsg = messages[op.messageIndex] as ToolResultMessage;
					const savedResultTokens = op.tokenEstimate;
					rmsg.content = [{ type: "text", text: "[DCP: deduplicated — see latest call]" }];
					result.prunedTokens += savedResultTokens;
				}
			}

			result.actions.push(`dedup: ${oldCall.toolName} (msg ${oldCall.messageIndex})`);
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Strategy 2: Supersede-Writes
//
// When a file is written (write/edit) then later read, the write's input
// content is redundant — the read has the current state.
// ---------------------------------------------------------------------------

function applySupersedeWrites(
	messages: AgentMessage[],
	config: DCPConfig,
	ops: ToolOp[],
): StrategyResult {
	if (!config.strategies.supersedeWrites.enabled) {
		return { prunedTokens: 0, prunedCount: 0, actions: [] };
	}

	const result: StrategyResult = { prunedTokens: 0, prunedCount: 0, actions: [] };

	const writeTools = new Set(["write", "edit"]);
	const readTools = new Set(["read", "srcwalk_read"]);

	// Build map: filepath → message index of latest read
	const fileReads = new Map<string, number>();
	for (const op of ops) {
		if (op.type !== "call") continue;
		if (!readTools.has(op.toolName)) continue;

		const msg = messages[op.messageIndex] as AssistantMessage;
		const tc = msg.content[op.contentIndex] as ToolCallContent;
		const filePath = (tc.arguments?.path as string) ?? "";
		if (filePath) {
			fileReads.set(filePath, op.messageIndex);
		}
	}

	// Find writes where a later read exists
	for (const op of ops) {
		if (op.type !== "call") continue;
		if (!writeTools.has(op.toolName)) continue;

		const msg = messages[op.messageIndex] as AssistantMessage;
		const tc = msg.content[op.contentIndex] as ToolCallContent;
		const filePath = (tc.arguments?.path as string) ?? "";
		if (!filePath) continue;

		const latestReadIdx = fileReads.get(filePath);
		if (latestReadIdx === undefined || latestReadIdx <= op.messageIndex) continue;

		// Write is superseded by later read
		const contentStr = (tc.arguments?.content as string) ?? JSON.stringify(tc.arguments);
		const savedTokens = estimateTokens(contentStr);

		tc.arguments = {
			path: filePath,
			_dcp_superseded: true,
			_note: `Content superseded by later read at msg ${latestReadIdx}`,
		};
		result.prunedTokens += savedTokens;
		result.prunedCount++;
		result.actions.push(`supersede: ${op.toolName}(${filePath}) at msg ${op.messageIndex}`);
	}

	return result;
}

// ---------------------------------------------------------------------------
// Strategy 3: Purge Errors
//
// After N turns, strip large input content from errored tool calls.
// Keep the error message for debugging context.
// ---------------------------------------------------------------------------

function applyPurgeErrors(
	messages: AgentMessage[],
	config: DCPConfig,
	currentTurn: number,
	ops: ToolOp[],
	protectedToolSet: Set<string>,
): StrategyResult {
	if (!config.strategies.purgeErrors.enabled) {
		return { prunedTokens: 0, prunedCount: 0, actions: [] };
	}

	const result: StrategyResult = { prunedTokens: 0, prunedCount: 0, actions: [] };
	const turnsThreshold = config.strategies.purgeErrors.turns;

	// Find errored tool result call IDs
	const erroredCallIds = new Set<string>();
	for (const op of ops) {
		if (op.type === "result" && op.isError) {
			erroredCallIds.add(op.toolCallId);
		}
	}

	// Find the corresponding tool calls and strip their inputs if old enough
	for (const op of ops) {
		if (op.type !== "call") continue;
		if (!erroredCallIds.has(op.toolCallId)) continue;
		if (protectedToolSet.has(op.toolName)) continue;
		if (config.strategies.purgeErrors.protectedTools.includes(op.toolName)) continue;

		// Estimate age: use message position as proxy for turns
		// (currentTurn resets on compaction, so use relative position from end)
		const relativeAge = messages.length - op.messageIndex;
		const estimatedTurnAge = Math.max(1, Math.floor(relativeAge / 3)); // ~3 msgs per turn (call + result + text)

		if (estimatedTurnAge < turnsThreshold) continue;

		// Strip the tool call arguments
		const msg = messages[op.messageIndex] as AssistantMessage;
		if (Array.isArray(msg.content)) {
			const tc = msg.content[op.contentIndex] as ToolCallContent;
			const inputStr = JSON.stringify(tc.arguments);
			const savedTokens = estimateTokens(inputStr);

			// Only strip substantial inputs (> 200 chars / ~50 tokens)
			if (inputStr.length < 200) continue;

			tc.arguments = {
				_dcp_error_purged: true,
				_tool: op.toolName,
				_note: `Errored input purged after ~${estimatedTurnAge} turns (~${savedTokens} tokens saved)`,
			};
			result.prunedTokens += savedTokens;
			result.prunedCount++;
			result.actions.push(`purge-error: ${op.toolName} at msg ${op.messageIndex} (~${savedTokens} tokens)`);
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Compression Priority Map computation
// ---------------------------------------------------------------------------

/**
 * Compute a priority map of message token sizes, grouped by tool name.
 * Used by NudgeManager to include actionable compression targets in nudge messages.
 *
 * Classifies tool result groups as:
 *   - high: >5000 total tokens (compress these first)
 *   - medium: 500-5000 tokens
 *   - low: <500 tokens (not worth compressing)
 */
export function computePriorityMap(messages: AgentMessage[]): PriorityMap {
	const toolTokens = new Map<string, { count: number; totalTokens: number }>();
	let totalTokens = 0;

	for (const msg of messages) {
		const tokens = estimateMessageTokens(msg);
		totalTokens += tokens;

		// Track tool result sizes by tool name
		if (msg.role === "toolResult") {
			const tr = msg as ToolResultMessage;
			const existing = toolTokens.get(tr.toolName) ?? { count: 0, totalTokens: 0 };
			existing.count++;
			existing.totalTokens += tokens;
			toolTokens.set(tr.toolName, existing);
		}
	}

	const high: PriorityEntry[] = [];
	const medium: PriorityEntry[] = [];
	const low: PriorityEntry[] = [];

	for (const [toolName, data] of toolTokens) {
		const entry: PriorityEntry = { toolName, count: data.count, totalTokens: data.totalTokens };
		if (data.totalTokens > 5000) high.push(entry);
		else if (data.totalTokens >= 500) medium.push(entry);
		else low.push(entry);
	}

	// Sort high and medium by totalTokens descending
	high.sort((a, b) => b.totalTokens - a.totalTokens);
	medium.sort((a, b) => b.totalTokens - a.totalTokens);

	// Build human-readable top targets (top 5 biggest tool groups)
	const allSorted = [...high, ...medium].slice(0, 5);
	const topTargets = allSorted.map(
		(e) => `${e.toolName} (${e.count}x, ~${Math.round(e.totalTokens / 1000)}k tokens)`,
	);

	return { high, medium, low, totalTokens, topTargets };
}

// ---------------------------------------------------------------------------
// Combined strategy application
// ---------------------------------------------------------------------------

/**
 * Apply all enabled DCP strategies to a message array.
 * Called from the `context` event handler before every LLM call.
 *
 * Order matters:
 * 1. compress-strip (removes whole ranges, changes indices)
 * 2. dedup (strips duplicate tool calls within remaining messages)
 * 3. supersede-writes (strips write inputs superseded by reads)
 * 4. purge-errors (strips old errored tool inputs)
 *
 * @param messages - Deep-cloned AgentMessage[] from the context event (safe to mutate)
 * @param sessionId - Current session ID for DB lookups
 * @param config - DCP configuration
 * @param currentTurn - Current turn number
 * @returns The (possibly rebuilt) messages array plus pruning stats
 */
export function applyStrategies(
	messages: AgentMessage[],
	sessionId: string,
	config: DCPConfig,
	currentTurn: number,
): { messages: AgentMessage[]; totalResult: StrategyResult; rawRanges: CompressedRange[] } {
	const totalResult: StrategyResult = { prunedTokens: 0, prunedCount: 0, actions: [] };

	// Cache protected tool set once (P2 fix: avoid rebuilding per call)
	const protectedToolSet = new Set([
		...config.compress.protectedTools,
		...config.strategies.deduplication.protectedTools,
	]);

	// Strategy 0: Compress range stripping (runs first — may rebuild array)
	const compressResult = applyCompressStripping(messages, config);
	messages = compressResult.messages;
	totalResult.prunedTokens += compressResult.result.prunedTokens;
	totalResult.prunedCount += compressResult.result.prunedCount;
	totalResult.actions.push(...compressResult.result.actions);

	// Extract tool ops ONCE after compress-strip (which may rebuild the array)
	const ops = extractToolOps(messages);

	// Strategy 1: Deduplication
	const dedupResult = applyDeduplication(messages, config, ops, protectedToolSet);
	totalResult.prunedTokens += dedupResult.prunedTokens;
	totalResult.prunedCount += dedupResult.prunedCount;
	totalResult.actions.push(...dedupResult.actions);

	// Strategy 2: Supersede-writes
	const supersedeResult = applySupersedeWrites(messages, config, ops);
	totalResult.prunedTokens += supersedeResult.prunedTokens;
	totalResult.prunedCount += supersedeResult.prunedCount;
	totalResult.actions.push(...supersedeResult.actions);

	// Strategy 3: Purge-errors
	const purgeResult = applyPurgeErrors(messages, config, currentTurn, ops, protectedToolSet);
	totalResult.prunedTokens += purgeResult.prunedTokens;
	totalResult.prunedCount += purgeResult.prunedCount;
	totalResult.actions.push(...purgeResult.actions);

	return { messages, totalResult, rawRanges: compressResult.rawRanges };
}

// ---------------------------------------------------------------------------
// Deferred Drop Application
//
// Called separately from the main strategies, after the drop queue has
// resolved which tag IDs should be dropped. Looks up tag metadata from DB,
// finds matching tool operations in the current messages, and strips content.
// ---------------------------------------------------------------------------

/**
 * Apply deferred drops to messages by stripping content from tool calls/results
 * that match the dropped tag signatures (tool_name + params_hash).
 *
 * @param messages - Message array (mutated in place)
 * @param sessionId - Current session ID for tag lookups
 * @param tagIds - Set of tag IDs to drop (from DropQueue.processQueue)
 */
export function applyDeferredDrops(
	messages: AgentMessage[],
	sessionId: string,
	tagIds: Set<number>,
): StrategyResult {
	const result: StrategyResult = { prunedTokens: 0, prunedCount: 0, actions: [] };

	if (tagIds.size === 0) return result;

	// Look up the tags to get their tool_name + params_hash
	const allTags = getTagsForSession(sessionId);

	// Build a set of (tool_name, params_hash) signatures to drop
	const signaturesForDrop = new Set<string>();
	for (const tag of allTags) {
		if (tagIds.has(tag.tag_id) && tag.tool_name && tag.params_hash) {
			signaturesForDrop.add(`${tag.tool_name}:${tag.params_hash}`);
		}
	}

	if (signaturesForDrop.size === 0) return result;

	// Find matching tool operations and strip their content
	const ops = extractToolOps(messages);

	for (const op of ops) {
		if (op.type !== "call") continue;
		const sig = `${op.toolName}:${op.paramsHash}`;
		if (!signaturesForDrop.has(sig)) continue;

		// Strip the tool call arguments
		const msg = messages[op.messageIndex] as AssistantMessage;
		if (Array.isArray(msg.content)) {
			const tc = msg.content[op.contentIndex] as ToolCallContent;
			const savedTokens = estimateTokens(JSON.stringify(tc.arguments));
			tc.arguments = {
				_dcp_deferred_drop: true,
				_note: `Dropped by deferred queue (cache TTL expired)`,
			};
			result.prunedTokens += savedTokens;
			result.prunedCount++;
			result.actions.push(`deferred-drop: ${op.toolName} at msg ${op.messageIndex}`);
		}

		// Strip the corresponding tool result
		for (const resultOp of ops) {
			if (resultOp.type === "result" && resultOp.toolCallId === op.toolCallId) {
				const rmsg = messages[resultOp.messageIndex] as ToolResultMessage;
				const savedResultTokens = resultOp.tokenEstimate;
				rmsg.content = [{ type: "text", text: "[DCP: deferred drop — cache expired]" }];
				result.prunedTokens += savedResultTokens;
			}
		}
	}

	return result;
}
