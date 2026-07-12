/**
 * DCP Step 4: tool-result pruning (MiMo-Code compaction-inspired).
 *
 * Selectively replaces large tool outputs with compacted placeholders when
 * context is tight, preserving more useful context for the LLM.
 *
 * Extracted from compress.ts to keep the orchestrator readable.
 */

import type {
	AssistantMessage,
	Message,
	TextContent,
	ToolCall,
	ToolResultMessage,
} from "@earendil-works/pi-ai";
import { estimateTokens } from "./compress-token-utils.js";

interface DCPConfigShape {
	toolResultPruning: {
		enabled: boolean;
		thresholdTokens: number;
		protectedRecentTurns: number;
		compactableTools: string[];
	};
}

/**
 * Build a short argument preview for the compaction marker.
 * Extracts the most meaningful argument (path, pattern, command, query, url)
 * and truncates to 60 chars.
 */
function shortArgPreview(toolName: string, args: Record<string, unknown>): string {
	const priorityKeys = ["path", "pattern", "command", "query", "url", "scope"];
	for (const key of priorityKeys) {
		const val = args[key];
		if (typeof val === "string" && val.trim()) {
			const preview = val.length > 60 ? val.slice(0, 60) + "..." : val;
			return `${toolName} ${preview}`;
		}
	}
	return toolName;
}

/**
 * Strategy 4: Tool-result pruning.
 *
 * Rules:
 * - Only compacts tools listed as compactable (read, bash, grep, etc.)
 * - Skips the most recent N turns (configurable via protectedRecentTurns)
 * - Only activates when estimated total tokens exceed thresholdTokens
 * - Does NOT delete messages — only truncates tool result content
 *
 * Returns statistics about what was pruned.
 */
export function pruneToolResults(
	messages: Message[],
	config: DCPConfigShape,
): { prunedTokens: number; prunedCount: number } {
	if (!config.toolResultPruning.enabled) {
		return { prunedTokens: 0, prunedCount: 0 };
	}

	const thresholdTokens = config.toolResultPruning.thresholdTokens;
	const protectedRecentTurns = config.toolResultPruning.protectedRecentTurns;
	const compactableTools = new Set(config.toolResultPruning.compactableTools);

	// Estimate total token count — skip if below threshold
	let totalTokens = 0;
	for (const msg of messages) {
		totalTokens += estimateTokens(msg);
	}
	if (totalTokens < thresholdTokens) {
		return { prunedTokens: 0, prunedCount: 0 };
	}

	// Build a map of toolCallId to arguments (from assistant toolCall blocks)
	const callArgsMap = new Map<string, Record<string, unknown>>();
	for (const msg of messages) {
		if (msg.role === "assistant") {
			const asst = msg as AssistantMessage;
			if (!Array.isArray(asst.content)) continue;
			for (const part of asst.content) {
				if (part.type === "toolCall") {
					const tc = part as ToolCall;
					callArgsMap.set(tc.id, tc.arguments as Record<string, unknown>);
				}
			}
		}
	}

	// Identify protected toolCallIds from the most recent N turns
	// A "turn" = an assistant message that contains tool calls
	const protectedCallIds = new Set<string>();
	let foundTurns = 0;
	for (let i = messages.length - 1; i >= 0 && foundTurns < protectedRecentTurns; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const asst = msg as AssistantMessage;
			if (!Array.isArray(asst.content)) continue;
			let hasToolCall = false;
			for (const part of asst.content) {
				if (part.type === "toolCall") {
					const tc = part as ToolCall;
					protectedCallIds.add(tc.id);
					hasToolCall = true;
				}
			}
			if (hasToolCall) foundTurns++;
		}
	}

	// Walk messages oldest to newest, prune compactable tool results
	let prunedTokens = 0;
	let prunedCount = 0;

	for (const msg of messages) {
		if (msg.role !== "toolResult") continue;
		const tr = msg as ToolResultMessage;

		// Skip if this result belongs to a protected (recent) turn
		if (protectedCallIds.has(tr.toolCallId)) continue;

		// Skip non-compactable tools (mutating, critical, or user-facing)
		if (!compactableTools.has(tr.toolName)) continue;

		// Calculate total content length before compaction
		let totalLen = 0;
		for (const part of tr.content) {
			if (part.type === "text") {
				totalLen += (part as TextContent).text?.length ?? 0;
			}
		}

		// Only compact non-empty results
		if (totalLen === 0) continue;

		const args = callArgsMap.get(tr.toolCallId);
		const argPreview = args ? shortArgPreview(tr.toolName, args) : tr.toolName;

		// Replace content with compaction marker
		const marker = `[compacted: ${totalLen} chars, was: ${argPreview}]`;
		tr.content = [{ type: "text", text: marker }];

		prunedTokens += Math.ceil(totalLen / 4);
		prunedCount++;
	}

	return { prunedTokens, prunedCount };
}
