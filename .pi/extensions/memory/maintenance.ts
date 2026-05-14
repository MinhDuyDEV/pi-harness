import { statSync } from "node:fs";
import type {
	ArchiveOptions,
	MaintenanceStats,
	MemoryFileRow,
} from "./config.js";
import { getMemoryDB } from "./db.js";
import { purgeOldTemporalMessages } from "./pipeline.js";

// ---------------------------------------------------------------------------
// Memory File Operations
// ---------------------------------------------------------------------------

export function upsertMemoryFile(
	filePath: string,
	content: string,
	mode: "replace" | "append" = "replace",
): void {
	const db = getMemoryDB();
	const now = new Date().toISOString();
	const nowEpoch = Date.now();

	db.prepare(
		`INSERT INTO memory_files (file_path, content, mode, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       content = CASE WHEN excluded.mode = 'append'
         THEN memory_files.content || '\n\n' || excluded.content
         ELSE excluded.content END,
       mode = excluded.mode,
       updated_at = ?,
       updated_at_epoch = ?`,
	).run(filePath, content, mode, now, nowEpoch, now, nowEpoch);
}

export function getMemoryFile(filePath: string): MemoryFileRow | null {
	const db = getMemoryDB();
	return (
		(db
			.prepare("SELECT * FROM memory_files WHERE file_path = ?")
			.get(filePath) as MemoryFileRow | undefined) ?? null
	);
}

// ---------------------------------------------------------------------------
// FTS5 Maintenance
// ---------------------------------------------------------------------------

export function optimizeFTS5(): void {
	const db = getMemoryDB();
	try {
		db.prepare(
			"INSERT INTO observations_fts(observations_fts) VALUES('optimize')",
		).run();
		db.prepare(
			"INSERT INTO distillations_fts(distillations_fts) VALUES('optimize')",
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
		db.prepare(
			"INSERT INTO distillations_fts(distillations_fts) VALUES('rebuild')",
		).run();
	} catch {
		// FTS5 may not be available
	}
}

export function checkFTS5Available(): boolean {
	const db = getMemoryDB();
	try {
		db.prepare("SELECT * FROM observations_fts LIMIT 0").all();
		return true;
	} catch {
		return false;
	}
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

	return result.changes;
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

export function vacuumDatabase(): boolean {
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

export function getMarkdownFilesInSqlite(): string[] {
	const db = getMemoryDB();
	const rows = db
		.prepare(
			"SELECT markdown_file FROM observations WHERE markdown_file IS NOT NULL",
		)
		.all() as Array<{ markdown_file: string }>;
	return rows.map((r) => r.markdown_file);
}

// ---------------------------------------------------------------------------
// Full Maintenance Cycle
// ---------------------------------------------------------------------------

export function runFullMaintenance(options?: ArchiveOptions): MaintenanceStats {
	const sizeBefore = getDatabaseSizes();
	const archivedObservations = archiveOldObservations(options);
	const purgedMessages = purgeOldTemporalMessages();
	optimizeFTS5();
	const { walSize, checkpointed } = checkpointWAL();
	const vacuumed = vacuumDatabase();
	const sizeAfter = getDatabaseSizes();

	return {
		archived: archivedObservations,
		vacuumed,
		checkpointed,
		prunedMarkdown: 0,
		purgedMessages,
		freedBytes: Math.max(0, sizeBefore.total - sizeAfter.total),
		dbSizeBefore: sizeBefore.total,
		dbSizeAfter: sizeAfter.total,
	};
}
