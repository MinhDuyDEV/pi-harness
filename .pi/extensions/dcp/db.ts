/**
 * DCP Extension — Database / State Management
 *
 * SQLite-based persistence for compression blocks, tool tracking, and session stats.
 * Reuses the memory extension's SQLite infrastructure pattern.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
	updated_at: number;
}

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

let _db: any = null;

function getDCPDataDir(): string {
	const dir = join(homedir(), ".config", "pi", "dcp");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function getDCPDB(): any {
	if (_db) return _db;

	try {
		// Dynamic import to match memory extension pattern
		const Database = require("better-sqlite3");
		const dbPath = join(getDCPDataDir(), "dcp.db");
		_db = new Database(dbPath);
		_db.pragma("journal_mode = WAL");
		_db.pragma("synchronous = NORMAL");
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
      updated_at              INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_session ON compression_blocks(session_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_active ON compression_blocks(session_id, active);
    CREATE INDEX IF NOT EXISTS idx_tools_session ON tool_calls(session_id);
  `);

	// v3.1.0 migration: add total_summary_tokens column if missing
	try {
		const cols = db
			.prepare("PRAGMA table_info(session_stats)")
			.all()
			.map((c: any) => c.name);
		if (!cols.includes("total_summary_tokens")) {
			db.exec(
				"ALTER TABLE session_stats ADD COLUMN total_summary_tokens INTEGER NOT NULL DEFAULT 0",
			);
		}
	} catch {
		// best-effort migration
	}
}

// ---------------------------------------------------------------------------
// Compression blocks
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

	const result = stmt.run(
		sessionId,
		blockId,
		topic,
		startId,
		endId,
		summary,
		compressedTokens,
		now,
	);
	return result.lastInsertRowid as number;
}

export function getActiveBlocks(sessionId: string): CompressionBlock[] {
	const db = getDCPDB();
	return db
		.prepare(
			"SELECT * FROM compression_blocks WHERE session_id = ? AND active = 1 ORDER BY block_id",
		)
		.all(sessionId);
}

export function getAllBlocks(sessionId: string): CompressionBlock[] {
	const db = getDCPDB();
	return db
		.prepare(
			"SELECT * FROM compression_blocks WHERE session_id = ? ORDER BY block_id",
		)
		.all(sessionId);
}

export function deactivateBlock(
	sessionId: string,
	blockId: number,
): boolean {
	const db = getDCPDB();
	const result = db
		.prepare(
			"UPDATE compression_blocks SET active = 0, deactivated_at = ? WHERE session_id = ? AND block_id = ?",
		)
		.run(Date.now(), sessionId, blockId);
	return result.changes > 0;
}

export function getNextBlockId(sessionId: string): number {
	const db = getDCPDB();
	const row = db
		.prepare(
			"SELECT MAX(block_id) as max_id FROM compression_blocks WHERE session_id = ?",
		)
		.get(sessionId);
	return (row?.max_id ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Session stats
// ---------------------------------------------------------------------------

export function getSessionStats(sessionId: string): SessionStats | null {
	const db = getDCPDB();
	return (
		db
			.prepare("SELECT * FROM session_stats WHERE session_id = ?")
			.get(sessionId) ?? null
	);
}

export function updateSessionStats(
	sessionId: string,
	updates: Partial<
		Pick<
			SessionStats,
			| "total_compressions"
			| "total_compressed_tokens"
			| "total_pruned_tokens"
			| "total_summary_tokens"
			| "current_turn"
		>
	>,
): void {
	const db = getDCPDB();
	const existing = getSessionStats(sessionId);
	const now = Date.now();

	if (!existing) {
		db.prepare(
			`INSERT INTO session_stats (session_id, total_compressions, total_compressed_tokens, total_pruned_tokens, total_summary_tokens, current_turn, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			sessionId,
			updates.total_compressions ?? 0,
			updates.total_compressed_tokens ?? 0,
			updates.total_pruned_tokens ?? 0,
			updates.total_summary_tokens ?? 0,
			updates.current_turn ?? 0,
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
        updated_at = ?
       WHERE session_id = ?`,
		).run(
			updates.total_compressions ?? existing.total_compressions,
			updates.total_compressed_tokens ?? existing.total_compressed_tokens,
			updates.total_pruned_tokens ?? existing.total_pruned_tokens,
			updates.total_summary_tokens ?? existing.total_summary_tokens,
			updates.current_turn ?? existing.current_turn,
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
} {
	const db = getDCPDB();
	const row = db
		.prepare(
			`SELECT
        COUNT(*) as totalSessions,
        COALESCE(SUM(total_compressions), 0) as totalCompressions,
        COALESCE(SUM(total_compressed_tokens), 0) as totalCompressedTokens,
        COALESCE(SUM(total_pruned_tokens), 0) as totalPrunedTokens,
        COALESCE(SUM(total_summary_tokens), 0) as totalSummaryTokens
       FROM session_stats`,
		)
		.get();
	return row;
}

// ---------------------------------------------------------------------------
// Tool call tracking
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

export function getToolCalls(sessionId: string): ToolCallRecord[] {
	const db = getDCPDB();
	return db
		.prepare(
			"SELECT * FROM tool_calls WHERE session_id = ? ORDER BY created_at",
		)
		.all(sessionId);
}

// ---------------------------------------------------------------------------
// Tool call dedup analysis
// ---------------------------------------------------------------------------

export interface DedupEntry {
	tool_name: string;
	parameters_hash: string;
	calls: number;
}

export function getToolCallDedupAnalysis(
	sessionId?: string,
): { duplicates: DedupEntry[]; totalCalls: number; uniqueCalls: number } {
	const db = getDCPDB();

	const whereClause = sessionId ? "WHERE session_id = ?" : "";
	const params = sessionId ? [sessionId] : [];

	const totalRow = db
		.prepare(`SELECT COUNT(*) as cnt FROM tool_calls ${whereClause}`)
		.get(...params);
	const totalCalls = totalRow?.cnt ?? 0;

	const uniqueRow = db
		.prepare(
			`SELECT COUNT(*) as cnt FROM (SELECT DISTINCT tool_name, parameters_hash FROM tool_calls ${whereClause})`,
		)
		.get(...params);
	const uniqueCalls = uniqueRow?.cnt ?? 0;

	const duplicates: DedupEntry[] = db
		.prepare(
			`SELECT tool_name, parameters_hash, COUNT(*) as calls
       FROM tool_calls ${whereClause}
       GROUP BY tool_name, parameters_hash
       HAVING calls > 1
       ORDER BY calls DESC
       LIMIT 15`,
		)
		.all(...params);

	return { duplicates, totalCalls, uniqueCalls };
}

export function getToolCallFrequency(
	sessionId?: string,
): { tool_name: string; calls: number }[] {
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
		.all(...params);
}

// ---------------------------------------------------------------------------
// Post-compact state reset
// ---------------------------------------------------------------------------

/**
 * Reset session state after a native /compact event.
 * Clears stale tool call cache and resets summary token counter,
 * since compacted messages no longer exist in the conversation.
 */
export function resetSessionState(sessionId: string): void {
	const db = getDCPDB();

	// Clear tool call cache — compacted messages invalidate dedup signatures
	db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);

	// Deactivate all compression blocks — their ranges no longer exist
	db.prepare(
		"UPDATE compression_blocks SET active = 0, deactivated_at = ? WHERE session_id = ? AND active = 1",
	).run(Date.now(), sessionId);

	// Reset session stats (keep compressions count for historical tracking)
	const existing = getSessionStats(sessionId);
	if (existing) {
		db.prepare(
			`UPDATE session_stats SET
        total_pruned_tokens = 0,
        total_summary_tokens = 0,
        current_turn = 0,
        updated_at = ?
       WHERE session_id = ?`,
		).run(Date.now(), sessionId);
	}
}

// ---------------------------------------------------------------------------
// Summary token helpers
// ---------------------------------------------------------------------------

/**
 * Get total summary tokens for a session (for summaryBuffer checks).
 */
export function getSummaryTokens(sessionId: string): number {
	const stats = getSessionStats(sessionId);
	return stats?.total_summary_tokens ?? 0;
}
