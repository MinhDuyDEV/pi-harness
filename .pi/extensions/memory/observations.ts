import type {
	ObservationInput,
	ObservationRow,
	ObservationType,
	SearchIndexResult,
} from "./config.js";
import { MEMORY_CONFIG } from "./config.js";
import { getMemoryDB, getObservationsMissingEmbeddings, getObservationsMissingTQEmbeddings, isSqliteVecAvailable, isTurboQuantAvailable } from "./db.js";
import { embed } from "./embeddings.js";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function storeObservation(input: ObservationInput): number {
	const db = getMemoryDB();
	const now = new Date();

	const result = db
		.prepare(
			`INSERT INTO observations
        (type, title, subtitle, narrative, facts, concepts,
         files_read, files_modified, confidence, source,
         bead_id, supersedes, maturity, helpful_count, harmful_count,
         feedback_events, effective_score, retrieval_count, last_retrieved,
         created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			input.type,
			input.title,
			input.subtitle ?? null,
			input.narrative ?? null,
			input.facts ? JSON.stringify(input.facts) : null,
			input.concepts ? JSON.stringify(input.concepts) : null,
			input.files_read ? JSON.stringify(input.files_read) : null,
			input.files_modified ? JSON.stringify(input.files_modified) : null,
			input.confidence ?? "high",
			input.source ?? "manual",
			input.bead_id ?? null,
			input.supersedes ?? null,
			"candidate", // New observations start as candidates
			0, // helpful_count
			0, // harmful_count
			null, // feedback_events
			0.0, // effective_score
			0, // retrieval_count
			null, // last_retrieved
			now.toISOString(),
			now.getTime(),
		);

	const insertedId = Number(result.lastInsertRowid);

	if (input.supersedes) {
		db.prepare(`UPDATE observations SET superseded_by = ? WHERE id = ?`).run(
			insertedId,
			input.supersedes,
		);
	}

	// Generate and store embedding asynchronously (best-effort)
	const embeddingText = buildEmbeddingText(input);
	embedAndStoreVector(insertedId, embeddingText).catch(() => {
		// Embedding is best-effort — never block observation creation
	});
	// Also store TQ quantized embedding if enabled
	if (isTurboQuantAvailable()) {
		embedAndStoreVectorTQ(insertedId, embeddingText).catch(() => {
			// TQ embedding is best-effort
		});
	}

	return insertedId;
}

/**
 * Build text for embedding from observation fields.
 * Combines title, narrative, concepts for richer semantic signal.
 */
function buildEmbeddingText(input: ObservationInput): string {
	const parts = [input.title];
	if (input.subtitle) parts.push(input.subtitle);
	if (input.narrative) parts.push(input.narrative);
	if (input.concepts?.length) parts.push(input.concepts.join(", "));
	if (input.facts?.length) parts.push(input.facts.join(", "));
	return parts.join(" ").slice(0, 2000); // Truncate for embedding model
}

/**
 * Generate embedding and insert into vec0 virtual table.
 */
async function embedAndStoreVector(observationId: number, text: string): Promise<void> {
	if (!isSqliteVecAvailable()) return;
	if (!Number.isInteger(observationId) || observationId < 0) return;

	const embedding = await embed(text);
	if (!embedding) return;

	try {
		const db = getMemoryDB();
		const vec = new Float32Array(embedding);
		const buf = Buffer.from(vec.buffer);

		// vec0 virtual tables don't support INSERT OR REPLACE.
		// Also, mixing integer and blob params in a single statement confuses better-sqlite3.
		// require() used intentionally — sqlite-vec is CJS and vec0 bindings need literal rowid.
		const id = observationId; // validated integer above
		try {
			db.prepare(`DELETE FROM vec_observations WHERE rowid = ${id}`).run();
		} catch {
			// May not exist yet — that's fine
		}
		db.prepare(
			`INSERT INTO vec_observations(rowid, embedding) VALUES (${id}, vec_f32(?))`,
		).run(buf);
	} catch (err) {
		console.warn(`[memory] Failed to store vector for observation #${observationId}:`, err);
	}
}

// ---------------------------------------------------------------------------
// TurboQuant embedding (quantized storage)
// ---------------------------------------------------------------------------

/**
 * Generate embedding, quantize with TurboQuant, and store in TQ table.
 * Falls back silently if TurboQuant is unavailable or quantization fails.
 */
async function embedAndStoreVectorTQ(observationId: number, text: string): Promise<void> {
	if (!isTurboQuantAvailable()) return;
	if (!Number.isInteger(observationId) || observationId < 0) return;

	const embedding = await embed(text);
	if (!embedding) return;

	try {
		const dim = MEMORY_CONFIG.embedding.dimensions;
		const bitWidth = MEMORY_CONFIG.embedding.quantization.bitWidth;
		const { TurboQuant } = await import("./turboquant/index.js");
		const tq = new TurboQuant(dim, bitWidth);

		const vec = new Float32Array(embedding);
		const packed = tq.compress(vec, 1);

		const db = getMemoryDB();
		// Replace any existing TQ embedding for this observation
		db.prepare(`DELETE FROM observation_embeddings_tq WHERE obs_id = ?`).run(observationId);
		db.prepare(
			`INSERT INTO observation_embeddings_tq(obs_id, packed, norm, scale, dim, bit_width)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run(
			observationId,
			Buffer.from(packed.codes.buffer),
			packed.norms[0],
			packed.scales[0],
			dim,
			bitWidth,
		);
	} catch (err) {
		console.warn(`[memory] Failed to store TQ embedding for observation #${observationId}:`, err);
	}
}

/**
 * Search observations using TurboQuant quantized embeddings.
 * Loads all TQ embeddings, decompresses, and brute-force cosine similarity.
 * Used as a fallback when sqlite-vec is unavailable.
 */
export function searchObservationsVectorTQ(
	queryEmbedding: number[],
	limit: number,
): VectorSearchResult[] {
	if (!isTurboQuantAvailable()) return [];
	if (!Number.isInteger(limit) || limit < 1) return [];

	try {
		const db = getMemoryDB();
		const dim = MEMORY_CONFIG.embedding.dimensions;
		const bitWidth = MEMORY_CONFIG.embedding.quantization.bitWidth;

		const { TurboQuant } = require("./turboquant/index.js");
		const tq = new TurboQuant(dim, bitWidth);

		// Load all TQ embeddings
		const rows = db
			.prepare(
				`SELECT e.obs_id, e.packed, e.norm, e.scale
				 FROM observation_embeddings_tq e
				 JOIN observations o ON o.id = e.obs_id
				 WHERE o.superseded_by IS NULL AND o.maturity != 'deprecated'`,
			)
			.all() as {
			obs_id: number;
			packed: Buffer;
			norm: number;
			scale: number;
		}[];

		if (rows.length === 0) return [];

		const queryVec = new Float32Array(queryEmbedding);
		let queryNorm = 0;
		for (let i = 0; i < queryVec.length; i++) {
			queryNorm += queryVec[i] * queryVec[i];
		}
		queryNorm = Math.sqrt(queryNorm);
		const queryInv = queryNorm > 1e-10 ? 1 / queryNorm : 0;

		// Score each: decompress → cosine
		const results: Array<{ id: number; distance: number }> = [];

		for (const row of rows) {
			const packedBatch = {
				codes: new Uint8Array(row.packed.buffer, row.packed.byteOffset, row.packed.byteLength),
				norms: new Float32Array([row.norm]),
				scales: new Float32Array([row.scale]),
				n: 1,
				dim,
				bitWidth,
			};

			// Decompress to approximate embedding
			const recon = tq.decompress(packedBatch);

			// Cosine similarity
			let dot = 0;
			let reconNorm = 0;
			for (let i = 0; i < dim; i++) {
				dot += queryVec[i] * recon[i];
				reconNorm += recon[i] * recon[i];
			}
			reconNorm = Math.sqrt(reconNorm);

			const cosine = queryNorm > 1e-10 && reconNorm > 1e-10
				? dot * queryInv / reconNorm
				: 0;
			// Convert similarity (0-1) to distance (0-2) matching sqlite-vec convention
			const distance = 1 - Math.max(-1, Math.min(1, cosine));

			results.push({ id: row.obs_id, distance });
		}

		// Sort by distance (ascending) and take top-k
		results.sort((a, b) => a.distance - b.distance);
		return results.slice(0, limit);
	} catch (err) {
		console.warn("[memory] TQ vector search failed:", err);
		return [];
	}
}

// ---------------------------------------------------------------------------
// Retrieval Tracking
// ---------------------------------------------------------------------------

/**
 * Increment retrieval_count and update last_retrieved for given observation IDs.
 */
export function markObservationsRetrieved(ids: number[]): void {
	if (ids.length === 0) return;
	const db = getMemoryDB();
	const now = Date.now();
	const stmt = db.prepare(
		`UPDATE observations SET retrieval_count = retrieval_count + 1, last_retrieved = ? WHERE id = ?`,
	);
	for (const id of ids) {
		stmt.run(now, id);
	}
}

// ---------------------------------------------------------------------------
// Search: FTS5
// ---------------------------------------------------------------------------

export function searchObservationsFTS(
	query: string,
	options?: {
		type?: ObservationType;
		concepts?: string[];
		limit?: number;
	},
): SearchIndexResult[] {
	const db = getMemoryDB();
	const limit = options?.limit ?? 10;

	// Build FTS5 query: escape quotes, split on whitespace, prefix-match each term
	const ftsQuery = query
		.replace(/"/g, '""')
		.split(/\s+/)
		.filter((t) => t.length > 0)
		.map((t) => `"${t}"*`)
		.join(" OR ");

	if (!ftsQuery) return [];

	try {
		let sql = `
      SELECT o.id, o.type, o.title,
             substr(COALESCE(o.narrative, ''), 1, 100) as snippet,
             o.created_at,
             bm25(observations_fts) as relevance_score
      FROM observations o
      JOIN observations_fts fts ON fts.rowid = o.id
      WHERE observations_fts MATCH ?
        AND o.superseded_by IS NULL
        AND o.maturity != 'deprecated'`;

		const params: any[] = [ftsQuery];

		if (options?.type) {
			sql += ` AND o.type = ?`;
			params.push(options.type);
		}

		sql += ` ORDER BY relevance_score LIMIT ?`;
		params.push(limit);

		return db.prepare(sql).all(...params) as unknown as SearchIndexResult[];
	} catch {
		// Fall back to LIKE search
		const likePat = `%${query}%`;
		const params: any[] = [likePat, likePat, likePat, limit];

		let sql = `
      SELECT id, type, title,
             substr(COALESCE(narrative, ''), 1, 100) as snippet,
             created_at, 0 as relevance_score
      FROM observations
      WHERE superseded_by IS NULL
        AND (title LIKE ? OR narrative LIKE ? OR concepts LIKE ?)
      ORDER BY created_at_epoch DESC LIMIT ?`;

		if (options?.type) {
			sql = `
        SELECT id, type, title,
               substr(COALESCE(narrative, ''), 1, 100) as snippet,
               created_at, 0 as relevance_score
        FROM observations
        WHERE superseded_by IS NULL
          AND type = ?
          AND (title LIKE ? OR narrative LIKE ? OR concepts LIKE ?)
        ORDER BY created_at_epoch DESC LIMIT ?`;
			params.unshift(options.type);
		}

		return db.prepare(sql).all(...params) as unknown as SearchIndexResult[];
	}
}

// ---------------------------------------------------------------------------
// Search: Vector (KNN via sqlite-vec)
// ---------------------------------------------------------------------------

export interface VectorSearchResult {
	id: number;
	distance: number;
}

/**
 * Vector similarity search using sqlite-vec's vec0 virtual table.
 * Returns observation IDs sorted by cosine distance (lower = more similar).
 */
export function searchObservationsVector(
	queryEmbedding: number[],
	limit: number,
): VectorSearchResult[] {
	if (!isSqliteVecAvailable()) return [];
	if (!Number.isInteger(limit) || limit < 1) return [];

	try {
		const db = getMemoryDB();
		const vec = new Float32Array(queryEmbedding);

		const rows = db
			.prepare(
				`SELECT rowid as id, distance
         FROM vec_observations
         WHERE embedding MATCH vec_f32(?)
         ORDER BY distance
         LIMIT ${limit}`,
			)
			.all(Buffer.from(vec.buffer)) as unknown as VectorSearchResult[];

		return rows;
	} catch (err) {
		console.warn("[memory] Vector search failed:", err);
		return [];
	}
}

// ---------------------------------------------------------------------------
// Search: Hybrid (FTS5 + Vector)
// ---------------------------------------------------------------------------

export interface HybridSearchResult extends SearchIndexResult {
	text_score: number;
	vector_score: number;
	combined_score: number;
}

/**
 * Hybrid search combining FTS5 BM25 + vector cosine similarity.
 * Weights: textWeight (0.6) + vectorWeight (0.4) — tuned for code agent.
 * Falls back to FTS5-only when vector search is unavailable.
 */
export async function searchObservationsHybrid(
	query: string,
	options?: {
		type?: ObservationType;
		limit?: number;
	},
): Promise<HybridSearchResult[]> {
	const limit = options?.limit ?? 10;
	const candidateLimit = limit * 4;
	const { weight: vectorWeight, textWeight } = MEMORY_CONFIG.vector;

	// 1. Get FTS5 results
	const ftsResults = searchObservationsFTS(query, {
		type: options?.type,
		limit: candidateLimit,
	});

	// Normalize BM25 scores (they're negative, lower = better)
	const ftsMap = new Map<number, { result: SearchIndexResult; normalizedScore: number }>();
	if (ftsResults.length > 0) {
		// BM25 scores from SQLite are negative (more negative = more relevant)
		const minScore = Math.min(...ftsResults.map((r) => r.relevance_score));
		const maxScore = Math.max(...ftsResults.map((r) => r.relevance_score));
		const range = maxScore - minScore;

		for (const r of ftsResults) {
			// Normalize: most relevant (most negative) → 1.0, least → 0.0
			// Single result always gets 1.0; zero range means all equally relevant
			const normalized = range === 0 ? 1.0 : (maxScore - r.relevance_score) / range;
			ftsMap.set(r.id, { result: r, normalizedScore: normalized });
		}
	}

	// 2. Get vector results (if available)
	const vectorMap = new Map<number, number>(); // id → similarity score (0-1)

	if (isSqliteVecAvailable()) {
		const queryEmbedding = await embed(query);
		if (queryEmbedding) {
			const vectorResults = searchObservationsVector(queryEmbedding, candidateLimit);

			if (vectorResults.length > 0) {
				// Distance is cosine distance (0 = identical, 2 = opposite)
				// Convert to similarity: 1 - distance
				for (const vr of vectorResults) {
					const similarity = Math.max(0, 1 - vr.distance);
					vectorMap.set(vr.id, similarity);
				}
			}
		}
	} else if (isTurboQuantAvailable()) {
		// Fall back to TurboQuant quantized search when sqlite-vec unavailable
		const queryEmbedding = await embed(query);
		if (queryEmbedding) {
			const tqResults = searchObservationsVectorTQ(queryEmbedding, candidateLimit);
			for (const vr of tqResults) {
				const similarity = Math.max(0, 1 - vr.distance);
				vectorMap.set(vr.id, similarity);
			}
		}
	}

	// 3. Merge results
	const allIds = new Set([...ftsMap.keys(), ...vectorMap.keys()]);
	const merged: HybridSearchResult[] = [];

	for (const id of allIds) {
		const ftsEntry = ftsMap.get(id);
		const vecScore = vectorMap.get(id) ?? 0;
		const txtScore = ftsEntry?.normalizedScore ?? 0;
		const combinedScore = txtScore * textWeight + vecScore * vectorWeight;

		// Get the base result from FTS if available, otherwise fetch basic info
		let baseResult: SearchIndexResult;
		if (ftsEntry) {
			baseResult = ftsEntry.result;
		} else {
			// Vector-only result — need to fetch basic info (skip superseded/deprecated)
			const db = getMemoryDB();
			const row = db
				.prepare(
					`SELECT id, type, title,
                  substr(COALESCE(narrative, ''), 1, 100) as snippet,
                  created_at, 0 as relevance_score
           FROM observations WHERE id = ? AND superseded_by IS NULL AND maturity != 'deprecated'`,
				)
				.get(id) as unknown as SearchIndexResult | undefined;

			if (!row) continue;
			baseResult = row;
		}

		merged.push({
			...baseResult,
			relevance_score: combinedScore,
			text_score: txtScore,
			vector_score: vecScore,
			combined_score: combinedScore,
		});
	}

	// Sort by combined score descending
	merged.sort((a, b) => b.combined_score - a.combined_score);

	return merged.slice(0, limit);
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Get all active (non-deprecated, non-superseded) observations.
 * Ordered by created_at_epoch descending (newest first).
 */
export function getAllObservations(): ObservationRow[] {
	const db = getMemoryDB();
	return db
		.prepare(
			`SELECT * FROM observations
       WHERE superseded_by IS NULL AND maturity != 'deprecated'
       ORDER BY created_at_epoch DESC`,
		)
		.all() as unknown as ObservationRow[];
}

function getObservationById(id: number): ObservationRow | null {
	const db = getMemoryDB();
	const row = db.prepare(`SELECT * FROM observations WHERE id = ?`).get(id) as unknown as
		| ObservationRow
		| undefined;
	return row ?? null;
}

export function getObservationsByIds(ids: number[]): ObservationRow[] {
	if (ids.length === 0) return [];
	const db = getMemoryDB();
	const placeholders = ids.map(() => "?").join(", ");
	const rows = db
		.prepare(`SELECT * FROM observations WHERE id IN (${placeholders})`)
		.all(...ids) as unknown as ObservationRow[];
	return rows;
}



export function getObservationStats(): Record<string, number> {
	const db = getMemoryDB();
	const rows = db
		.prepare(
			`SELECT type, COUNT(*) as count
       FROM observations
       WHERE superseded_by IS NULL
       GROUP BY type`,
		)
		.all() as Array<{ type: string; count: number }>;

	const stats: Record<string, number> = {};
	for (const row of rows) {
		stats[row.type] = row.count;
	}
	return stats;
}

// ---------------------------------------------------------------------------
// Backfill: embed observations that predate vector search
// ---------------------------------------------------------------------------

/**
 * Backfill embeddings for observations missing from vec_observations.
 * Runs asynchronously, logs progress, never throws.
 * Returns the number of observations successfully embedded.
 */
export async function backfillEmbeddings(): Promise<number> {
	const missingIds = getObservationsMissingEmbeddings();
	if (missingIds.length === 0) return 0;

	let success = 0;

	for (const id of missingIds) {
		try {
			const db = getMemoryDB();
			const row = db
				.prepare(
					`SELECT title, subtitle, narrative, concepts, facts
					 FROM observations WHERE id = ?`,
				)
				.get(id) as {
				title: string;
				subtitle: string | null;
				narrative: string | null;
				concepts: string | null;
				facts: string | null;
			} | undefined;

			if (!row) continue;

			const text = buildEmbeddingText({
				title: row.title,
				subtitle: row.subtitle ?? undefined,
				narrative: row.narrative ?? undefined,
				concepts: row.concepts?.split(",").map((s) => s.trim()) ?? undefined,
				facts: row.facts?.split(",").map((s) => s.trim()) ?? undefined,
			} as ObservationInput);

			await embedAndStoreVector(id, text);
			success++;
		} catch {
			// Skip individual failures, continue backfill
		}
	}

	return success;
}

/**
 * Backfill TurboQuant embeddings for observations missing from TQ table.
 * Runs asynchronously, never throws.
 */
export async function backfillTQEmbeddings(): Promise<number> {
	if (!isTurboQuantAvailable()) return 0;

	const missingIds = getObservationsMissingTQEmbeddings();
	if (missingIds.length === 0) return 0;

	let success = 0;

	for (const id of missingIds) {
		try {
			const db = getMemoryDB();
			const row = db
				.prepare(
					`SELECT title, subtitle, narrative, concepts, facts
					 FROM observations WHERE id = ?`,
				)
				.get(id) as {
				title: string;
				subtitle: string | null;
				narrative: string | null;
				concepts: string | null;
				facts: string | null;
			} | undefined;

			if (!row) continue;

			const text = buildEmbeddingText({
				title: row.title,
				subtitle: row.subtitle ?? undefined,
				narrative: row.narrative ?? undefined,
				concepts: row.concepts?.split(",").map((s) => s.trim()) ?? undefined,
				facts: row.facts?.split(",").map((s) => s.trim()) ?? undefined,
			} as ObservationInput);

			await embedAndStoreVectorTQ(id, text);
			success++;
		} catch {
			// Skip individual failures, continue backfill
		}
	}

	return success;
}
