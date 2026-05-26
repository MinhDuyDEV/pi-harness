/**
 * DCP Extension — Smart Compaction Handler (v2)
 *
 * Hooks into Pi's native session_before_compact to:
 *   1. Enrich compaction with DCP compression blocks
 *   2. Store raw transcript for reversible compression (ctx_expand)
 *   3. Extract durable facts from compaction summary
 *
 * Uses convertToLlm() + serializeConversation() from Pi SDK for message serialization.
 * Uses complete() from @earendil-works/pi-ai for DCP-enriched custom compaction.
 */

import { complete } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import type { DCPConfig, FactCategory } from "./config.js";
import {
	getActiveBlocks,
	storeRawTranscript,
	storeFact,
	getRawTranscript,
	getFactsBySession,
	updateSessionStats,
	getSessionStats,
} from "./db.js";
import { mermaidPrefixSummary } from "./mmd.js";

// ---------------------------------------------------------------------------
// Types — structural matching for Pi SDK compaction types
// ---------------------------------------------------------------------------

/** Matches Pi's CompactionPreparation exactly (from compaction.d.ts) */
interface CompactionPreparation {
	/** UUID of first entry to keep */
	firstKeptEntryId: string;
	/** Messages that will be summarized and discarded */
	messagesToSummarize: unknown[];
	/** Messages for turn prefix summary (split-turn case) */
	turnPrefixMessages: unknown[];
	/** Whether cut point lands mid-turn (one huge turn exceeds keepRecentTokens) */
	isSplitTurn: boolean;
	tokensBefore: number;
	/** Summary from previous compaction, for iterative update */
	previousSummary?: string;
	fileOps: { readFiles: string[]; modifiedFiles: string[] };
	settings: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
}

/** Minimal CompactionResult shape returned to Pi's session_before_compact handler */
export interface DCPCompactionResult {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: unknown;
}

// ---------------------------------------------------------------------------
// Fact extraction patterns
// ---------------------------------------------------------------------------

const FACT_PATTERNS: Record<FactCategory, RegExp[]> = {
	ARCHITECTURE_DECISIONS: [
		/decided to (?:use|adopt|implement|go with|choose)\s+(.+)/gi,
		/architecture:\s*(.+)/gi,
		/design decision:\s*(.+)/gi,
	],
	CONSTRAINTS: [
		/constraint:\s*(.+)/gi,
		/(?:must|cannot|should not|required to)\s+(.+)/gi,
		/limitation:\s*(.+)/gi,
	],
	NAMING_CONVENTIONS: [
		/naming convention:\s*(.+)/gi,
		/(?:named|called|renamed)\s+(?:it|the\s+\w+)\s+(.+)/gi,
	],
	KNOWN_ISSUES: [
		/known issue:\s*(.+)/gi,
		/bug:\s*(.+)/gi,
		/workaround:\s*(.+)/gi,
	],
	WORKFLOW_RULES: [
		/workflow:\s*(.+)/gi,
		/process:\s*(.+)/gi,
		/rule:\s*(.+)/gi,
	],
	DEPENDENCIES: [
		/depends on\s+(.+)/gi,
		/requires?\s+(.+)/gi,
		/using\s+(?:package|library|dependency)\s+(.+)/gi,
	],
	FILE_PATTERNS: [
		/files? (?:at|in|located)\s+(.+)/gi,
		/(?:created|modified|added)\s+(.+\.(?:ts|js|py|rs|go|json|md))/gi,
	],
	API_CONTRACTS: [
		/api:\s*(.+)/gi,
		/endpoint:\s*(.+)/gi,
		/interface:\s*(.+)/gi,
	],
};

// ---------------------------------------------------------------------------
// Compaction enrichment
// ---------------------------------------------------------------------------

/**
 * Get a formatted summary of active DCP blocks for injection into context.
 * Used by before_agent_start to re-inject block context after compaction.
 */
/** @internal Currently unused — available for future features */
export function getActiveBlocksSummary(sessionId: string, maxTokens: number = 6000): string | null {
	const blocks = getActiveBlocks(sessionId);
	if (blocks.length === 0) return null;

	const lines: string[] = ["## DCP Compression History"];
	let tokenCount = 15; // overhead

	for (const block of blocks) {
		const header = `\n### [Block b${block.block_id}: ${block.topic}]`;
		const headerTokens = Math.ceil(header.length / 4);
		const summaryTokens = Math.ceil(block.summary.length / 4);

		if (tokenCount + headerTokens + summaryTokens > maxTokens) {
			lines.push(`\n_...${blocks.length - lines.length + 1} more blocks omitted (token budget)_`);
			break;
		}

		lines.push(header);
		lines.push(block.summary);
		tokenCount += headerTokens + summaryTokens;
	}

	return lines.length > 1 ? lines.join("\n") : null;
}

/**
 * Build an enriched compaction context by adding DCP block summaries
 * to the preparation data that Pi's compaction system will summarize.
 *
 * NOTE: This function is currently unused because Pi's SessionBeforeCompactResult
 * doesn't support injecting customInstructions. Kept for potential future use.
 */
/** @internal Currently unused — available for future features */
export function buildEnrichedCompactionContext(
	sessionId: string,
	preparation: CompactionPreparation,
): string | null {
	const blocks = getActiveBlocks(sessionId);
	if (blocks.length === 0) return null;

	const blockSummaries = blocks.map(
		(b) => `### [DCP Block b${b.block_id}: ${b.topic}]\n${b.summary}`,
	).join("\n\n");

	const previousContext = preparation.previousSummary
		? `\n\n## Previous Compaction Summary\n${preparation.previousSummary}`
		: "";

	return [
		"## DCP Compression History",
		"The following are authoritative summaries of earlier conversation phases:",
		"",
		blockSummaries,
		previousContext,
	].join("\n");
}

// ---------------------------------------------------------------------------
// Raw transcript storage for ctx_expand
// ---------------------------------------------------------------------------

/**
 * Store the raw messages before compaction for potential expansion later.
 * Uses Pi's serializeConversation if available, falls back to JSON.
 */
export function storePreCompactionTranscript(
	sessionId: string,
	blockId: number,
	messages: unknown[],
	serializeFn?: (messages: unknown[]) => string,
): void {
	let serialized: string;
	let tokenCount: number;

	if (serializeFn) {
		serialized = serializeFn(messages);
	} else {
		serialized = JSON.stringify(messages);
	}

	tokenCount = Math.ceil(serialized.length / 4);
	storeRawTranscript(sessionId, blockId, serialized, tokenCount);
}

/**
 * Retrieve a raw transcript for expansion.
 */
export function expandCompressedBlock(
	sessionId: string,
	blockId: number,
	maxTokens: number,
): string | null {
	const transcript = getRawTranscript(sessionId, blockId);
	if (!transcript) return null;

	const raw = transcript.raw_messages;
	// Cap at maxTokens (rough: 4 chars per token)
	const maxChars = maxTokens * 4;
	if (raw.length <= maxChars) return raw;

	return raw.slice(0, maxChars) + `\n\n[Truncated — ${Math.round((raw.length - maxChars) / 4)} more tokens available]`;
}

// ---------------------------------------------------------------------------
// DCP-enriched custom compaction
// ---------------------------------------------------------------------------

/** Pi's structured compaction summary format (must match Pi's expected output) */
const COMPACTION_FORMAT = [
	"Format your summary using this exact structure:",
	"## Goal",
	"[What the user is trying to accomplish]",
	"## Constraints & Preferences",
	"- [Requirements mentioned by user]",
	"## Progress",
	"### Done",
	"- [x] [Completed tasks]",
	"### In Progress",
	"- [ ] [Current work]",
	"### Blocked",
	"- [Issues, if any]",
	"## Key Decisions",
	"- **[Decision]**: [Rationale]",
	"## Next Steps",
	"1. [What should happen next]",
	"## Critical Context",
	"- [Data needed to continue]",
	"<read-files>",
	"path/to/file1.ts",
	"</read-files>",
	"<modified-files>",
	"path/to/changed.ts",
	"</modified-files>",
].join("\n");

/**
 * Generate a DCP-enriched compaction summary using Pi's SDK helpers.
 *
 * This replaces Pi's native compaction when DCP intercepts `session_before_compact`.
 * Injects active DCP compression blocks and extracted facts as authoritative context
 * so the LLM summarizer is aware of earlier compressed phases.
 *
 * @returns CompactionResult-compatible object, or null if generation fails (caller should cancel).
 */
export async function generateDCPEnrichedCompaction(
	sessionId: string,
	preparation: CompactionPreparation,
	customInstructions: string | undefined,
	signal: AbortSignal,
	model: Model<any>,
	apiKey: string | undefined,
	headers: Record<string, string> | undefined,
	_config: DCPConfig,
): Promise<DCPCompactionResult | null> {
	const { messagesToSummarize, turnPrefixMessages, firstKeptEntryId, tokensBefore, previousSummary } = preparation;

	// Combine all messages (handles split-turn: turnPrefixMessages is the early part of the split turn)
	const allMessages = [...(messagesToSummarize as any[]), ...(turnPrefixMessages as any[])];
	if (allMessages.length === 0) return null;

	// Serialize messages to readable text using Pi SDK (truncates tool results to 2000 chars)
	const conversationText = serializeConversation(convertToLlm(allMessages));

	// Build DCP-enriched preamble
	const preambleParts: string[] = [];

	// Active DCP blocks are authoritative summaries of earlier completed phases — inject first
	const activeBlocks = getActiveBlocks(sessionId);
	if (activeBlocks.length > 0) {
		const blockLines = activeBlocks
			.map((b) => `### [b${b.block_id}: ${b.topic}]\n${b.summary}`)
			.join("\n\n");
		preambleParts.push(
			`## Active DCP Compression Blocks\nThe following are authoritative summaries of earlier work phases — include them in your summary:\n\n${blockLines}`,
		);
	}

	// Extracted facts (architecture decisions, constraints, naming conventions, etc.)
	const factsSummary = getFactsSummary(sessionId, 3000);
	if (factsSummary) preambleParts.push(factsSummary);

	// Previous compaction summary for iterative update context
	if (previousSummary) {
		preambleParts.push(`## Previous Compaction Summary\n${previousSummary}`);
	}

	const dcpPreamble = preambleParts.length > 0
		? preambleParts.join("\n\n") + "\n\n---\n\n"
		: "";

	const focusSection = customInstructions
		? `\n\nAdditional focus for this summary: ${customInstructions}`
		: "";

	const userPrompt = [
		`You are a conversation summarizer for a coding session. Create a comprehensive summary that captures all information needed to continue the work effectively.${focusSection}`,
		"",
		COMPACTION_FORMAT,
		"",
		"Be thorough but concise. The summary replaces the entire conversation history.",
		"",
		"---",
		"",
		dcpPreamble,
		"<conversation>",
		conversationText,
		"</conversation>",
	].join("\n");

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: userPrompt }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey,
			headers,
			maxTokens: 8192,
			signal,
		},
	);

	const summary = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	if (!summary.trim()) return null;

	// Prepend Mermaid task canvas (5-10x denser overview)
	const mermaidPrefixed = mermaidPrefixSummary(sessionId, summary, _config);

	return {
		summary: mermaidPrefixed,
		firstKeptEntryId,
		tokensBefore,
		details: {
			mode: "dcp-enriched",
			activeBlocks: activeBlocks.length,
			factsInjected: factsSummary !== null,
			isSplitTurn: preparation.isSplitTurn,
		},
	};
}

// ---------------------------------------------------------------------------
// Fact extraction
// ---------------------------------------------------------------------------

/**
 * Extract durable facts from a compaction summary.
 * Uses pattern matching to identify facts by category.
 */
export function extractFacts(
	sessionId: string,
	summary: string,
	config: DCPConfig,
): number {
	if (!config.factExtraction.enabled) return 0;

	let totalFacts = 0;
	const enabledCategories = new Set(config.factExtraction.categories);

	for (const [category, patterns] of Object.entries(FACT_PATTERNS)) {
		if (!enabledCategories.has(category as FactCategory)) continue;

		for (const pattern of patterns) {
			// Reset regex state
			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;

			while ((match = pattern.exec(summary)) !== null) {
				const factContent = match[1]?.trim();
				if (factContent && factContent.length > 10 && factContent.length < 500) {
					storeFact(sessionId, category, factContent);
					totalFacts++;
				}
			}
		}
	}

	// Also extract file patterns from the fileOps in the summary
	const filePathRegex = /(?:^|\s)((?:\.\/|\/)?[\w./-]+\.(?:ts|js|py|rs|go|json|md|yaml|toml|sql))/gm;
	filePathRegex.lastIndex = 0;
	let fileMatch: RegExpExecArray | null;
	const seenFiles = new Set<string>();
	while ((fileMatch = filePathRegex.exec(summary)) !== null) {
		const filePath = fileMatch[1].trim();
		if (filePath && !seenFiles.has(filePath)) {
			seenFiles.add(filePath);
			storeFact(sessionId, "FILE_PATTERNS", `File referenced: ${filePath}`);
			totalFacts++;
		}
	}

	// Update session stats
	const stats = getSessionStats(sessionId);
	if (stats) {
		updateSessionStats(sessionId, {
			total_facts_extracted: stats.total_facts_extracted + totalFacts,
		});
	}

	return totalFacts;
}

/**
 * Get a summary of extracted facts for injection into context.
 * Returns a formatted string of the most important facts, capped by token budget.
 */
export function getFactsSummary(sessionId: string, maxTokens: number = 4000): string | null {
	const facts = getFactsBySession(sessionId);
	if (facts.length === 0) return null;

	const lines: string[] = ["## Session Knowledge"];
	let tokenCount = 10; // overhead

	// Group by category
	const byCategory = new Map<string, typeof facts>();
	for (const fact of facts) {
		if (!byCategory.has(fact.category)) byCategory.set(fact.category, []);
		byCategory.get(fact.category)!.push(fact);
	}

	for (const [category, categoryFacts] of byCategory) {
		const header = `\n### ${category}`;
		const headerTokens = Math.ceil(header.length / 4);
		if (tokenCount + headerTokens > maxTokens) break;

		lines.push(header);
		tokenCount += headerTokens;

		for (const fact of categoryFacts) {
			const line = `- ${fact.content} (seen: ${fact.seen_count}x)`;
			const lineTokens = Math.ceil(line.length / 4);
			if (tokenCount + lineTokens > maxTokens) break;

			lines.push(line);
			tokenCount += lineTokens;
		}
	}

	return lines.length > 1 ? lines.join("\n") : null;
}
