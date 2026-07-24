import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

const requireSqlite = createRequire(import.meta.url);
type DatabaseSyncCtor = new (path: string) => DatabaseSync;
let dbCtor: DatabaseSyncCtor | null | undefined;

/** Lazily load node:sqlite so the extension never crashes at load on a flag regression,
 * and suppress its ExperimentalWarning on first load. */
function getDbCtor(): DatabaseSyncCtor | null {
  if (dbCtor !== undefined) return dbCtor;
  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string, typeOrOptions?: string | { type?: string }) => {
    const type = typeof typeOrOptions === "string" ? typeOrOptions : typeOrOptions?.type;
    if (type === "ExperimentalWarning") return;
    return (originalEmitWarning as (w: string, t?: string | { type?: string }) => void)(warning, typeOrOptions);
  }) as typeof process.emitWarning;
  try {
    dbCtor = requireSqlite("node:sqlite").DatabaseSync as DatabaseSyncCtor;
  } catch {
    dbCtor = null;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
  return dbCtor;
}

export interface ModelBreakdown {
  model: string;
  provider: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_cost: number;
}

export interface GlobalUsage {
  totalSessions: number;
  totalInput: number;
  totalOutput: number;
  totalCache: number;
  totalThinking: number;
  totalCost: number;
  totalTurns: number;
}

let database: DatabaseSync | null = null;

function getDataDir(): string {
  const directory = join(homedir(), ".config", "pi", "usage");
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  return directory;
}

export function getUsageDatabase(): DatabaseSync {
  if (database) return database;
  const Ctor = getDbCtor();
  if (!Ctor) throw new Error("node:sqlite is unavailable; usage tracking disabled");
  database = new Ctor(join(getDataDir(), "usage.db"));
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'unknown',
      provider TEXT NOT NULL DEFAULT 'unknown',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      thinking_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0.0,
      turn INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_summary (
      session_id TEXT PRIMARY KEY,
      model TEXT NOT NULL DEFAULT 'unknown',
      provider TEXT NOT NULL DEFAULT 'unknown',
      total_input INTEGER NOT NULL DEFAULT 0,
      total_output INTEGER NOT NULL DEFAULT 0,
      total_cache INTEGER NOT NULL DEFAULT 0,
      total_thinking INTEGER NOT NULL DEFAULT 0,
      total_cost_usd REAL NOT NULL DEFAULT 0.0,
      total_turns INTEGER NOT NULL DEFAULT 0,
      first_seen INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_events(model);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
  `);
  return database;
}

export function closeUsageDatabase(): void {
  if (!database) return;
  try {
    database.close();
  } catch {
    return;
  } finally {
    database = null;
  }
}

export function recordUsage(
  sessionId: string,
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  cacheRead: number,
  cacheWrite: number,
  thinkingTokens: number,
  costUsd: number,
  turn: number,
): void {
  const db = getUsageDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO usage_events
    (session_id, model, provider, input_tokens, output_tokens, cache_read, cache_write, thinking_tokens, cost_usd, turn, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, model, provider, inputTokens, outputTokens, cacheRead, cacheWrite, thinkingTokens, costUsd, turn, now);
  db.prepare(`INSERT INTO session_summary
    (session_id, model, provider, total_input, total_output, total_cache, total_thinking, total_cost_usd, total_turns, first_seen, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      model = excluded.model,
      provider = excluded.provider,
      total_input = total_input + excluded.total_input,
      total_output = total_output + excluded.total_output,
      total_cache = total_cache + excluded.total_cache,
      total_thinking = total_thinking + excluded.total_thinking,
      total_cost_usd = total_cost_usd + excluded.total_cost_usd,
      total_turns = total_turns + 1,
      updated_at = excluded.updated_at`)
    .run(sessionId, model, provider, inputTokens, outputTokens, cacheRead + cacheWrite, thinkingTokens, costUsd, now, now);
}

export function getGlobalUsage(): GlobalUsage {
  const row = getUsageDatabase().prepare(`SELECT
    COUNT(*) as totalSessions,
    COALESCE(SUM(total_input), 0) as totalInput,
    COALESCE(SUM(total_output), 0) as totalOutput,
    COALESCE(SUM(total_cache), 0) as totalCache,
    COALESCE(SUM(total_thinking), 0) as totalThinking,
    COALESCE(SUM(total_cost_usd), 0.0) as totalCost,
    COALESCE(SUM(total_turns), 0) as totalTurns
    FROM session_summary`).get();
  const value = recordValue(row);
  return {
    totalSessions: Number(value.totalSessions ?? 0),
    totalInput: Number(value.totalInput ?? 0),
    totalOutput: Number(value.totalOutput ?? 0),
    totalCache: Number(value.totalCache ?? 0),
    totalThinking: Number(value.totalThinking ?? 0),
    totalCost: Number(value.totalCost ?? 0),
    totalTurns: Number(value.totalTurns ?? 0),
    };
}

function recordValue(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") throw new TypeError("invalid usage row");
  return Object.fromEntries(Object.entries(row));
}


export function getModelBreakdown(days?: number): ModelBreakdown[] {
  const whereClause = days ? "WHERE created_at > ?" : "";
  const params = days ? [Date.now() - days * 86_400_000] : [];
  return getUsageDatabase().prepare(`SELECT
    model, provider, COUNT(*) as calls, SUM(input_tokens) as input_tokens,
    SUM(output_tokens) as output_tokens, SUM(cost_usd) as total_cost
    FROM usage_events ${whereClause}
    GROUP BY model, provider
    ORDER BY SUM(input_tokens + output_tokens) DESC
    LIMIT 20`).all(...params).map(toModelBreakdown);
}

export function getTodayUsage(): { input: number; output: number; cost: number; turns: number } {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const row = getUsageDatabase().prepare(`SELECT
    COALESCE(SUM(input_tokens), 0) as input,
    COALESCE(SUM(output_tokens), 0) as output,
    COALESCE(SUM(cost_usd), 0.0) as cost,
    COUNT(*) as turns
    FROM usage_events WHERE created_at >= ?`)
    .get(todayStart.getTime());
  const value = recordValue(row);
  return {
    input: Number(value.input ?? 0),
    output: Number(value.output ?? 0),
    cost: Number(value.cost ?? 0),
    turns: Number(value.turns ?? 0),
  };
}

function toModelBreakdown(row: unknown): ModelBreakdown {
  const value = recordValue(row);
  return {
    model: String(value.model ?? ""),
    provider: String(value.provider ?? ""),
    calls: Number(value.calls ?? 0),
    input_tokens: Number(value.input_tokens ?? 0),
    output_tokens: Number(value.output_tokens ?? 0),
    total_cost: Number(value.total_cost ?? 0),
  };
}
