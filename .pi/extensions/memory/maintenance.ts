import { statSync } from "node:fs";
import type {
	ArchiveOptions,
	MaintenanceStats,
} from "./config.js";
import { getMemoryDB } from "./db.js";

// ---------------------------------------------------------------------------
// Memory File Operations
// ---------------------------------------------------------------------------

// upsertMemoryFile, getMemoryFile, and getMarkdownFilesInSqlite
// have been moved to ./storage.js to break a circular dependency.

// ---------------------------------------------------------------------------
// FTS5 Maintenance
// ---------------------------------------------------------------------------

export function optimizeFTS5(): void {
	const db = getMemoryDB();
	try {
		db.prepare(
			"INSERT INTO observations_fts(observations_fts) VALUES('optimize')",
		).run();
	} catch {
		// FTS5 may not be available
	}
}

export function rebuildFTS5(): void {
	const db = getMemoryDB();
	try {
		db.prepare(
			"INSERT INTO observations_fts(observations_fts) VALUES('rebuild')",
		).run();
	} catch {
		// FTS5 may not be available
	}
}

export function checkFTS5Available(): boolean {
	const db = getMemoryDB();
	try {
		db.prepare("SELECT COUNT(*) AS cnt FROM observations_fts").get();
		return true;
	} catch {
		return false;
	}
}

export interface DuplicateArchiveSample {
	reason: "exact-non-warning" | "warning-title";
	keep_id: number;
	type: string;
	title: string;
	duplicates: number;
	duplicate_ids: string;
}

export interface DuplicateArchiveStats {
	dryRun: boolean;
	candidates: number;
	groups: number;
	exactNonWarningCandidates: number;
	warningTitleCandidates: number;
	archived: number;
	samples: DuplicateArchiveSample[];
}

interface ActiveObservationRow {
	id: number;
	type: string;
	title: string;
	subtitle: string | null;
	narrative: string | null;
	facts: string | null;
	concepts: string | null;
	files_read: string | null;
	files_modified: string | null;
	helpful_count: number | null;
	harmful_count: number | null;
	retrieval_count: number | null;
}

interface DuplicateCandidate {
	reason: DuplicateArchiveSample["reason"];
	keep: ActiveObservationRow;
	duplicates: ActiveObservationRow[];
}

function normalizeTextForDedupe(value: string | null | undefined): string {
	return (value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function normalizeWarningTitleForDedupe(title: string): string {
	const normalized = normalizeTextForDedupe(title)
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/^\[[^\]]+\]\s*/g, "")
		.replace(/\([a-z0-9_-]+:\d+\)\s*/g, "")
		.replace(/\b\d{1,3}m\b/g, "")
		.replace(/^\[[^\]]+\]\s*/g, "")
		.replace(/\s+/g, " ")
		.trim();

	// Node truncates this warning at different points depending on the rendering
	// path, so title equality still misses it after PID/shell cleanup.
	if (
		normalized.includes("no_color") &&
		normalized.includes("env is ignored") &&
		normalized.includes("due to")
	) {
		return "warning:no_color-env-ignored-due-to-force_color";
	}

	return normalized;
}

function exactNonWarningKey(row: ActiveObservationRow): string {
	return [
		row.type,
		normalizeTextForDedupe(row.title),
		normalizeTextForDedupe(row.subtitle),
		normalizeTextForDedupe(row.narrative),
		normalizeTextForDedupe(row.facts),
		normalizeTextForDedupe(row.concepts),
		normalizeTextForDedupe(row.files_read),
		normalizeTextForDedupe(row.files_modified),
	].join("\u001f");
}

function scoreRow(row: ActiveObservationRow): [number, number, number, number] {
	return [
		-(row.helpful_count ?? 0),
		-(row.retrieval_count ?? 0),
		row.harmful_count ?? 0,
		row.id,
	];
}

function compareRows(a: ActiveObservationRow, b: ActiveObservationRow): number {
	const scoreA = scoreRow(a);
	const scoreB = scoreRow(b);
	for (let i = 0; i < scoreA.length; i++) {
		const diff = scoreA[i] - scoreB[i];
		if (diff !== 0) return diff;
	}
	return 0;
}

function buildDuplicateCandidates(rows: ActiveObservationRow[]): DuplicateCandidate[] {
	const groups = new Map<string, { reason: DuplicateArchiveSample["reason"]; rows: ActiveObservationRow[] }>();
	for (const row of rows) {
		const reason: DuplicateArchiveSample["reason"] = row.type === "warning"
			? "warning-title"
			: "exact-non-warning";
		const key = row.type === "warning"
			? `warning:${normalizeWarningTitleForDedupe(row.title)}`
			: `${reason}:${exactNonWarningKey(row)}`;
		if (!groups.has(key)) groups.set(key, { reason, rows: [] });
		groups.get(key)!.rows.push(row);
	}

	return [...groups.values()]
		.filter((group) => group.rows.length > 1)
		.map((group) => {
			const sorted = [...group.rows].sort(compareRows);
			return {
				reason: group.reason,
				keep: sorted[0],
				duplicates: sorted.slice(1),
			};
		});
}

/**
 * One-shot historical duplicate archive.
 *
 * This does not delete data. It marks duplicates with `superseded_by = keep_id`,
 * which hides them from normal search/list queries while keeping the raw rows
 * available for audit/export. Two conservative duplicate classes are handled:
 *
 * 1. Non-warning exact duplicates: same type/title/subtitle/narrative/facts/
 *    concepts/files_read/files_modified after lower/trim normalization.
 * 2. Warning cross-hour duplicates: same normalized warning title. Normalization
 *    strips volatile shell/PID/color prefixes such as `[bash]`, `(node:12345)`,
 *    and `39m`, so NO_COLOR warnings collapse even when each process changes
 *    the title.
 */
export function archiveDuplicateObservations(options: { dryRun?: boolean; sampleLimit?: number } = {}): DuplicateArchiveStats {
	const dryRun = options.dryRun ?? true;
	const sampleLimit = options.sampleLimit ?? 10;
	const db = getMemoryDB();

	const rows = db
		.prepare(`SELECT id, type, title, subtitle, narrative, facts, concepts,
			       files_read, files_modified, helpful_count, harmful_count,
			       retrieval_count
			FROM observations
			WHERE superseded_by IS NULL`)
		.all() as unknown as ActiveObservationRow[];
	const duplicateGroups = buildDuplicateCandidates(rows);

	let candidates = 0;
	let exactNonWarningCandidates = 0;
	let warningTitleCandidates = 0;
	for (const group of duplicateGroups) {
		const count = group.duplicates.length;
		candidates += count;
		if (group.reason === "exact-non-warning") exactNonWarningCandidates += count;
		if (group.reason === "warning-title") warningTitleCandidates += count;
	}

	const samples = duplicateGroups
		.map((group) => ({
			reason: group.reason,
			keep_id: group.keep.id,
			type: group.keep.type,
			title: group.keep.title,
			duplicates: group.duplicates.length,
			duplicate_ids: group.duplicates.map((row) => row.id).join(","),
		}))
		.sort((a, b) => b.duplicates - a.duplicates || a.reason.localeCompare(b.reason) || a.title.localeCompare(b.title))
		.slice(0, sampleLimit);

	let archived = 0;
	if (!dryRun && candidates > 0) {
		const now = new Date();
		const update = db.prepare(`UPDATE observations
			SET superseded_by = ?, updated_at = ?, updated_at_epoch = ?
			WHERE id = ? AND superseded_by IS NULL`);
		for (const group of duplicateGroups) {
			for (const row of group.duplicates) {
				const result = update.run(group.keep.id, now.toISOString(), now.getTime(), row.id);
				archived += Number(result.changes);
			}
		}
	}

	return {
		dryRun,
		candidates,
		groups: duplicateGroups.length,
		exactNonWarningCandidates,
		warningTitleCandidates,
		archived,
		samples,
	};
}

// ---------------------------------------------------------------------------
// Database Maintenance
// ---------------------------------------------------------------------------

export function archiveOldObservations(options?: ArchiveOptions): number {
	const {
		olderThanDays = 90,
		includeSuperseded = true,
		dryRun = false,
	} = options ?? {};

	const db = getMemoryDB();
	const threshold = Date.now() - olderThanDays * 86_400_000;

	if (dryRun) {
		const baseCount = (
			db
				.prepare(
					"SELECT COUNT(*) as cnt FROM observations WHERE created_at_epoch < ? AND superseded_by IS NULL",
				)
				.get(threshold) as { cnt: number }
		).cnt;

		if (!includeSuperseded) return baseCount;

		const supersededCount = (
			db
				.prepare(
					"SELECT COUNT(*) as cnt FROM observations WHERE superseded_by IS NOT NULL",
				)
				.get() as { cnt: number }
		).cnt;

		return baseCount + supersededCount;
	}

	// Ensure archive table exists
	db.exec(`
    CREATE TABLE IF NOT EXISTS observations_archive AS
      SELECT *, NULL AS archived_at FROM observations WHERE 0
  `);

	const whereClause = includeSuperseded
		? "WHERE created_at_epoch < ?"
		: "WHERE created_at_epoch < ? AND superseded_by IS NULL";

	const insertSql = `
    INSERT INTO observations_archive
      SELECT *, datetime('now') FROM observations ${whereClause}
  `;
	const deleteSql = `DELETE FROM observations ${whereClause}`;

	db.prepare(insertSql).run(threshold);
	const result = db.prepare(deleteSql).run(threshold);

	return Number(result.changes);
}

export function checkpointWAL(): { walSize: number; checkpointed: boolean } {
	const db = getMemoryDB();
	try {
		const row = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all() as Array<{
			log: number;
			checkpointed: number;
		}>;
		const walSize = row[0]?.log ?? 0;
		const checkpointed = (row[0]?.checkpointed ?? 0) > 0;
		return { walSize, checkpointed };
	} catch {
		return { walSize: 0, checkpointed: false };
	}
}

function vacuumDatabase(): boolean {
	const db = getMemoryDB();
	try {
		db.exec("VACUUM");
		return true;
	} catch {
		return false;
	}
}

export function getDatabaseSizes(): {
	mainDb: number;
	wal: number;
	shm: number;
	total: number;
} {
	const db = getMemoryDB();
	// Access the underlying file path via the db object
	const dbPath: string = (db as unknown as { name: string }).name;

	const getSize = (path: string): number => {
		try {
			return statSync(path).size;
		} catch {
			return 0;
		}
	};

	const mainDb = getSize(dbPath);
	const wal = getSize(`${dbPath}-wal`);
	const shm = getSize(`${dbPath}-shm`);

	return { mainDb, wal, shm, total: mainDb + wal + shm };
}



// ---------------------------------------------------------------------------
// Full Maintenance Cycle
// ---------------------------------------------------------------------------

export function runFullMaintenance(options?: ArchiveOptions): MaintenanceStats {
	const sizeBefore = getDatabaseSizes();
	const archivedObservations = archiveOldObservations(options);
	optimizeFTS5();
	const { walSize, checkpointed } = checkpointWAL();
	const vacuumed = vacuumDatabase();
	const sizeAfter = getDatabaseSizes();

	return {
		archived: archivedObservations,
		vacuumed,
		checkpointed,
		freedBytes: Math.max(0, sizeBefore.total - sizeAfter.total),
		dbSizeBefore: sizeBefore.total,
		dbSizeAfter: sizeAfter.total,
	};
}
