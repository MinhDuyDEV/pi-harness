/**
 * DCP Extension — Database / State Management (v2)
 *
 * SQLite-based persistence for compression blocks, tool tracking, session stats,
 * message tags, deferred drop queue, facts, and raw transcripts.
 *
 * v2 adds: message_tags, drop_queue, facts, raw_transcripts tables.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressionBlock {
	id: number;
	session_id: string;
	block_id: number;
	active: boolean;
	topic: string;
	start_id: string;
	end_id: string;
	summary: string;
	compressed_tokens: number;
	created_at: number;
	deactivated_at: number | null;
}

export interface ToolCallRecord {
	id: number;
	session_id: string;
	call_id: string;
	tool_name: string;
	parameters_hash: string;
	status: "pending" | "running" | "completed" | "error";
	turn: number;
	token_count: number;
	created_at: number;
}

export interface SessionStats {
	session_id: string;
	total_compressions: number;
	total_compressed_tokens: number;
	total_pruned_tokens: number;
	total_summary_tokens: number;
	current_turn: number;
	total_auto_prunes: number;
	total_deferred_drops: number;
	total_facts_extracted: number;
	updated_at: number;
}

export interface Fact {
	id: number;
	session_id: string;
	category: string;
	content: string;
	seen_count: number;
	retrieval_count: number;
	promoted: boolean;
	promoted_at: number | null;
	created_at: number;
	updated_at: number;
}

export interface RawTranscript {
	id: number;
	session_id: string;
	block_id: number;
	raw_messages: string; // JSON serialized
	token_count: number;
	created_at: number;
}

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

let _db: DatabaseSync | null = null;

function getDCPDataDir(): string {
	const dir = join(homedir(), ".config", "pi", "dcp");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function getDCPDB(): DatabaseSync {
	if (_db) return _db;

	try {
		const dbPath = join(getDCPDataDir(), "dcp.db");
		_db = new DatabaseSync(dbPath);
		_db.exec("PRAGMA journal_mode = WAL");
		_db.exec("PRAGMA synchronous = NORMAL");
		initSchema(_db);
		return _db;
	} catch (err) {
		throw new Error(
			`Failed to initialize DCP database: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export function closeDCPDB(): void {
	if (_db) {
		try {
			_db.close();
		} catch {
			// best-effort
		}
		_db = null;
	}
}

function initSchema(db: any): void {
	db.exec(`
    -- v1 tables (preserved)
    CREATE TABLE IF NOT EXISTS compression_blocks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      block_id        INTEGER NOT NULL,
      active          INTEGER NOT NULL DEFAULT 1,
      topic           TEXT NOT NULL,
      start_id        TEXT NOT NULL,
      end_id          TEXT NOT NULL,
      summary         TEXT NOT NULL,
      compressed_tokens INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      deactivated_at  INTEGER,
      UNIQUE(session_id, block_id)
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      call_id         TEXT NOT NULL,
      tool_name       TEXT NOT NULL,
      parameters_hash TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'completed',
      turn            INTEGER NOT NULL DEFAULT 0,
      token_count     INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      UNIQUE(session_id, call_id)
    );

    CREATE TABLE IF NOT EXISTS session_stats (
      session_id              TEXT PRIMARY KEY,
      total_compressions      INTEGER NOT NULL DEFAULT 0,
      total_compressed_tokens INTEGER NOT NULL DEFAULT 0,
      total_pruned_tokens     INTEGER NOT NULL DEFAULT 0,
      total_summary_tokens    INTEGER NOT NULL DEFAULT 0,
      current_turn            INTEGER NOT NULL DEFAULT 0,
      total_auto_prunes       INTEGER NOT NULL DEFAULT 0,
      total_deferred_drops    INTEGER NOT NULL DEFAULT 0,
      total_facts_extracted   INTEGER NOT NULL DEFAULT 0,
      updated_at              INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      category        TEXT NOT NULL,
      content         TEXT NOT NULL,
      seen_count      INTEGER NOT NULL DEFAULT 1,
      retrieval_count INTEGER NOT NULL DEFAULT 0,
      promoted        INTEGER NOT NULL DEFAULT 0,
      promoted_at     INTEGER,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_transcripts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      block_id        INTEGER NOT NULL,
      raw_messages    TEXT NOT NULL,
      token_count     INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      UNIQUE(session_id, block_id)
    );

    -- Indexes (v1)
    CREATE INDEX IF NOT EXISTS idx_blocks_session ON compression_blocks(session_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_active ON compression_blocks(session_id, active);
    CREATE INDEX IF NOT EXISTS idx_tools_session ON tool_calls(session_id);

    -- Indexes (v2)
    CREATE INDEX IF NOT EXISTS idx_facts_session ON facts(session_id);
    CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(session_id, category);
    CREATE INDEX IF NOT EXISTS idx_transcripts_session ON raw_transcripts(session_id, block_id);
  `);

	// Migrations: add columns that may be missing from v1 databases
	migrateV1ToV2(db);
}

function migrateV1ToV2(db: any): void {
	try {
		const statsCols = db
			.prepare("PRAGMA table_info(session_stats)")
			.all()
			.map((c: any) => c.name);

		if (!statsCols.includes("total_summary_tokens")) {
			db.exec("ALTER TABLE session_stats ADD COLUMN total_summary_tokens INTEGER NOT NULL DEFAULT 0");
		}
	} catch {
		// best-effort migration
	}
}

// ---------------------------------------------------------------------------
// Compression blocks (v1 — preserved)
// ---------------------------------------------------------------------------

export function storeCompressionBlock(
	sessionId: string,
	blockId: number,
	topic: string,
	startId: string,
	endId: string,
	summary: string,
	compressedTokens: number,
): number {
	const db = getDCPDB();
	const now = Date.now();

	const stmt = db.prepare(`
    INSERT INTO compression_blocks (session_id, block_id, active, topic, start_id, end_id, summary, compressed_tokens, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, block_id) DO UPDATE SET
      active = 1,
      topic = excluded.topic,
      start_id = excluded.start_id,
      end_id = excluded.end_id,
      summary = excluded.summary,
      compressed_tokens = excluded.compressed_tokens,
      deactivated_at = NULL
  `);

	const result = stmt.run(sessionId, blockId, topic, startId, endId, summary, compressedTokens, now);
	return result.lastInsertRowid as number;
}

export function getActiveBlocks(sessionId: string): CompressionBlock[] {
	const db = getDCPDB();
	return db
		.prepare("SELECT * FROM compression_blocks WHERE session_id = ? AND active = 1 ORDER BY block_id")
		.all(sessionId) as unknown as CompressionBlock[];
}

export function getAllBlocks(sessionId: string): CompressionBlock[] {
	const db = getDCPDB();
	return db
		.prepare("SELECT * FROM compression_blocks WHERE session_id = ? ORDER BY block_id")
		.all(sessionId) as unknown as CompressionBlock[];
}

/** @internal Currently unused — available for future features */
export function deactivateBlock(sessionId: string, blockId: number): boolean {
	const db = getDCPDB();
	const result = db
		.prepare("UPDATE compression_blocks SET active = 0, deactivated_at = ? WHERE session_id = ? AND block_id = ?")
		.run(Date.now(), sessionId, blockId);
	return result.changes > 0;
}

export function getNextBlockId(sessionId: string): number {
	const db = getDCPDB();
	const row = db
		.prepare("SELECT MAX(block_id) as max_id FROM compression_blocks WHERE session_id = ?")
		.get(sessionId);
	return ((row?.max_id ?? 0) as number) + 1;
}

// ---------------------------------------------------------------------------
// Session stats (v2 — extended)
// ---------------------------------------------------------------------------

export function getSessionStats(sessionId: string): SessionStats | null {
	const db = getDCPDB();
	return (db.prepare("SELECT * FROM session_stats WHERE session_id = ?").get(sessionId) ?? null) as SessionStats | null;
}

export function updateSessionStats(
	sessionId: string,
	updates: Partial<Omit<SessionStats, "session_id" | "updated_at">>,
): void {
	const db = getDCPDB();
	const existing = getSessionStats(sessionId);
	const now = Date.now();

	if (!existing) {
		db.prepare(
			`INSERT INTO session_stats (session_id, total_compressions, total_compressed_tokens, total_pruned_tokens, total_summary_tokens, current_turn, total_auto_prunes, total_deferred_drops, total_facts_extracted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			sessionId,
			updates.total_compressions ?? 0,
			updates.total_compressed_tokens ?? 0,
			updates.total_pruned_tokens ?? 0,
			updates.total_summary_tokens ?? 0,
			updates.current_turn ?? 0,
			updates.total_auto_prunes ?? 0,
			updates.total_deferred_drops ?? 0,
			updates.total_facts_extracted ?? 0,
			now,
		);
	} else {
		db.prepare(
			`UPDATE session_stats SET
        total_compressions = ?,
        total_compressed_tokens = ?,
        total_pruned_tokens = ?,
        total_summary_tokens = ?,
        current_turn = ?,
        total_auto_prunes = ?,
        total_deferred_drops = ?,
        total_facts_extracted = ?,
        updated_at = ?
       WHERE session_id = ?`,
		).run(
			updates.total_compressions ?? existing.total_compressions,
			updates.total_compressed_tokens ?? existing.total_compressed_tokens,
			updates.total_pruned_tokens ?? existing.total_pruned_tokens,
			updates.total_summary_tokens ?? existing.total_summary_tokens,
			updates.current_turn ?? existing.current_turn,
			updates.total_auto_prunes ?? existing.total_auto_prunes,
			updates.total_deferred_drops ?? existing.total_deferred_drops,
			updates.total_facts_extracted ?? existing.total_facts_extracted,
			now,
			sessionId,
		);
	}
}

export function getGlobalStats(): {
	totalSessions: number;
	totalCompressions: number;
	totalCompressedTokens: number;
	totalPrunedTokens: number;
	totalSummaryTokens: number;
	totalAutoPrunes: number;
	totalDeferredDrops: number;
	totalFactsExtracted: number;
} {
	const db = getDCPDB();
	const row = db
		.prepare(
			`SELECT
        COUNT(*) as totalSessions,
        COALESCE(SUM(total_compressions), 0) as totalCompressions,
        COALESCE(SUM(total_compressed_tokens), 0) as totalCompressedTokens,
        COALESCE(SUM(total_pruned_tokens), 0) as totalPrunedTokens,
        COALESCE(SUM(total_summary_tokens), 0) as totalSummaryTokens,
        COALESCE(SUM(total_auto_prunes), 0) as totalAutoPrunes,
        COALESCE(SUM(total_deferred_drops), 0) as totalDeferredDrops,
        COALESCE(SUM(total_facts_extracted), 0) as totalFactsExtracted
       FROM session_stats`,
		)
		.get();
	return row as {
		totalSessions: number;
		totalCompressions: number;
		totalCompressedTokens: number;
		totalPrunedTokens: number;
		totalSummaryTokens: number;
		totalAutoPrunes: number;
		totalDeferredDrops: number;
		totalFactsExtracted: number;
	};
}

// ---------------------------------------------------------------------------
// Tool call tracking (v1 — preserved)
// ---------------------------------------------------------------------------

export function recordToolCall(
	sessionId: string,
	callId: string,
	toolName: string,
	parametersHash: string,
	status: string,
	turn: number,
	tokenCount: number,
): void {
	const db = getDCPDB();
	db.prepare(
		`INSERT INTO tool_calls (session_id, call_id, tool_name, parameters_hash, status, turn, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, call_id) DO UPDATE SET
       status = excluded.status,
       turn = excluded.turn,
       token_count = excluded.token_count`,
	).run(sessionId, callId, toolName, parametersHash, status, turn, tokenCount, Date.now());
}

/** @internal Currently unused — available for future features */
export function getToolCalls(sessionId: string): ToolCallRecord[] {
	const db = getDCPDB();
	return db.prepare("SELECT * FROM tool_calls WHERE session_id = ? ORDER BY created_at").all(sessionId) as unknown as ToolCallRecord[];
}

// ---------------------------------------------------------------------------
// Tool call dedup analysis (v1 — preserved)
// ---------------------------------------------------------------------------

/** @internal Currently unused — available for future features */
export function getToolCallFrequency(sessionId?: string): { tool_name: string; calls: number }[] {
	const db = getDCPDB();
	const whereClause = sessionId ? "WHERE session_id = ?" : "";
	const params = sessionId ? [sessionId] : [];

	return db
		.prepare(
			`SELECT tool_name, COUNT(*) as calls
       FROM tool_calls ${whereClause}
       GROUP BY tool_name
       ORDER BY calls DESC
       LIMIT 20`,
		)
		.all(...params) as { tool_name: string; calls: number }[];
}

// ---------------------------------------------------------------------------
// Message tags (v2)
// ---------------------------------------------------------------------------


/** @internal Currently unused — available for future features */



export function storeFact(sessionId: string, category: string, content: string): number {
	const db = getDCPDB();
	const now = Date.now();

	// Check if similar fact already exists (by content prefix match)
	const existing = db
		.prepare("SELECT id, seen_count FROM facts WHERE session_id = ? AND category = ? AND content = ?")
		.get(sessionId, category, content) as { id: number; seen_count: number } | undefined;

	if (existing) {
		db.prepare("UPDATE facts SET seen_count = seen_count + 1, updated_at = ? WHERE id = ?").run(now, existing.id);
		return existing.id;
	}

	const result = db
		.prepare("INSERT INTO facts (session_id, category, content, seen_count, retrieval_count, promoted, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0, ?, ?)")
		.run(sessionId, category, content, now, now);
	return result.lastInsertRowid as number;
}

export function incrementFactRetrieval(factId: number): void {
	const db = getDCPDB();
	db.prepare("UPDATE facts SET retrieval_count = retrieval_count + 1, updated_at = ? WHERE id = ?").run(Date.now(), factId);
}

export function getFactsBySession(sessionId: string): Fact[] {
	const db = getDCPDB();
	return db.prepare("SELECT * FROM facts WHERE session_id = ? ORDER BY seen_count DESC, created_at DESC").all(sessionId) as unknown as Fact[];
}

export function getFactsByCategory(sessionId: string, category: string): Fact[] {
	const db = getDCPDB();
	return db.prepare("SELECT * FROM facts WHERE session_id = ? AND category = ? ORDER BY seen_count DESC").all(sessionId, category) as unknown as Fact[];
}

export function getPromotableFacts(sessionId: string, threshold: number): Fact[] {
	const db = getDCPDB();
	return db
		.prepare("SELECT * FROM facts WHERE session_id = ? AND promoted = 0 AND retrieval_count >= ?")
		.all(sessionId, threshold) as unknown as Fact[];
}

export function markFactPromoted(factId: number): void {
	const db = getDCPDB();
	db.prepare("UPDATE facts SET promoted = 1, promoted_at = ? WHERE id = ?").run(Date.now(), factId);
}

// ---------------------------------------------------------------------------
// Raw transcripts (v2) — for ctx_expand reversible compression
// ---------------------------------------------------------------------------

/**
 * Get the next available block_id for raw transcripts in this session.
 * Uses the MAX(block_id) from raw_transcripts table — independent of DCP compression block IDs.
 */
export function getNextTranscriptBlockId(sessionId: string): number {
	const db = getDCPDB();
	const row = db
		.prepare("SELECT MAX(block_id) as max_id FROM raw_transcripts WHERE session_id = ?")
		.get(sessionId);
	return ((row?.max_id ?? 0) as number) + 1;
}

export function storeRawTranscript(sessionId: string, blockId: number, rawMessages: string, tokenCount: number): number {
	const db = getDCPDB();
	const result = db
		.prepare(
			`INSERT INTO raw_transcripts (session_id, block_id, raw_messages, token_count, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, block_id) DO UPDATE SET
         raw_messages = excluded.raw_messages,
         token_count = excluded.token_count`,
		)
		.run(sessionId, blockId, rawMessages, tokenCount, Date.now());
	return result.lastInsertRowid as number;
}

export function getRawTranscript(sessionId: string, blockId: number): RawTranscript | null {
	const db = getDCPDB();
	return (db.prepare("SELECT * FROM raw_transcripts WHERE session_id = ? AND block_id = ?").get(sessionId, blockId) ?? null) as RawTranscript | null;
}

export function getAllRawTranscripts(sessionId: string): RawTranscript[] {
	const db = getDCPDB();
	return db.prepare("SELECT * FROM raw_transcripts WHERE session_id = ? ORDER BY block_id").all(sessionId) as unknown as RawTranscript[];
}

// ---------------------------------------------------------------------------
// Post-compact state reset (v2 — extended)
// ---------------------------------------------------------------------------

export function resetSessionState(sessionId: string, deactivateBlocks: boolean = true): void {
	const db = getDCPDB();

	// Clear tool call cache — compacted messages invalidate dedup signatures
	db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);

	if (deactivateBlocks) {
		// Deactivate all compression blocks — their summaries are now encoded in the
		// compaction entry so they no longer need to be re-injected separately.
		// ONLY do this when DCP provided the enriched compaction. Pi-native and
		// other extension compactions are not guaranteed to include DCP blocks.
		db.prepare(
			"UPDATE compression_blocks SET active = 0, deactivated_at = ? WHERE session_id = ? AND active = 1",
		).run(Date.now(), sessionId);
	}



	// Reset per-window session stats
	const existing = getSessionStats(sessionId);
	if (existing) {
		db.prepare(
			`UPDATE session_stats SET
        total_summary_tokens = ?,
        current_turn = 0,
        updated_at = ?
       WHERE session_id = ?`,
		).run(
			// Keep summary token count if blocks remain active (Pi-native compaction);
			// reset to 0 when blocks are deactivated (DCP compaction).
			deactivateBlocks ? 0 : existing.total_summary_tokens,
			Date.now(),
			sessionId,
		);
	}
}

// ---------------------------------------------------------------------------
// Summary token helpers
// ---------------------------------------------------------------------------

export function getSummaryTokens(sessionId: string): number {
	const stats = getSessionStats(sessionId);
	return stats?.total_summary_tokens ?? 0;
}
