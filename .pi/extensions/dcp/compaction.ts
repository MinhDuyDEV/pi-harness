/**
 * DCP Extension — Smart Compaction Handler (v2)
 *
 * Hooks into Pi's native session_before_compact to:
 *   1. Enrich compaction with DCP compression blocks
 *   2. Store raw transcript for reversible compression (ctx_expand)
 *   3. Extract durable facts from compaction summary
 *
 * Uses convertToLlm() + serializeConversation() from Pi SDK for message serialization.
 */

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

// ---------------------------------------------------------------------------
// Types — structural matching for Pi SDK compaction types
// ---------------------------------------------------------------------------

interface CompactionPreparation {
	messagesToSummarize: unknown[];
	turnPrefixMessages: unknown[];
	previousSummary: string | null;
	fileOps: { readFiles: string[]; modifiedFiles: string[] };
	tokensBefore: number;
	firstKeptEntryId: string;
	settings: unknown;
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
