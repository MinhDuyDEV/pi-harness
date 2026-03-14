import {
	type DistillationInput,
	MEMORY_CONFIG,
	type TemporalMessageRow,
} from "./config.js";
import {
	getUndistilledMessageCount,
	getUndistilledMessages,
	markMessagesDistilled,
	storeDistillation,
} from "./pipeline.js";

const STOP_WORDS = new Set([
	"the",
	"be",
	"to",
	"of",
	"and",
	"a",
	"in",
	"that",
	"have",
	"i",
	"it",
	"for",
	"not",
	"on",
	"with",
	"he",
	"as",
	"you",
	"do",
	"at",
	"this",
	"but",
	"his",
	"by",
	"from",
	"they",
	"we",
	"say",
	"her",
	"she",
	"or",
	"an",
	"will",
	"my",
	"one",
	"all",
	"would",
	"there",
	"their",
	"what",
	"so",
	"up",
	"out",
	"if",
	"about",
	"who",
	"get",
	"which",
	"go",
	"me",
	"when",
	"make",
	"can",
	"like",
	"time",
	"no",
	"just",
	"him",
	"know",
	"take",
	"people",
	"into",
	"year",
	"your",
	"good",
	"some",
	"could",
	"them",
	"see",
	"other",
	"than",
	"then",
	"now",
	"look",
	"only",
	"come",
	"its",
	"over",
	"think",
	"also",
	"back",
	"after",
	"use",
	"two",
	"how",
	"our",
	"work",
	"first",
	"well",
	"way",
	"even",
	"new",
	"want",
	"because",
	"any",
	"these",
	"give",
	"day",
	"most",
	"us",
	"is",
	"are",
	"was",
	"were",
	"been",
	"being",
	"has",
	"had",
	"does",
	"did",
	"done",
	"should",
	"must",
	"need",
	"may",
	"might",
	"shall",
	"very",
	"much",
	"more",
	"still",
	"already",
	// Code-specific
	"function",
	"const",
	"let",
	"var",
	"return",
	"import",
	"export",
	"true",
	"false",
	"null",
	"undefined",
	"string",
	"number",
	"boolean",
]);

export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9_\-/.]+/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function computeTF(words: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const word of words) {
		counts.set(word, (counts.get(word) ?? 0) + 1);
	}
	const total = words.length;
	const tf = new Map<string, number>();
	for (const [word, count] of counts) {
		tf.set(word, count / total);
	}
	return tf;
}

function computeIDF(documents: string[][]): Map<string, number> {
	const N = documents.length;
	const docFreq = new Map<string, number>();
	for (const doc of documents) {
		const unique = new Set(doc);
		for (const word of unique) {
			docFreq.set(word, (docFreq.get(word) ?? 0) + 1);
		}
	}
	const idf = new Map<string, number>();
	for (const [word, df] of docFreq) {
		idf.set(word, Math.log(N / df));
	}
	return idf;
}

export function extractTopTerms(
	messages: TemporalMessageRow[],
	topN: number,
): string[] {
	const documents = messages.map((m) => tokenize(m.content));
	const idf = computeIDF(documents);

	const allWords = documents.flat();
	const tf = computeTF(allWords);

	const scores = new Map<string, number>();
	for (const [word, tfScore] of tf) {
		const idfScore = idf.get(word) ?? 0;
		scores.set(word, tfScore * idfScore);
	}

	return [...scores.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
		.map(([word]) => word);
}

interface ScoredSentence {
	text: string;
	score: number;
	messageIndex: number;
}

function selectKeySentences(
	messages: TemporalMessageRow[],
	topTerms: string[],
	targetLength: number,
): string {
	const termSet = new Set(topTerms);

	const scored: ScoredSentence[] = [];
	messages.forEach((message, messageIndex) => {
		const sentences = message.content
			.split(/(?<=[.!?])\s+|\n+/)
			.map((s) => s.trim())
			.filter((s) => s.length > 10 && s.length < 500);

		for (const text of sentences) {
			const words = tokenize(text);
			const termHits = words.filter((w) => termSet.has(w)).length;
			const density = words.length > 0 ? termHits / words.length : 0;
			const score = density * (1 + termHits);
			scored.push({ text, score, messageIndex });
		}
	});

	scored.sort((a, b) => b.score - a.score);

	const selected: ScoredSentence[] = [];
	let currentLength = 0;
	for (const sentence of scored) {
		if (currentLength + sentence.text.length + 2 > targetLength) continue;
		selected.push(sentence);
		currentLength += sentence.text.length + 2;
	}

	selected.sort((a, b) => a.messageIndex - b.messageIndex);
	return selected.map((s) => s.text).join("\n");
}

export function distillSession(sessionId: string): number | null {
	if (!MEMORY_CONFIG.distillation.enabled) return null;

	const { minMessages, maxMessages, compressionTarget, topTerms } =
		MEMORY_CONFIG.distillation;

	const undistilledCount = getUndistilledMessageCount(sessionId);
	if (undistilledCount < minMessages) return null;

	const messages = getUndistilledMessages(sessionId, maxMessages);
	if (messages.length < minMessages) return null;

	const terms = extractTopTerms(messages, topTerms);
	const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
	const targetLength = Math.max(
		200,
		Math.floor(totalChars * compressionTarget),
	);

	const distilledContent = selectKeySentences(messages, terms, targetLength);
	if (distilledContent.length < 50) return null;

	const compressionRatio = distilledContent.length / totalChars;

	const input: DistillationInput = {
		session_id: sessionId,
		content: distilledContent,
		terms,
		message_count: messages.length,
		compression_ratio: compressionRatio,
		time_start: messages[0].time_created,
		time_end: messages[messages.length - 1].time_created,
	};

	const distillationId = storeDistillation(input);
	const messageIds = messages.map((m) => m.id);
	markMessagesDistilled(messageIds, distillationId);

	return distillationId;
}
