/**
 * SQLite database layer for the memory system.
 * Uses better-sqlite3 (synchronous, native bindings).
 *
 * DEPENDENCY: npm install better-sqlite3 @types/better-sqlite3
 */

import path from "node:path";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Schema SQL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
-- Schema versioning
CREATE TABLE IF NOT EXISTS schema_versions (
  id INTEGER PRIMARY KEY,
  version INTEGER UNIQUE NOT NULL,
  applied_at TEXT NOT NULL
);

-- Observations
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('decision','bugfix','feature','pattern','discovery','learning','warning')),
  title TEXT NOT NULL,
  subtitle TEXT,
  facts TEXT,
  narrative TEXT,
  concepts TEXT,
  files_read TEXT,
  files_modified TEXT,
  confidence TEXT CHECK(confidence IN ('high','medium','low')) DEFAULT 'high',
  bead_id TEXT,
  supersedes INTEGER,
  superseded_by INTEGER,
  valid_until TEXT,
  markdown_file TEXT,
  source TEXT CHECK(source IN ('manual','curator','imported')) DEFAULT 'manual',
  maturity TEXT CHECK(maturity IN ('candidate','established','proven','deprecated')) DEFAULT 'candidate',
  helpful_count INTEGER NOT NULL DEFAULT 0,
  harmful_count INTEGER NOT NULL DEFAULT 0,
  feedback_events TEXT,
  effective_score REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL,
  updated_at TEXT,
  FOREIGN KEY(supersedes) REFERENCES observations(id) ON DELETE SET NULL,
  FOREIGN KEY(superseded_by) REFERENCES observations(id) ON DELETE SET NULL
);

-- FTS5 for observations (porter stemming)
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  title, subtitle, narrative, facts, concepts,
  content='observations',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);
CREATE INDEX IF NOT EXISTS idx_observations_bead_id ON observations(bead_id);
CREATE INDEX IF NOT EXISTS idx_observations_superseded ON observations(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source);

-- Memory files
CREATE TABLE IF NOT EXISTS memory_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  mode TEXT CHECK(mode IN ('replace','append')) DEFAULT 'replace',
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL,
  updated_at TEXT,
  updated_at_epoch INTEGER
);
CREATE INDEX IF NOT EXISTS idx_memory_files_path ON memory_files(file_path);

-- Temporal messages
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
  FOREIGN KEY(distillation_id) REFERENCES distillations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_temporal_session ON temporal_messages(session_id, time_created);
CREATE INDEX IF NOT EXISTS idx_temporal_undistilled ON temporal_messages(session_id) WHERE distillation_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_temporal_time ON temporal_messages(time_created DESC);

-- Distillations
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

-- FTS5 for distillations
CREATE VIRTUAL TABLE IF NOT EXISTS distillations_fts USING fts5(
  content, terms,
  content='distillations',
  content_rowid='id',
  tokenize='porter unicode61'
);
`;

// ---------------------------------------------------------------------------
// FTS Sync Triggers
// ---------------------------------------------------------------------------

const FTS_TRIGGERS_SQL = `
-- Observations FTS triggers
CREATE TRIGGER IF NOT EXISTS observations_fts_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts)
  VALUES (new.id, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
END;

CREATE TRIGGER IF NOT EXISTS observations_fts_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts)
  VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
END;

CREATE TRIGGER IF NOT EXISTS observations_fts_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts)
  VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
  INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts)
  VALUES (new.id, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
END;

-- Distillations FTS triggers
CREATE TRIGGER IF NOT EXISTS distillations_fts_ai AFTER INSERT ON distillations BEGIN
  INSERT INTO distillations_fts(rowid, content, terms)
  VALUES (new.id, new.content, new.terms);
END;

CREATE TRIGGER IF NOT EXISTS distillations_fts_ad AFTER DELETE ON distillations BEGIN
  INSERT INTO distillations_fts(distillations_fts, rowid, content, terms)
  VALUES('delete', old.id, old.content, old.terms);
END;

CREATE TRIGGER IF NOT EXISTS distillations_fts_au AFTER UPDATE ON distillations BEGIN
  INSERT INTO distillations_fts(distillations_fts, rowid, content, terms)
  VALUES('delete', old.id, old.content, old.terms);
  INSERT INTO distillations_fts(rowid, content, terms)
  VALUES (new.id, new.content, new.terms);
END;
`;

// ---------------------------------------------------------------------------
// DB Singleton
// ---------------------------------------------------------------------------

let dbInstance: Database.Database | null = null;

export function getMemoryDB(): Database.Database {
	if (dbInstance) return dbInstance;

	const dbPath = path.join(process.cwd(), ".pi", "memory.db");
	dbInstance = new Database(dbPath);

	// Enable WAL mode + foreign keys
	dbInstance.pragma("journal_mode = WAL");
	dbInstance.pragma("foreign_keys = ON");

	initializeSchema(dbInstance);
	return dbInstance;
}

export function closeMemoryDB(): void {
	if (dbInstance) {
		dbInstance.close();
		dbInstance = null;
	}
}

// ---------------------------------------------------------------------------
// Schema initialization
// ---------------------------------------------------------------------------

function initializeSchema(db: Database.Database): void {
	// Check current version
	try {
		const row = db
			.prepare(
				"SELECT version FROM schema_versions ORDER BY version DESC LIMIT 1",
			)
			.get() as { version: number } | undefined;

		if (row && row.version >= 3) return; // Already at v3

		if (row && row.version === 2) {
			migrateV2ToV3(db);
			return;
		}

		if (row && row.version === 1) {
			migrateV1ToV2(db);
			migrateV2ToV3(db);
			return;
		}
	} catch {
		// schema_versions doesn't exist yet — fresh install
	}

	// Fresh install: apply full v3 schema
	db.exec(SCHEMA_SQL);
	db.exec(FTS_TRIGGERS_SQL);

	// Record version
	db.prepare(
		"INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)",
	).run(3, new Date().toISOString());
}

function migrateV1ToV2(db: Database.Database): void {
	const migration = db.transaction(() => {
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
        FOREIGN KEY(distillation_id) REFERENCES distillations(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_temporal_session ON temporal_messages(session_id, time_created);
      CREATE INDEX IF NOT EXISTS idx_temporal_undistilled ON temporal_messages(session_id) WHERE distillation_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_temporal_time ON temporal_messages(time_created DESC);

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

	migration();
}

function migrateV2ToV3(db: Database.Database): void {
	const migration = db.transaction(() => {
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

	migration();
}
