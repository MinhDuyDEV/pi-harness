/**
 * Memory database schema migrations.
 *
 * Each migration is a forward-only transformation from one schema version
 * to the next. They are applied in order during database initialization.
 *
 * v7 is the cleanup migration. It drops the tables introduced by the
 * deleted L1/L2/L3 pipeline, persona/scenes, vec embeddings, and TurboQuant
 * subsystems. v1 (in db.ts) is the only forward migration going forward.
 *
 * v8 is a follow-up cleanup. It drops the FTS5 tables from the deleted
 * project-index subsystem. (The v6→v7 migration left these because they
 * were not on the deletion list at the time.)
 *
 * Existing observations columns (maturity, effective_score, retrieval_count,
 * last_retrieved, feedback_events) are left in place for backward compat with
 * existing rows — they are no longer maintained by the code.
 *
 * **Defensive policy**: every DROP is wrapped in try/catch. SQLite refuses to
 * drop a virtual table whose module isn't loaded (e.g., vec0 without
 * sqlite-vec, or FTS5 if the build is missing it). A failed DROP would
 * otherwise crash the entire extension load. We catch and log instead.
 */

import type { DatabaseSync } from "node:sqlite";
import { runInTransaction } from "./db.js";

export interface MigrationContext {
	db: DatabaseSync;
}

export type Migration = (ctx: MigrationContext) => void;

/**
 * Defensive DROP. SQLite throws if a virtual table's module isn't loaded
 * (e.g. vec0 without sqlite-vec). For regular tables and FTS5 this is
 * a no-op when the table doesn't exist. We swallow the error so one bad
 * drop never crashes the migration chain.
 */
function safeDrop(db: DatabaseSync, sql: string): void {
	try {
		db.exec(sql);
	} catch (err) {
		// Best-effort cleanup. The orphan (if any) is harmless — it is
		// never queried by the current code.
		const msg = err instanceof Error ? err.message : String(err);
		// eslint-disable-next-line no-console
		console.warn(`[memory migrations] safeDrop failed (ignored): ${msg}`);
	}
}

/**
 * Drop all artifacts of the deleted L1/L2/L3 pipeline, persona/scenes,
 * vec embeddings, and TurboQuant subsystems. Safe to run on a fresh DB
 * (DROP TABLE IF EXISTS is a no-op when the table does not exist).
 */
function migrateV6ToV7({ db }: MigrationContext): void {
	runInTransaction(db, () => {
		// vec + TQ embedding tables.
		// vec_observations (vec0 virtual table) is intentionally skipped:
		// sqlite-vec was removed from package.json, so the module can't be
		// loaded and DROP TABLE would throw. The orphan is never queried.
		safeDrop(db, "DROP TABLE IF EXISTS observation_embeddings_tq");

		// Pipeline tables (L1 temporal messages + L2 distillations + FTS5)
		safeDrop(db, "DROP TABLE IF EXISTS temporal_messages");
		safeDrop(db, "DROP TABLE IF EXISTS distillations");
		safeDrop(db, "DROP TABLE IF EXISTS distillations_fts");

		// Record version
		db.prepare(
			"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
		).run(7, new Date().toISOString());
	});
}

/**
 * Drop FTS5 tables from the deleted project-index subsystem. These were
 * not on the v6→v7 deletion list (only the vec/TQ/pipeline tables were),
 * so they remain as dead weight in the DB. They are FTS5, not vec0, so
 * they CAN be dropped — but we still wrap in safeDrop for defensiveness.
 */
function migrateV7ToV8({ db }: MigrationContext): void {
	runInTransaction(db, () => {
		// Drop the regular table first (it has triggers referencing the
		// FTS5 virtual table, so dropping the FTS5 table first would leave
		// dangling triggers).
		safeDrop(db, "DROP TABLE IF EXISTS project_fts");

		// Drop the FTS5 virtual table. Its internal shadow tables
		// (project_fts_idx_data, project_fts_idx_idx, project_fts_idx_4_5,
		// project_fts_idx_5_5) are dropped automatically with the parent.
		safeDrop(db, "DROP TABLE IF EXISTS project_fts_idx");

		// Record version
		db.prepare(
			"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
		).run(8, new Date().toISOString());
	});
}

/**
 * Warning-type dedup. The same warning was being stored 6-10× per session
 * because nothing prevented it. We:
 *   1. Backfill: DELETE duplicate warnings, keeping the earliest id per
 *      (title, hour_bucket). The FTS5 AFTER DELETE trigger keeps the FTS
 *      index consistent automatically.
 *   2. Add a partial unique index on (type, title, hour_bucket) WHERE
 *      type='warning'. This makes INSERT OR IGNORE in storeObservation
 *      atomically reject duplicates within the same hour.
 *   3. Record version 9.
 *
 * Hour bucketing: created_at_epoch is milliseconds since epoch.
 * Dividing by 3_600_000 (one hour in ms) gives an integer hour bucket.
 * SQLite's `/` on integers is integer division.
 *
 * Idempotent: each step is a no-op on re-run.
 *
 * See: .pi/artifacts/notes/2026-W25.md — "Add warning-type dedup" finding.
 */
function migrateV8ToV9({ db }: MigrationContext): void {
	runInTransaction(db, () => {
		// 1. Backfill: dedup existing warnings. Keep MIN(id) per (title, hour).
		//    Other observation types are untouched.
		db.exec(`
			DELETE FROM observations
			WHERE type = 'warning'
			  AND id NOT IN (
			    SELECT MIN(id) FROM observations
			    WHERE type = 'warning'
			    GROUP BY title, (created_at_epoch / 3600000)
			  )
		`);

		// 2. Forward dedup: partial unique index on (type, title, hour_bucket).
		//    IF NOT EXISTS makes this idempotent.
		db.exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_warning_dedup
			ON observations(type, title, (created_at_epoch / 3600000))
			WHERE type = 'warning'
		`);

		// 3. Record version
		db.prepare(
			"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
		).run(9, new Date().toISOString());
	});
}

/**
 * Schema-drift fix: the live DB (and any DB created before the ADR-001
 * cleanup) is missing the `updated_at_epoch` column on `observations`.
 * The column IS in db.ts CREATE TABLE, so fresh DBs have it. But the
 * pre-cleanup live DB doesn't, and the new code paths reference it:
 *   - observations.ts INSERT column list
 *   - scoring.ts UPDATE on feedback
 *   - storage.ts UPDATE on memory_files (already has the column)
 *
 * Before this migration, the missing column caused storeObservation to
 * fail silently (the v9 INSERT OR IGNORE swallowed the column-not-found
 * error, making the regression invisible to callers).
 *
 * No backfill: the column is nullable, no consumer reads it for old rows,
 * and `updated_at` (TEXT) already exists for those rows. New writes from
 * storeObservation populate it correctly.
 *
 * Idempotent: pragma_table_info is consulted before ALTER, since SQLite
 * does NOT support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
 *
 * See: schema-drift investigation after W25 finding #2 was shipped.
 */
function migrateV9ToV10({ db }: MigrationContext): void {
	runInTransaction(db, () => {
		const hasColumn = db
			.prepare(
				"SELECT 1 AS x FROM pragma_table_info('observations') WHERE name = 'updated_at_epoch'",
			)
			.get() as { x: number } | undefined;
		if (!hasColumn) {
			db.exec("ALTER TABLE observations ADD COLUMN updated_at_epoch INTEGER");
		}

		db.prepare(
			"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
		).run(10, new Date().toISOString());
	});
}

/**
 * Ordered list of forward migrations. Apply via `applyMigrations(ctx)`.
 * v1 base schema is in db.ts `initializeSchema()`. v7 is the cleanup.
 * v8 is the FTS5 project-index cleanup follow-up.
 * v9 adds warning-type dedup (partial unique index).
 * v10 fixes pre-ADR-001 schema drift: adds `updated_at_epoch` to
 *    `observations` if missing.
 */
export const MIGRATIONS: readonly Migration[] = [
	migrateV6ToV7,
	migrateV7ToV8,
	migrateV8ToV9,
	migrateV9ToV10,
] as const;

/**
 * Run all migrations sequentially against the given database. Each
 * migration runs in a transaction, so partial state is not visible.
 */
export function applyMigrations(ctx: MigrationContext): void {
	for (const migrate of MIGRATIONS) {
		migrate(ctx);
	}
}

/**
 * Runtime smoke test: verify that the current schema_version is at or
 * above the expected minimum. If a migration silently failed, this will
 * surface it instead of letting the extension operate on a half-migrated DB.
 *
 * Returns the current version, or throws if no version is recorded.
 */
export function verifySchemaVersion(ctx: MigrationContext, minVersion: number = 10): number {
	const row = ctx.db
		.prepare("SELECT MAX(version) AS v FROM schema_versions")
		.get() as { v: number | null } | undefined;
	const current = row?.v ?? 0;
	if (current < minVersion) {
		throw new Error(
			`Memory DB schema is at v${current} but v${minVersion} is required. ` +
				`Run the memory extension to trigger migrations, or check the migration logs.`,
		);
	}
	return current;
}
