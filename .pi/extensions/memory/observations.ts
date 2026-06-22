/**
 * Observation CRUD + FTS5 search.
 *
 * After ADR-001 cleanup: removed hybrid FTS5+vector search, removed
 * sqlite-vec / TurboQuant branches, removed backfill functions, removed
 * async embed-and-store hooks. FTS5 BM25 only.
 *
 * Bug fix: schema uses `created_at_epoch` (and `updated_at_epoch` /
 * `updated_at`) — the columns that exist in real DBs. The previous code
 * assumed `time_created` / `time_updated` which were never created in
 * `initializeSchema`, only declared in code.
 *
 * v9: Warning-type dedup. `storeObservation` uses `INSERT OR IGNORE`
 * against the partial unique index `idx_observations_warning_dedup`
 * (created in the v8→v9 migration) on (type, title, hour_bucket) WHERE
 * type='warning'. The same warning stored twice within the same hour
 * returns the existing row's id instead of creating a duplicate.
 * Non-warning types are unaffected (the index is partial).
 *
 * See: .pi/artifacts/DECISIONS.md#adr-001-memory-extension-cleanup
 */

import type { SQLInputValue } from "node:sqlite";
import type {
	ObservationInput,
	ObservationRow,
	ObservationType,
	SearchIndexResult,
} from "./config.js";
import { getMemoryDB } from "./db.js";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function storeObservation(input: ObservationInput): number {
	const db = getMemoryDB();
	const now = new Date();
	const nowMs = now.getTime();
	const nowIso = now.toISOString();

	const result = db
		.prepare(
			`INSERT OR IGNORE INTO observations
                (type, title, subtitle, narrative, facts, concepts,
                 files_read, files_modified, confidence, source,
                 bead_id, supersedes, helpful_count, harmful_count,
                 created_at, created_at_epoch, updated_at, updated_at_epoch)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
		)
		.run(
			input.type,
			input.title,
			input.subtitle ?? null,
			input.narrative ?? null,
			input.facts ? JSON.stringify(input.facts) : null,
			// concepts / files_read / files_modified are NOT NULL DEFAULT '[]'
			// in the schema. Passing null would violate NOT NULL; the schema's
			// DEFAULT only kicks in when the column is omitted from the column
			// list. We pass '[]' explicitly so this works both ways.
			input.concepts ? JSON.stringify(input.concepts) : "[]",
			input.files_read ? JSON.stringify(input.files_read) : "[]",
			input.files_modified ? JSON.stringify(input.files_modified) : "[]",
			input.confidence ?? "high",
			input.source ?? "manual",
			input.bead_id ?? null,
			input.supersedes ?? null,
			nowIso,
			nowMs,
			nowIso,
			nowMs,
		);

	// INSERT OR IGNORE semantics on the partial unique index
	// (idx_observations_warning_dedup):
	//   - Duplicate warning in the same hour → result.changes === 0,
	//     and result.lastInsertRowid returns the existing row's id.
	//   - New row (warning in a new hour, or any non-warning) →
	//     result.changes === 1 and lastInsertRowid is the new row's id.
	// So a single Number(...) cast gives the right id in both cases.
	const insertedId = Number(result.lastInsertRowid);

	if (input.supersedes) {
		db.prepare(`UPDATE observations SET superseded_by = ? WHERE id = ?`).run(
			insertedId,
			input.supersedes,
		);
	}

	return insertedId;
}

// ---------------------------------------------------------------------------
// Search: FTS5 BM25
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

	const ftsQuery = query
		.replace(/"/g, '""')
		.split(/\s+/)
		.filter((t) => t.length > 0)
		.map((t) => `"${t}"*`)
		.join(" OR ");

	if (!ftsQuery) return [];

	let results: SearchIndexResult[] = [];
	try {
		let sql = `
          SELECT o.id, o.type, o.title,
                 substr(COALESCE(o.narrative, ''), 1, 100) as snippet,
                 o.created_at,
                 bm25(observations_fts) as relevance_score
          FROM observations o
          JOIN observations_fts fts ON fts.rowid = o.id
          WHERE observations_fts MATCH ?
            AND o.superseded_by IS NULL`;

		const params: SQLInputValue[] = [ftsQuery];

		if (options?.type) {
			sql += ` AND o.type = ?`;
			params.push(options.type);
		}

		sql += ` ORDER BY relevance_score LIMIT ?`;
		params.push(limit);

		results = db.prepare(sql).all(...params) as unknown as SearchIndexResult[];
	} catch {
		// Fall back to LIKE search when FTS5 tokenizer is unavailable
		const likePat = `%${query}%`;
		const params: SQLInputValue[] = [likePat, likePat, likePat, limit];

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

		results = db.prepare(sql).all(...params) as unknown as SearchIndexResult[];
	}

	// Observability: bump retrieval_count + last_retrieved on returned rows.
	// Answers Armin's challenge: "have you evaluated if memory actually helps?"
	if (results.length > 0) {
		const now = Date.now();
		const ids = results.map((r) => r.id);
		const placeholders = ids.map(() => "?").join(", ");
		try {
			db.prepare(
				`UPDATE observations
				 SET retrieval_count = COALESCE(retrieval_count, 0) + 1,
				     last_retrieved = ?
				 WHERE id IN (${placeholders})`,
			).run(now, ...ids);
		} catch {
			// Best-effort; observability must never break the search
		}
	}

	return results;
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Get all active (non-superseded) observations.
 * Ordered by created_at_epoch descending (newest first).
 */
export function getAllObservations(): ObservationRow[] {
	const db = getMemoryDB();
	return db
		.prepare(
			`SELECT * FROM observations
           WHERE superseded_by IS NULL
           ORDER BY created_at_epoch DESC`,
		)
		.all() as unknown as ObservationRow[];
}

export function getObservationById(id: number): ObservationRow | null {
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
