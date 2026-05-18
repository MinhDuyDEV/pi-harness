import {
	type DistillationInput,
	type DistillationRow,
	type DistillationSearchResult,
	MEMORY_CONFIG,
	type TemporalMessageInput,
	type TemporalMessageRow,
} from "./config.js";
import { getMemoryDB, isSqliteVecAvailable, runInTransaction } from "./db.js";
import { markObservationsRetrieved, searchObservationsVector } from "./observations.js";
import { listScenes } from "./scene.js";

// ---------------------------------------------------------------------------
// Temporal Message Operations
// ---------------------------------------------------------------------------

export function storeTemporalMessage(input: TemporalMessageInput): number {
	const db = getMemoryDB();
	return runInTransaction(db, () => {
		const result = db
			.prepare(
				`INSERT OR IGNORE INTO temporal_messages
         (session_id, message_id, role, content, token_estimate, time_created, created_at,
          tool_name, tool_call_id, status, is_error, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.session_id,
				input.message_id,
				input.role,
				input.content,
				input.token_estimate ?? null,
				input.time_created,
				new Date().toISOString(),
				input.tool_name ?? null,
				input.tool_call_id ?? null,
				input.status ?? null,
				input.is_error ? 1 : 0,
				input.raw_json ?? null,
			);
		pruneTemporalMessagesLocked(db);
		return Number(result.lastInsertRowid);
	});
}

function pruneTemporalMessagesLocked(db: ReturnType<typeof getMemoryDB>): number {
	const maxMessages = Math.max(0, Number(MEMORY_CONFIG.capture.maxMessages ?? 0));
	if (maxMessages <= 0) return 0;
	const result = db
		.prepare(
			`DELETE FROM temporal_messages
       WHERE id NOT IN (
         SELECT id FROM temporal_messages
         ORDER BY time_created DESC, id DESC
         LIMIT ?
       )`,
		)
		.run(maxMessages);
	return Number(result.changes);
}

export function pruneTemporalMessages(maxMessages?: number): number {
	const db = getMemoryDB();
	const originalMax = MEMORY_CONFIG.capture.maxMessages;
	if (maxMessages != null) {
		(MEMORY_CONFIG.capture as { maxMessages: number }).maxMessages = maxMessages;
	}
	try {
		return pruneTemporalMessagesLocked(db);
	} finally {
		if (maxMessages != null) {
			(MEMORY_CONFIG.capture as { maxMessages: number }).maxMessages = originalMax;
		}
	}
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
		.all(sessionId, maxRows) as unknown as TemporalMessageRow[];
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

function markMessagesDistilled(
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
	return Number(result.changes);
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

function storeDistillation(input: DistillationInput): number {
	return insertDistillation(getMemoryDB(), input);
}

function insertDistillation(db: ReturnType<typeof getMemoryDB>, input: DistillationInput): number {
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

export function storeDistillationAndMarkMessages(
	input: DistillationInput,
	messageIds: number[],
): number {
	const db = getMemoryDB();
	return runInTransaction(db, () => {
		const distillationId = insertDistillation(db, input);
		if (messageIds.length > 0) {
			const placeholders = messageIds.map(() => "?").join(", ");
			db.prepare(
				`UPDATE temporal_messages SET distillation_id = ? WHERE id IN (${placeholders})`,
			).run(distillationId, ...messageIds);
		}
		return distillationId;
	});
}

function getDistillationById(id: number): DistillationRow | null {
	const db = getMemoryDB();
	const row = db.prepare(`SELECT * FROM distillations WHERE id = ?`).get(id) as unknown as
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
			.all(sessionId, maxRows) as unknown as DistillationRow[];
	}
	return db
		.prepare(
			`SELECT * FROM distillations
       ORDER BY time_created DESC
       LIMIT ?`,
		)
		.all(maxRows) as unknown as DistillationRow[];
}

function searchDistillationsFTS(
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
			.all(ftsQuery, maxRows) as unknown as DistillationSearchResult[];
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
		queryEmbedding?: number[] | null;
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
	const { weight: vectorWeight, textWeight } = MEMORY_CONFIG.vector;

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

	// Build vector similarity map for observations (if available)
	const vectorSimilarityMap = new Map<number, number>();
	if (isSqliteVecAvailable() && options?.queryEmbedding) {
		const vectorResults = searchObservationsVector(options.queryEmbedding, candidateLimit);
		for (const vr of vectorResults) {
			vectorSimilarityMap.set(vr.id, Math.max(0, 1 - vr.distance));
		}
	}

	const confidenceWeight = (c: string) => {
		if (c === "high") return 1.0;
		if (c === "medium") return 0.7;
		return 0.4;
	};

	// Compute raw FTS scores first, then normalize to [0,1] for fair blending with vector
	const rawFtsScores = new Map<number, number>();
	for (const obs of obsCandidates) {
		const ageHours = (Date.now() - obs.created_at_epoch) / 3600000;
		const recencyFactor =
			MEMORY_CONFIG.injection.recencyDecay ** (ageHours / 24);
		const raw = -obs.bm25_score * recencyFactor * confidenceWeight(obs.confidence);
		rawFtsScores.set(obs.id, raw);
	}

	// Normalize raw FTS scores to [0,1]
	const normalizedFtsScores = new Map<number, number>();
	if (rawFtsScores.size > 0) {
		const values = [...rawFtsScores.values()];
		const minFts = Math.min(...values);
		const maxFts = Math.max(...values);
		const range = maxFts - minFts;
		for (const [id, raw] of rawFtsScores) {
			normalizedFtsScores.set(id, range === 0 ? 1.0 : (raw - minFts) / range);
		}
	}

	const scoreCandidate = (obsId: number): number => {
		const ftsNorm = normalizedFtsScores.get(obsId) ?? 0;

		// Hybrid: blend normalized FTS and vector scores when vector data is available
		if (vectorSimilarityMap.size > 0) {
			const vecScore = vectorSimilarityMap.get(obsId) ?? 0;
			return ftsNorm * textWeight + vecScore * vectorWeight;
		}

		return ftsNorm;
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
			score: scoreCandidate(obs.id),
			source: "observation",
			created_at: obs.created_at,
		});
	}

	// Also include vector-only candidates (not found by FTS)
	if (vectorSimilarityMap.size > 0) {
		const ftsIds = new Set(obsCandidates.map((o) => o.id));
		for (const [obsId, similarity] of vectorSimilarityMap) {
			if (ftsIds.has(obsId)) continue; // Already in FTS results
			// Fetch observation details for vector-only hits
			const row = db
				.prepare(
					`SELECT id, type, title, COALESCE(narrative, '') as content,
                  created_at, created_at_epoch, confidence
           FROM observations
           WHERE id = ? AND superseded_by IS NULL AND maturity != 'deprecated'`,
				)
				.get(obsId) as ObsCandidate | undefined;

			if (row) {
				results.push({
					id: row.id,
					type: row.type,
					title: row.title,
					content: row.content,
					score: similarity * vectorWeight, // Vector-only score
					source: "observation",
					created_at: row.created_at,
				});
			}
		}
	}

	// Compute and normalize distillation scores
	const rawDistScores: { dist: typeof distCandidates[0]; raw: number }[] = [];
	for (const dist of distCandidates) {
		const ageHours = (Date.now() - dist.time_created) / 3600000;
		const recencyFactor =
			MEMORY_CONFIG.injection.recencyDecay ** (ageHours / 24);
		rawDistScores.push({ dist, raw: -dist.bm25_score * recencyFactor * confidenceWeight("medium") });
	}

	if (rawDistScores.length > 0) {
		const values = rawDistScores.map((d) => d.raw);
		const minD = Math.min(...values);
		const maxD = Math.max(...values);
		const rangeD = maxD - minD;

		for (const { dist, raw } of rawDistScores) {
			results.push({
				id: dist.id,
				type: "distillation",
				title: `Distillation ${dist.id}`,
				content: dist.content,
				score: rangeD === 0 ? 1.0 : (raw - minD) / rangeD,
				source: "distillation",
				created_at: dist.created_at,
			});
		}
	}

	// --- Search scenes by concept overlap with query terms ---
	try {
		const scenes = listScenes();
		if (scenes.length > 0) {
			const queryLower = new Set(queryTerms.filter(t => t.length > 2).map(t => t.toLowerCase()));

			for (const scene of scenes) {
				// Compute concept overlap: what fraction of scene concepts match query terms?
				if (scene.name.length === 0) continue;

				const nameWords = new Set(
					scene.name
						.toLowerCase()
						.split(/\s+/)
						.filter((w) => w.length > 2)
						.map((w) => w.replace(/[^a-z0-9]/g, "")),
				);

				let matchCount = 0;
				for (const q of queryLower) {
					if (nameWords.has(q)) matchCount++;
				}

				const overlapScore =
					queryLower.size === 0
						? 0
						: matchCount / Math.max(queryLower.size, nameWords.size);

				if (overlapScore > 0) {
					results.push({
						id: 0,
						type: "scene",
						title: scene.name,
						content: `${scene.count} observations spanning ${scene.span}`,
						score: overlapScore * 0.8, // scenes ranked lower than exact obs matches
						source: "scene",
						created_at: new Date().toISOString(),
					});
				}
			}
		}
	} catch {
		// Scene search is best-effort
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

	// Track retrieval for observation results
	const obsIds = packed.filter((r) => r.source === "observation").map((r) => r.id);
	if (obsIds.length > 0) {
		markObservationsRetrieved(obsIds);
	}

	return packed;
}
