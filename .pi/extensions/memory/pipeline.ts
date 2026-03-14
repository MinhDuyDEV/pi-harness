import {
	type DistillationInput,
	type DistillationRow,
	type DistillationSearchResult,
	MEMORY_CONFIG,
	type TemporalMessageInput,
	type TemporalMessageRow,
} from "./config.js";
import { getMemoryDB } from "./db.js";

// ---------------------------------------------------------------------------
// Temporal Message Operations
// ---------------------------------------------------------------------------

export function storeTemporalMessage(input: TemporalMessageInput): number {
	const db = getMemoryDB();
	const result = db
		.prepare(
			`INSERT OR IGNORE INTO temporal_messages
         (session_id, message_id, role, content, token_estimate, time_created, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			input.session_id,
			input.message_id,
			input.role,
			input.content,
			input.token_estimate ?? null,
			input.time_created,
			new Date().toISOString(),
		);
	return Number(result.lastInsertRowid);
}

export function getUndistilledMessages(
	sessionId: string,
	limit?: number,
): TemporalMessageRow[] {
	const db = getMemoryDB();
	const maxRows = limit ?? MEMORY_CONFIG.distillation.maxMessages;
	return db
		.prepare(
			`SELECT * FROM temporal_messages
       WHERE session_id = ? AND distillation_id IS NULL
       ORDER BY time_created ASC
       LIMIT ?`,
		)
		.all(sessionId, maxRows) as TemporalMessageRow[];
}

export function getUndistilledMessageCount(sessionId?: string): number {
	const db = getMemoryDB();
	if (sessionId) {
		const row = db
			.prepare(
				`SELECT COUNT(*) as count FROM temporal_messages
         WHERE session_id = ? AND distillation_id IS NULL`,
			)
			.get(sessionId) as { count: number };
		return row.count;
	}
	const row = db
		.prepare(
			`SELECT COUNT(*) as count FROM temporal_messages
       WHERE distillation_id IS NULL`,
		)
		.get() as { count: number };
	return row.count;
}

export function markMessagesDistilled(
	messageIds: number[],
	distillationId: number,
): void {
	if (messageIds.length === 0) return;
	const db = getMemoryDB();
	const placeholders = messageIds.map(() => "?").join(", ");
	db.prepare(
		`UPDATE temporal_messages SET distillation_id = ? WHERE id IN (${placeholders})`,
	).run(distillationId, ...messageIds);
}

export function purgeOldTemporalMessages(olderThanDays?: number): number {
	const db = getMemoryDB();
	const days = olderThanDays ?? MEMORY_CONFIG.capture.maxAgeDays;
	const threshold = Date.now() - days * 86400000;
	const result = db
		.prepare(`DELETE FROM temporal_messages WHERE time_created < ?`)
		.run(threshold);
	return result.changes;
}

export function getCaptureStats(): {
	total: number;
	undistilled: number;
	sessions: number;
	oldestMs: number | null;
	newestMs: number | null;
} {
	const db = getMemoryDB();
	const row = db
		.prepare(
			`SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN distillation_id IS NULL THEN 1 END) as undistilled,
         COUNT(DISTINCT session_id) as sessions,
         MIN(time_created) as oldestMs,
         MAX(time_created) as newestMs
       FROM temporal_messages`,
		)
		.get() as {
		total: number;
		undistilled: number;
		sessions: number;
		oldestMs: number | null;
		newestMs: number | null;
	};
	return row;
}

// ---------------------------------------------------------------------------
// Distillation Operations
// ---------------------------------------------------------------------------

export function storeDistillation(input: DistillationInput): number {
	const db = getMemoryDB();
	const result = db
		.prepare(
			`INSERT INTO distillations
         (session_id, content, terms, message_count, compression_ratio,
          time_start, time_end, time_created, meta_distillation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			input.session_id,
			input.content,
			JSON.stringify(input.terms),
			input.message_count,
			input.compression_ratio ?? null,
			input.time_start,
			input.time_end,
			Date.now(),
			input.meta_distillation_id ?? null,
			new Date().toISOString(),
		);
	return Number(result.lastInsertRowid);
}

export function getDistillationById(id: number): DistillationRow | null {
	const db = getMemoryDB();
	const row = db.prepare(`SELECT * FROM distillations WHERE id = ?`).get(id) as
		| DistillationRow
		| undefined;
	return row ?? null;
}

export function getRecentDistillations(
	sessionId?: string,
	limit?: number,
): DistillationRow[] {
	const db = getMemoryDB();
	const maxRows = limit ?? 10;
	if (sessionId) {
		return db
			.prepare(
				`SELECT * FROM distillations
         WHERE session_id = ?
         ORDER BY time_created DESC
         LIMIT ?`,
			)
			.all(sessionId, maxRows) as DistillationRow[];
	}
	return db
		.prepare(
			`SELECT * FROM distillations
       ORDER BY time_created DESC
       LIMIT ?`,
		)
		.all(maxRows) as DistillationRow[];
}

export function searchDistillationsFTS(
	query: string,
	limit?: number,
): DistillationSearchResult[] {
	const db = getMemoryDB();
	const maxRows = limit ?? 10;

	const ftsQuery = query
		.replace(/"/g, '""')
		.split(/\s+/)
		.filter((t) => t.length > 0)
		.map((t) => `"${t}"*`)
		.join(" OR ");

	if (!ftsQuery) return [];

	try {
		return db
			.prepare(
				`SELECT d.id, d.session_id,
                substr(d.content, 1, 150) as snippet,
                d.message_count, d.created_at,
                bm25(distillations_fts) as relevance_score
         FROM distillations d
         JOIN distillations_fts fts ON fts.rowid = d.id
         WHERE distillations_fts MATCH ?
         ORDER BY relevance_score
         LIMIT ?`,
			)
			.all(ftsQuery, maxRows) as DistillationSearchResult[];
	} catch {
		return [];
	}
}

export function getDistillationStats(): {
	total: number;
	sessions: number;
	avgCompression: number | null;
	totalMessages: number;
} {
	const db = getMemoryDB();
	const row = db
		.prepare(
			`SELECT
         COUNT(*) as total,
         COUNT(DISTINCT session_id) as sessions,
         AVG(compression_ratio) as avgCompression,
         SUM(message_count) as totalMessages
       FROM distillations`,
		)
		.get() as {
		total: number;
		sessions: number;
		avgCompression: number | null;
		totalMessages: number | null;
	};
	return {
		total: row.total,
		sessions: row.sessions,
		avgCompression: row.avgCompression,
		totalMessages: row.totalMessages ?? 0,
	};
}

// ---------------------------------------------------------------------------
// Relevance Scoring
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function getRelevantKnowledge(
	queryTerms: string[],
	options?: {
		tokenBudget?: number;
		minScore?: number;
		limit?: number;
	},
): Array<{
	id: number;
	type: string;
	title: string;
	content: string;
	score: number;
	source: string;
	created_at: string;
}> {
	const db = getMemoryDB();
	const tokenBudget =
		options?.tokenBudget ?? MEMORY_CONFIG.injection.tokenBudget;
	const minScore = options?.minScore ?? MEMORY_CONFIG.injection.minScore;
	const candidateLimit = options?.limit ?? 20;

	const ftsQuery = queryTerms
		.filter((t) => t.length > 0)
		.map((t) => `"${t.replace(/"/g, '""')}"*`)
		.join(" OR ");

	if (!ftsQuery) return [];

	type ObsCandidate = {
		id: number;
		type: string;
		title: string;
		content: string;
		created_at: string;
		created_at_epoch: number;
		confidence: string;
		bm25_score: number;
	};

	type DistCandidate = {
		id: number;
		content: string;
		created_at: string;
		time_created: number;
		bm25_score: number;
	};

	let obsCandidates: ObsCandidate[] = [];
	try {
		obsCandidates = db
			.prepare(
				`SELECT o.id, o.type, o.title, COALESCE(o.narrative, '') as content,
                o.created_at, o.created_at_epoch, o.confidence,
                bm25(observations_fts) as bm25_score
         FROM observations o
         JOIN observations_fts fts ON fts.rowid = o.id
         WHERE observations_fts MATCH ? AND o.superseded_by IS NULL
         ORDER BY bm25_score
         LIMIT ?`,
			)
			.all(ftsQuery, candidateLimit) as ObsCandidate[];
	} catch {
		// FTS5 unavailable or query error — skip observations
	}

	let distCandidates: DistCandidate[] = [];
	try {
		distCandidates = db
			.prepare(
				`SELECT d.id, d.content, d.created_at, d.time_created,
                bm25(distillations_fts) as bm25_score
         FROM distillations d
         JOIN distillations_fts fts ON fts.rowid = d.id
         WHERE distillations_fts MATCH ?
         ORDER BY bm25_score
         LIMIT ?`,
			)
			.all(ftsQuery, candidateLimit) as DistCandidate[];
	} catch {
		// FTS5 unavailable or query error — skip distillations
	}

	const confidenceWeight = (c: string) => {
		if (c === "high") return 1.0;
		if (c === "medium") return 0.7;
		return 0.4;
	};

	const scoreCandidate = (
		bm25Score: number,
		createdAtEpoch: number,
		confidence: string,
	): number => {
		const ageHours = (Date.now() - createdAtEpoch) / 3600000;
		const recencyFactor =
			MEMORY_CONFIG.injection.recencyDecay ** (ageHours / 24);
		return -bm25Score * recencyFactor * confidenceWeight(confidence);
	};

	type ScoredResult = {
		id: number;
		type: string;
		title: string;
		content: string;
		score: number;
		source: string;
		created_at: string;
	};

	const results: ScoredResult[] = [];

	for (const obs of obsCandidates) {
		results.push({
			id: obs.id,
			type: obs.type,
			title: obs.title,
			content: obs.content,
			score: scoreCandidate(
				obs.bm25_score,
				obs.created_at_epoch,
				obs.confidence,
			),
			source: "observation",
			created_at: obs.created_at,
		});
	}

	for (const dist of distCandidates) {
		results.push({
			id: dist.id,
			type: "distillation",
			title: `Distillation ${dist.id}`,
			content: dist.content,
			score: scoreCandidate(dist.bm25_score, dist.time_created, "medium"),
			source: "distillation",
			created_at: dist.created_at,
		});
	}

	// Sort by score descending (higher is better)
	results.sort((a, b) => b.score - a.score);

	// Greedy-pack within tokenBudget, filtered by minScore
	const packed: ScoredResult[] = [];
	let usedTokens = 0;

	for (const result of results) {
		if (result.score < minScore) continue;
		const tokens = estimateTokens(result.title + " " + result.content);
		if (usedTokens + tokens > tokenBudget) continue;
		packed.push(result);
		usedTokens += tokens;
	}

	return packed;
}
