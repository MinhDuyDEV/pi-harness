import type {
	ObservationInput,
	ObservationRow,
	ObservationType,
	SearchIndexResult,
} from "./config.js";
import { getMemoryDB } from "./db.js";

export function storeObservation(input: ObservationInput): number {
	const db = getMemoryDB();
	const now = new Date();

	const result = db
		.prepare(
			`INSERT INTO observations
        (type, title, subtitle, narrative, facts, concepts,
         files_read, files_modified, confidence, source,
         bead_id, supersedes, maturity, helpful_count, harmful_count,
         feedback_events, effective_score, created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

	return insertedId;
}

export function getObservationById(id: number): ObservationRow | null {
	const db = getMemoryDB();
	const row = db.prepare(`SELECT * FROM observations WHERE id = ?`).get(id) as
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
		.all(...ids) as ObservationRow[];
	return rows;
}

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

		const params: unknown[] = [ftsQuery];

		if (options?.type) {
			sql += ` AND o.type = ?`;
			params.push(options.type);
		}

		sql += ` ORDER BY relevance_score LIMIT ?`;
		params.push(limit);

		return db.prepare(sql).all(...params) as SearchIndexResult[];
	} catch {
		// Fall back to LIKE search
		const likePat = `%${query}%`;
		const params: unknown[] = [likePat, likePat, likePat, limit];

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

		return db.prepare(sql).all(...params) as SearchIndexResult[];
	}
}

export function getTimelineAroundObservation(
	anchorId: number,
	depthBefore = 5,
	depthAfter = 5,
): {
	anchor: ObservationRow | null;
	before: SearchIndexResult[];
	after: SearchIndexResult[];
} {
	const db = getMemoryDB();

	const anchor = getObservationById(anchorId);
	if (!anchor) {
		return { anchor: null, before: [], after: [] };
	}

	const before = db
		.prepare(
			`SELECT id, type, title,
              substr(COALESCE(narrative, ''), 1, 100) as snippet,
              created_at, 0 as relevance_score
       FROM observations
       WHERE created_at_epoch < ?
       ORDER BY created_at_epoch DESC
       LIMIT ?`,
		)
		.all(anchor.created_at_epoch, depthBefore) as SearchIndexResult[];

	const after = db
		.prepare(
			`SELECT id, type, title,
              substr(COALESCE(narrative, ''), 1, 100) as snippet,
              created_at, 0 as relevance_score
       FROM observations
       WHERE created_at_epoch > ?
       ORDER BY created_at_epoch ASC
       LIMIT ?`,
		)
		.all(anchor.created_at_epoch, depthAfter) as SearchIndexResult[];

	return { anchor, before, after };
}

export function getMostRecentObservation(): ObservationRow | null {
	const db = getMemoryDB();
	const row = db
		.prepare(
			`SELECT * FROM observations
       WHERE superseded_by IS NULL
       ORDER BY created_at_epoch DESC
       LIMIT 1`,
		)
		.get() as ObservationRow | undefined;
	return row ?? null;
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
