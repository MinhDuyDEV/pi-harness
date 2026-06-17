/**
 * Memory SQLite database.
 *
 * After ADR-001 cleanup + bug fix: schema matches what the user actually has
 * (`created_at_epoch`, not `time_created`). All dead `temporal_messages` /
 * `distillations` / `distillations_fts` schema removed. `allowExtension: false`
 * (no vec/TQ extensions).
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, verifySchemaVersion } from "./migrations.js";

// ---------------------------------------------------------------------------
// Schema SQL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('decision','bugfix','pattern','feature','discovery','learning','warning')) DEFAULT 'pattern',
    title TEXT NOT NULL,
    subtitle TEXT,
    facts TEXT,
    narrative TEXT,
    concepts TEXT NOT NULL DEFAULT '[]',
    files_read TEXT NOT NULL DEFAULT '[]',
    files_modified TEXT NOT NULL DEFAULT '[]',
    confidence TEXT NOT NULL DEFAULT 'high' CHECK(confidence IN ('low','medium','high')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','curator','imported')),
    bead_id TEXT,
    supersedes INTEGER,
    superseded_by INTEGER,
    helpful_count INTEGER NOT NULL DEFAULT 0,
    harmful_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at_epoch INTEGER NOT NULL,
    updated_at TEXT,
    updated_at_epoch INTEGER,
    maturity TEXT DEFAULT 'candidate',
    feedback_events TEXT,
    effective_score REAL DEFAULT 0,
    retrieval_count INTEGER DEFAULT 0,
    last_retrieved INTEGER,
    valid_until TEXT,
    markdown_file TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    title,
    subtitle,
    narrative,
    facts,
    concepts,
    content='observations',
    content_rowid='id',
    tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS feedback_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observation_id INTEGER NOT NULL,
    feedback_type TEXT NOT NULL CHECK(feedback_type IN ('helpful','harmful')),
    timestamp INTEGER NOT NULL,
    reason TEXT,
    session_id TEXT,
    FOREIGN KEY(observation_id) REFERENCES observations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feedback_obs ON feedback_events(observation_id);

CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);
CREATE INDEX IF NOT EXISTS idx_observations_bead_id ON observations(bead_id);
CREATE INDEX IF NOT EXISTS idx_observations_superseded ON observations(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source);
`;

const FTS_TRIGGERS_SQL = `
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
`;

// ---------------------------------------------------------------------------
// Transaction helper (node:sqlite has no db.transaction())
// ---------------------------------------------------------------------------

export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
	db.exec("BEGIN");
	try {
		const result = fn();
		db.exec("COMMIT");
		return result;
	} catch (err) {
		db.exec("ROLLBACK");
		throw err;
	}
}

// ---------------------------------------------------------------------------
// DB Singleton
// ---------------------------------------------------------------------------

let dbInstance: DatabaseSync | null = null;

export function getMemoryDataDir(): string {
	const dir = path.join(homedir(), ".config", "pi", "memory");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function getMemoryDB(): DatabaseSync {
	if (dbInstance) return dbInstance;

	const dbPath = process.env.PI_MEMORY_DB_PATH?.trim() || path.join(getMemoryDataDir(), "memory.db");
	dbInstance = new DatabaseSync(dbPath, { allowExtension: false });

	// Enable WAL mode + foreign keys
	dbInstance.exec("PRAGMA journal_mode = WAL");
	dbInstance.exec("PRAGMA foreign_keys = ON");

	// Always run base schema (idempotent via IF NOT EXISTS), then run migrations.
	// This is safe to call on every cold start.
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

function initializeSchema(db: DatabaseSync): void {
	// Base schema is idempotent (CREATE TABLE IF NOT EXISTS) — safe on every cold start.
	db.exec(SCHEMA_SQL);
	db.exec(FTS_TRIGGERS_SQL);
	// Migrations are also idempotent (each DROP wrapped in safeDrop try/catch).
	applyMigrations({ db });
	// Runtime smoke test: surface any silent migration failure (e.g., a future
	// migration that fails to record its version). Better to fail loudly on
	// cold start than to operate on a half-migrated DB.
	verifySchemaVersion({ db }, 10);
}
