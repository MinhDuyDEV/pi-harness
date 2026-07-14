/**
 * DCP Steps 2 and 3: dedup and purge-errors.
 *
 * Both strategies operate in-place on the message stream. They share the
 * op-extraction helper and the READ_TOOLS allowlist (used to limit dedup
 * to read-only/deterministic tools).
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
import { extractToolOps, stripToolArgs } from "./compress-token-utils.js";
import { READ_TOOLS } from "./compress-types.js";
import type { ProtectionPolicy } from "./protection.js";

interface DCPConfigShape {
	dedup: {
		enabled: boolean;
		protectedTools: string[];
	};
	purgeErrors: {
		enabled: boolean;
		turns: number;
		protectedTools: string[];
	};
}

/**
 * Strategy 2: Deduplication (P3: smarter — read-only safe check).
 *
 * When the same read-only tool is called with the same arguments multiple
 * times, strip the call arguments and replace the older result with a short
 * marker. Read-only only — mutating tools with identical args may still
 * produce different results.
 */
export function applyDedup(
	messages: Message[],
	config: DCPConfigShape,
	protection?: ProtectionPolicy,
): { prunedTokens: number; prunedCount: number } {
	if (!config.dedup.enabled) return { prunedTokens: 0, prunedCount: 0 };

	const ops = extractToolOps(messages);
	const protectedSet = new Set(config.dedup.protectedTools);
	const groups = new Map<string, typeof ops>();

	for (const op of ops) {
		if (op.type !== "call" || !op.toolName || protectedSet.has(op.toolName)) continue;
		// Only dedup read-only (deterministic) tools — mutating tools with same args
		// may have different results (e.g., write, edit, compress)
		if (!READ_TOOLS.has(op.toolName)) continue;

		// Hash the arguments
		const asst = messages[op.messageIndex] as AssistantMessage;
		const tc = asst.content[op.contentIndex] as ToolCall;
		const hash = JSON.stringify(tc.arguments);
		const key = `${op.toolName}:${hash}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key)!.push(op);
	}

	let prunedTokens = 0;
	let prunedCount = 0;

	for (const calls of groups.values()) {
		if (calls.length <= 1) continue;
		for (let i = 0; i < calls.length - 1; i++) {
			const oldCall = calls[i];
			// Protected messages survive dedup
			if (protection?.isProtected(messages[oldCall.messageIndex])) continue;
			// Strip call arguments
			const asst = messages[oldCall.messageIndex] as AssistantMessage;
			const tc = asst.content[oldCall.contentIndex] as ToolCall;
			prunedTokens += stripToolArgs(tc, "deduplicated");
			// Strip corresponding result
			for (const op of ops) {
				if (op.type === "result" && op.toolCallId === oldCall.toolCallId) {
					// Skip if the result message itself is protected
					if (protection?.isProtected(messages[op.messageIndex])) continue;
					const rm = messages[op.messageIndex] as ToolResultMessage;
					const textPart = rm.content.find((c) => c.type === "text") as TextContent | undefined;
					const snippet = textPart?.text?.slice(0, 100).replace(/\n/g, " ").trim() ?? "";
					rm.content = [{ type: "text", text: `[duplicate: ${oldCall.toolName} — ${snippet}…]` }];
					prunedCount++;
				}
			}
		}
	}

	return { prunedTokens, prunedCount };
}

/**
 * Strategy 3: Purge errors.
 *
 * Strip large input arguments from errored tool calls older than N turns.
 */
export function applyPurgeErrors(
	messages: Message[],
	config: DCPConfigShape,
	protection?: ProtectionPolicy,
): { prunedTokens: number; prunedCount: number } {
	if (!config.purgeErrors.enabled) return { prunedTokens: 0, prunedCount: 0 };

	const ops = extractToolOps(messages);
	const erroredIds = new Set(
		ops.filter((o) => o.type === "result" && o.isError).map((o) => o.toolCallId),
	);
	if (erroredIds.size === 0) return { prunedTokens: 0, prunedCount: 0 };

	const protectedSet = new Set(config.purgeErrors.protectedTools);
	let prunedTokens = 0;
	let prunedCount = 0;

	for (const op of ops) {
		if (op.type !== "call" || !erroredIds.has(op.toolCallId)) continue;
		if (protectedSet.has(op.toolName)) continue;

		// Protected content survives error purging
		if (protection?.isProtected(messages[op.messageIndex])) continue;

		// Estimate age: use distance from end of messages as proxy
		const relativeAge = messages.length - op.messageIndex;
		const estimatedTurns = Math.max(1, Math.floor(relativeAge / 3));
		if (estimatedTurns < config.purgeErrors.turns) continue;

		const asst = messages[op.messageIndex] as AssistantMessage;
		const tc = asst.content[op.contentIndex] as ToolCall;
		const argsLen = JSON.stringify(tc.arguments).length;
		// Only strip substantial inputs (> ~50 tokens)
		if (argsLen < 200) continue;

		prunedTokens += stripToolArgs(tc, "error-purged");
		prunedCount++;
	}

	return { prunedTokens, prunedCount };
}
