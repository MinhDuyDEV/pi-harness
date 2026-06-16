/**
 * Memory database schema migrations.
 *
 * Each migration is a forward-only transformation from one schema version
 * to the next. They are applied in order during database initialization.
 *
 * Extracted from db.ts to keep the orchestrator readable. The functions
 * depend on `sqliteVecAvailable` and `MEMORY_CONFIG`, which are imported
 * from their respective modules by the caller (db.ts) and passed in via
 * the closure created by `createMigrations(...)`.
 */

import type { DatabaseSync } from "node:sqlite";
import { runInTransaction } from "./db.js";
import { MEMORY_CONFIG } from "./config.js";

export interface MigrationContext {
	db: DatabaseSync;
	sqliteVecAvailable: boolean;
}

export type Migration = (ctx: MigrationContext) => void;

function migrateV1ToV2({ db }: MigrationContext): void {
	runInTransaction(db, () => {
		// Add source column if missing
		try {
			db.exec(
				`ALTER TABLE observations ADD COLUMN source TEXT CHECK(source IN ('manual','curator','imported')) DEFAULT 'manual'`,
			);
			db.exec(
				"CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source)",
			);
		} catch {
			// Column may already exist
		}

		// Create temporal_messages and distillations tables
		db.exec(`
      CREATE TABLE IF NOT EXISTS temporal_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_id TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        time_created INTEGER NOT NULL,
        distillation_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        tool_name TEXT,
        tool_call_id TEXT,
        status TEXT,
        is_error INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT,
        FOREIGN KEY(distillation_id) REFERENCES distillations(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_temporal_session ON temporal_messages(session_id, time_created);
      CREATE INDEX IF NOT EXISTS idx_temporal_undistilled ON temporal_messages(session_id) WHERE distillation_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_temporal_time ON temporal_messages(time_created DESC);
      CREATE INDEX IF NOT EXISTS idx_temporal_tool ON temporal_messages(tool_name, tool_call_id);
      CREATE INDEX IF NOT EXISTS idx_temporal_status ON temporal_messages(status, is_error);

      CREATE TABLE IF NOT EXISTS distillations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        terms TEXT NOT NULL DEFAULT '[]',
        message_count INTEGER NOT NULL DEFAULT 0,
        compression_ratio REAL NOT NULL DEFAULT 0.0,
        time_start INTEGER NOT NULL,
        time_end INTEGER NOT NULL,
        time_created INTEGER NOT NULL,
        meta_distillation_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(meta_distillation_id) REFERENCES distillations(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_distillations_session ON distillations(session_id, time_created DESC);
      CREATE INDEX IF NOT EXISTS idx_distillations_time ON distillations(time_created DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS distillations_fts USING fts5(
        content, terms,
        content='distillations',
        content_rowid='id',
        tokenize='porter unicode61'
      );
    `);

		// Add distillation FTS triggers
		db.exec(`
      CREATE TRIGGER IF NOT EXISTS distillations_fts_ai AFTER INSERT ON distillations BEGIN
        INSERT INTO distillations_fts(rowid, content, terms) VALUES (new.id, new.content, new.terms);
      END;
      CREATE TRIGGER IF NOT EXISTS distillations_fts_ad AFTER DELETE ON distillations BEGIN
        INSERT INTO distillations_fts(distillations_fts, rowid, content, terms) VALUES('delete', old.id, old.content, old.terms);
      END;
      CREATE TRIGGER IF NOT EXISTS distillations_fts_au AFTER UPDATE ON distillations BEGIN
        INSERT INTO distillations_fts(distillations_fts, rowid, content, terms) VALUES('delete', old.id, old.content, old.terms);
        INSERT INTO distillations_fts(rowid, content, terms) VALUES (new.id, new.content, new.terms);
      END;
    `);

		// Record version
		db.prepare(
			"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
		).run(2, new Date().toISOString());
	});
}

function migrateV2ToV3({ db }: MigrationContext): void {
	runInTransaction(db, () => {
		// Add maturity, feedback, and scoring columns
		const columns = [
			[
				"maturity",
				"TEXT CHECK(maturity IN ('candidate','established','proven','deprecated')) DEFAULT 'candidate'",
			],
			["helpful_count", "INTEGER NOT NULL DEFAULT 0"],
			["harmful_count", "INTEGER NOT NULL DEFAULT 0"],
			["feedback_events", "TEXT"], // JSON array of FeedbackEvent
			["effective_score", "REAL NOT NULL DEFAULT 0.0"],
		];

		for (const [name, definition] of columns) {
			try {
				db.exec(
					`ALTER TABLE observations ADD COLUMN ${name} ${definition}`,
				);
			} catch {
				// Column may already exist
			}
		}

		// Add index for score-based retrieval
		db.exec(
			"CREATE INDEX IF NOT EXISTS idx_observations_score ON observations(effective_score DESC)",
		);
		db.exec(
			"CREATE INDEX IF NOT EXISTS idx_observations_maturity ON observations(maturity)",
		);

		// Record version
		db.prepare(
			"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
		).run(3, new Date().toISOString());
	});
}

function migrateV3ToV4({ db, sqliteVecAvailable }: MigrationContext): void {
	runInTransaction(db, () => {
		// Add retrieval tracking columns
		const columns = [
			["retrieval_count", "INTEGER NOT NULL DEFAULT 0"],
			["last_retrieved", "INTEGER"],
		];

		for (const [name, definition] of columns) {
			try {
				db.exec(
					`ALTER TABLE observations ADD COLUMN ${name} ${definition}`,
				);
			} catch {
				// Column may already exist
			}
		}

		// Add index for retrieval-based queries
		db.exec(
			"CREATE INDEX IF NOT EXISTS idx_observations_retrieval ON observations(retrieval_count DESC)",
		);

		// Create vec0 virtual table if sqlite-vec is available
		if (sqliteVecAvailable) {
			try {
				const dims = MEMORY_CONFIG.embedding.dimensions;
				db.exec(`
					CREATE VIRTUAL TABLE IF NOT EXISTS vec_observations USING vec0(
						embedding float[${dims}]
					);
				`);
			} catch (err) {
				console.warn("[memory] Failed to create vec0 table:", err);
			}
		}

		// Record version
		db.prepare(
			"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
		).run(4, new Date().toISOString());
	});
}

function migrateV4ToV5({ db }: MigrationContext): void {
	runInTransaction(db, () => {
		const columns = [
			["tool_name", "TEXT"],
			["tool_call_id", "TEXT"],
			["status", "TEXT"],
			["is_error", "INTEGER NOT NULL DEFAULT 0"],
			["raw_json", "TEXT"],
		];

		for (const [name, definition] of columns) {
			try {
				db.exec(`ALTER TABLE temporal_messages ADD COLUMN ${name} ${definition}`);
			} catch {
				// Column may already exist
			}
		}

		db.exec("CREATE INDEX IF NOT EXISTS idx_temporal_tool ON temporal_messages(tool_name, tool_call_id)");
		db.exec("CREATE INDEX IF NOT EXISTS idx_temporal_status ON temporal_messages(status, is_error)");

		db.prepare(
			"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
		).run(5, new Date().toISOString());
	});
}

function migrateV5ToV6({ db }: MigrationContext): void {
	// Create TQ embeddings table (safe to run every time via IF NOT EXISTS)
	db.exec(`
		CREATE TABLE IF NOT EXISTS observation_embeddings_tq (
			obs_id INTEGER PRIMARY KEY,
			packed BLOB NOT NULL,
			norm REAL NOT NULL,
			scale REAL NOT NULL,
			dim INTEGER NOT NULL DEFAULT 384,
			bit_width INTEGER NOT NULL DEFAULT 4,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY(obs_id) REFERENCES observations(id) ON DELETE CASCADE
		);
	`);
	// Index for backfill detection
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_tq_embeddings_obs ON observation_embeddings_tq(obs_id);
	`);

	// Record migration (no-op if already recorded)
	db.prepare(
		"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
	).run(6, new Date().toISOString());
}

/**
 * Ordered list of forward migrations. Apply via `applyMigrations(ctx)`.
 * Adding a new migration: append here and add the corresponding `migrateV{N}ToV{N+1}` function.
 */
export const MIGRATIONS: readonly Migration[] = [
	migrateV1ToV2,
	migrateV2ToV3,
	migrateV3ToV4,
	migrateV4ToV5,
	migrateV5ToV6,
] as const;

/**
 * Run all migrations sequentially against the given database. Each
 * migration runs in a transaction (the individual functions use
 * `runInTransaction` internally), so partial state is not visible.
 */
export function applyMigrations(ctx: MigrationContext): void {
	for (const migrate of MIGRATIONS) {
		migrate(ctx);
	}
}
