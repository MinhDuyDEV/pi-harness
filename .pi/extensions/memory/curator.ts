import {
	type DistillationRow,
	MEMORY_CONFIG,
	type ObservationInput,
	type ObservationType,
} from "./config.js";
import { storeObservation } from "./observations.js";
import { getRecentDistillations } from "./pipeline.js";

const CURATOR_PATTERNS: Array<{
	type: ObservationType;
	pattern: RegExp;
	titleExtractor: (match: RegExpMatchArray, sentence: string) => string;
}> = [
	{
		type: "decision",
		pattern:
			/\b(decided to|chose to|selected\s+\w+\s+(?:over|instead)|went with|opted for|switched to|migrated to|picked\s+\w+\s+(?:over|for))\b/i,
		titleExtractor: (_match, sentence) => truncateSentence(sentence, 80),
	},
	{
		type: "bugfix",
		pattern:
			/\b(fixed (?:a|the|an)\b|resolved (?:a|the|an)\b|patched (?:a|the|an)\b|corrected (?:a|the|an)\b|bug in\b|error in\b|crash in\b|regression in\b)/i,
		titleExtractor: (_match, sentence) => truncateSentence(sentence, 80),
	},
	{
		type: "pattern",
		pattern:
			/\b(pattern(?::|is| for)\b|convention(?::|is)\b|best practice\b|standard practice\b|workflow for\b|(?:we|I|the team) (?:always|never)\b)/i,
		titleExtractor: (_match, sentence) => truncateSentence(sentence, 80),
	},
	{
		type: "discovery",
		pattern:
			/\b(found that|discovered that|noticed that|learned that|turns out|realized that|it (?:seems|appears) that)\b/i,
		titleExtractor: (_match, sentence) => truncateSentence(sentence, 80),
	},
	{
		type: "warning",
		pattern:
			/\b(warning:|caution:|careful with|gotcha:|pitfall(?:s|:)?\b|don't use\b|avoid (?:using|calling|importing)\b|beware of\b|watch out for\b|never (?:use|call|import|commit|push)\b)/i,
		titleExtractor: (_match, sentence) => truncateSentence(sentence, 80),
	},
];

function truncateSentence(sentence: string, maxLen: number): string {
	const normalized = sentence.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLen) return normalized;
	const truncated = normalized.slice(0, maxLen);
	const lastSpace = truncated.lastIndexOf(" ");
	return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

function splitSentences(content: string): string[] {
	return content
		.split(/(?<=[.!?])\s+|\n+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 30);
}

function extractConcepts(sentence: string): string[] {
	const words = sentence
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 3);
	return [...new Set(words)].slice(0, 5);
}

function isDuplicateTitle(title: string, existingTitles: Set<string>): boolean {
	const normalized = title.toLowerCase().trim();
	if (existingTitles.has(normalized)) return true;
	const prefix = normalized.slice(0, 40);
	for (const existing of existingTitles) {
		if (existing.startsWith(prefix)) return true;
	}
	return false;
}

function matchPatterns(
	sentence: string,
	distillation: DistillationRow,
	seenTitles: Set<string>,
): ObservationInput | null {
	for (const { type, pattern, titleExtractor } of CURATOR_PATTERNS) {
		const match = sentence.match(pattern);
		if (!match) continue;

		const title = titleExtractor(match, sentence);
		if (isDuplicateTitle(title, seenTitles)) continue;

		const sentenceConcepts = extractConcepts(sentence);

		let termConcepts: string[] = [];
		try {
			const parsed = JSON.parse(distillation.terms ?? "[]") as string[];
			termConcepts = parsed.slice(0, 3);
		} catch {
			termConcepts = [];
		}

		const merged = [...new Set([...sentenceConcepts, ...termConcepts])].slice(
			0,
			8,
		);

		return {
			type,
			title,
			narrative: sentence,
			concepts: merged,
			confidence: MEMORY_CONFIG.curator.defaultConfidence,
			source: "curator",
		};
	}
	return null;
}

interface CuratorResult {
	created: number;
	skipped: number;
	patterns: Record<string, number>;
}

export function curateFromDistillations(
	sessionId?: string,
	limit?: number,
): CuratorResult {
	if (!MEMORY_CONFIG.curator.enabled) {
		return { created: 0, skipped: 0, patterns: {} };
	}

	const effectiveLimit = limit ?? 10;
	const { minDistillations } = MEMORY_CONFIG.curator;

	const distillations = getRecentDistillations(sessionId, effectiveLimit);
	if (distillations.length < minDistillations) {
		return { created: 0, skipped: 0, patterns: {} };
	}

	let created = 0;
	let skipped = 0;
	const patterns: Record<string, number> = {};
	const seenTitles = new Set<string>();

	for (const distillation of distillations) {
		const sentences = splitSentences(distillation.content);

		for (const sentence of sentences) {
			const input = matchPatterns(sentence, distillation, seenTitles);
			if (!input) {
				skipped++;
				continue;
			}

			storeObservation(input);
			seenTitles.add(input.title.toLowerCase().trim());
			created++;
			patterns[input.type] = (patterns[input.type] ?? 0) + 1;
		}
	}

	return { created, skipped, patterns };
}
