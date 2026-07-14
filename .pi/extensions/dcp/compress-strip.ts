/**
 * DCP Step 1: compress-strip.
 *
 * Find compress tool results, identify the message range before each call,
 * and replace those messages with a structured summary from the persistent summary.
 *
 * Extracted from compress.ts to keep the orchestrator (`processContextMessages`)
 * and the other strategies readable.
 */

import type {
	AssistantMessage,
	ImageContent,
	Message,
	TextContent,
	ToolCall,
	ToolResultMessage,
	UserMessage,
} from "@earendil-works/pi-ai";
import { buildCompressedSummaryMessage } from "./compress-summary.js";
import { estimateTokens, extractToolOps } from "./compress-token-utils.js";
import { getState } from "./compress-state.js";
import type { ProtectionPolicy } from "./protection.js";

interface DCPConfigShape {
	compress: {
		protectedTools: string[];
		protectUserMessages: boolean;
	};
}

function textOf(resultMsg: ToolResultMessage): string {
	let fullText = "";
	for (const part of resultMsg.content) {
		if (part.type === "text") fullText += (part as TextContent).text ?? "";
	}
	return fullText;
}

function userTextOf(m: UserMessage): string {
	if (typeof m.content === "string") return m.content;
	if (Array.isArray(m.content))
		return m.content.reduce((s: string, c: TextContent | ImageContent) => s + (c.type === "text" ? c.text : ""), "");
	return "";
}

function toolResultTextOf(tr: ToolResultMessage): string {
	let text = "";
	for (const part of tr.content) {
		if (part.type === "text") text += (part as TextContent).text ?? "";
	}
	return text;
}

/**
 * Strategy 1: Compress-range stripping.
 *
 * Find compress tool results, identify the message range before each call,
 * and replace those messages with a structured summary from the persistent summary.
 */
export function applyCompressStrip(
	messages: Message[],
	sessionId: string,
	config: DCPConfigShape,
	protection?: ProtectionPolicy,
): { messages: Message[]; prunedTokens: number; prunedCount: number } {
	const ops = extractToolOps(messages);
	const compressResults: Array<{
		callIndex: number;
		resultIndex: number;
		summary: string;
		topic: string;
	}> = [];

	// Find compress tool calls and their results
	for (const op of ops) {
		if (op.type !== "result" || op.toolName !== "compress" || op.isError) continue;
		const callOp = ops.find((o) => o.type === "call" && o.toolCallId === op.toolCallId);
		if (!callOp) continue;

		const fullText = textOf(messages[op.messageIndex] as ToolResultMessage);
		const marker = "The following is the authoritative summary of the compressed range:";
		const idx = fullText.indexOf(marker);
		const summary = idx >= 0 ? fullText.substring(idx + marker.length).trim() : fullText;

		const callMsg = messages[callOp.messageIndex] as AssistantMessage;
		const tc = callMsg.content[callOp.contentIndex] as ToolCall;
		const topic = ((tc.arguments as Record<string, unknown>)?.topic ?? "compressed") as string;

		compressResults.push({
			callIndex: callOp.messageIndex,
			resultIndex: op.messageIndex,
			summary,
			topic,
		});
	}

	if (compressResults.length === 0) return { messages, prunedTokens: 0, prunedCount: 0 };

	compressResults.sort((a, b) => a.callIndex - b.callIndex);

	const protectedSet = new Set(config.compress.protectedTools);
	const indicesToRemove = new Set<number>();
	const injections: Array<{ atIndex: number; summary: string; topic: string }> = [];
	let prunedTokens = 0;

	for (let i = 0; i < compressResults.length; i++) {
		const cr = compressResults[i];
		// Range start: beginning of session or after previous compress result
		const rangeStart = i === 0 ? 0 : compressResults[i - 1].resultIndex + 1;
		const rangeEnd = cr.callIndex;

		let strippedTokens = 0;
		const nestedSummaries: string[] = [];
		const protectedContent: string[] = [];

		for (let j = rangeStart; j < rangeEnd; j++) {
			if (indicesToRemove.has(j)) continue;

			// Protected content stays in the array — do not mark for removal
			if (protection?.isProtected(messages[j])) continue;

			strippedTokens += estimateTokens(messages[j]);
			indicesToRemove.add(j);

			const m = messages[j];
			// Nest previously compressed summaries
			if ((m as unknown as Record<string, unknown>)?.role === "custom" && (m as unknown as Record<string, unknown>)?.customType === "dcp-compressed-summary") {
				const content = (m as unknown as Record<string, unknown>)?.content;
				if (typeof content === "string" && content.trim()) nestedSummaries.push(content);
			}
			// Preserve protected tool outputs
			if (m.role === "toolResult") {
				const tr = m as ToolResultMessage;
				if (protectedSet.has(tr.toolName) && !tr.isError) {
					const text = toolResultTextOf(tr);
					if (text.trim()) protectedContent.push(`[${tr.toolName}] ${text.trim()}`);
				}
			}
			// Preserve user messages
			if (config.compress.protectUserMessages && m.role === "user") {
				const text = userTextOf(m);
				if (text.trim()) protectedContent.push(`[user] ${text.trim()}`);
			}
		}

		indicesToRemove.add(cr.callIndex);
		strippedTokens += estimateTokens(messages[cr.callIndex]);
		indicesToRemove.add(cr.resultIndex);
		strippedTokens += estimateTokens(messages[cr.resultIndex]);

		let finalSummary = cr.summary;
		if (nestedSummaries.length > 0) {
			finalSummary = nestedSummaries.map((s) => `[Previously compressed]\n${s}`).join("\n\n")
				+ `\n\n[Current compression]\n${cr.summary}`;
		}
		if (protectedContent.length > 0) {
			finalSummary += `\n\n## Preserved content\n${protectedContent.join("\n")}`;
		}

		injections.push({ atIndex: rangeStart, summary: finalSummary, topic: cr.topic });
		prunedTokens += strippedTokens;
	}

	// Rebuild message array — inject structured persistent summary instead of raw text
	const newMessages: Message[] = [];
	const injectionMap = new Map<number, typeof injections>();
	for (const inj of injections) {
		if (!injectionMap.has(inj.atIndex)) injectionMap.set(inj.atIndex, []);
		injectionMap.get(inj.atIndex)!.push(inj);
	}

	// Fetch the persistent summary for structured message formatting
	const summary = getState(sessionId).persistentSummary;
	const useStructured = summary.merged_block_ids.length > 0;

	for (let i = 0; i < messages.length; i++) {
		const injects = injectionMap.get(i);
		if (injects) {
			for (const inj of injects) {
				const content = useStructured ? buildCompressedSummaryMessage(summary) : inj.summary;
				newMessages.push({
					role: "custom",
					customType: "dcp-compressed-summary",
					content,
					display: false,
					timestamp: Date.now(),
				} as unknown as Message);
			}
		}
		if (indicesToRemove.has(i)) continue;
		newMessages.push(messages[i]);
	}

	return { messages: newMessages, prunedTokens, prunedCount: indicesToRemove.size };
}
