/**
 * Usage Tracker Extension
 *
 * Tracks token usage, cost estimation, and session statistics.
 * Inspired by oh-pi's usage-tracker pattern, adapted for pikit's
 * SQLite infrastructure (shared with DCP/memory extensions).
 *
 * WHAT THIS EXTENSION DOES:
 *   - Tracks input/output tokens per LLM call (from turn_end events)
 *   - Aggregates per session, per model, per provider
 *   - Registers /usage command for quick stats
 *   - Persists to SQLite (~/.config/pi/usage/usage.db)
 *
 * DEPENDENCIES:
 *   node:sqlite (built into Node.js v22.5+, no native compilation)
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

let _db: DatabaseSync | null = null;

function getDataDir(): string {
	const dir = join(homedir(), ".config", "pi", "usage");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

function getDB(): DatabaseSync {
	if (_db) return _db;

	const dbPath = join(getDataDir(), "usage.db");
	_db = new DatabaseSync(dbPath);
	_db.exec("PRAGMA journal_mode = WAL");
	_db.exec("PRAGMA synchronous = NORMAL");

	_db.exec(`
		CREATE TABLE IF NOT EXISTS usage_events (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id      TEXT NOT NULL,
			model           TEXT NOT NULL DEFAULT 'unknown',
			provider        TEXT NOT NULL DEFAULT 'unknown',
			input_tokens    INTEGER NOT NULL DEFAULT 0,
			output_tokens   INTEGER NOT NULL DEFAULT 0,
			cache_read      INTEGER NOT NULL DEFAULT 0,
			cache_write     INTEGER NOT NULL DEFAULT 0,
			thinking_tokens INTEGER NOT NULL DEFAULT 0,
			cost_usd        REAL NOT NULL DEFAULT 0.0,
			turn            INTEGER NOT NULL DEFAULT 0,
			created_at      INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS session_summary (
			session_id      TEXT PRIMARY KEY,
			model           TEXT NOT NULL DEFAULT 'unknown',
			provider        TEXT NOT NULL DEFAULT 'unknown',
			total_input     INTEGER NOT NULL DEFAULT 0,
			total_output    INTEGER NOT NULL DEFAULT 0,
			total_cache     INTEGER NOT NULL DEFAULT 0,
			total_thinking  INTEGER NOT NULL DEFAULT 0,
			total_cost_usd  REAL NOT NULL DEFAULT 0.0,
			total_turns     INTEGER NOT NULL DEFAULT 0,
			first_seen      INTEGER NOT NULL,
			updated_at      INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id);
		CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_events(model);
		CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
	`);

	return _db;
}

function closeDB(): void {
	if (_db) {
		try {
			_db.close();
		} catch {
			// best-effort
		}
		_db = null;
	}
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

function recordUsage(
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
	const db = getDB();
	const now = Date.now();

	db.prepare(
		`INSERT INTO usage_events
		 (session_id, model, provider, input_tokens, output_tokens, cache_read, cache_write, thinking_tokens, cost_usd, turn, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(sessionId, model, provider, inputTokens, outputTokens, cacheRead, cacheWrite, thinkingTokens, costUsd, turn, now);

	// Upsert session summary
	db.prepare(
		`INSERT INTO session_summary
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
			updated_at = excluded.updated_at`,
	).run(sessionId, model, provider, inputTokens, outputTokens, cacheRead + cacheWrite, thinkingTokens, costUsd, now, now);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface ModelBreakdown {
	model: string;
	provider: string;
	calls: number;
	input_tokens: number;
	output_tokens: number;
	total_cost: number;
}

function getGlobalUsage(): {
	totalSessions: number;
	totalInput: number;
	totalOutput: number;
	totalCache: number;
	totalThinking: number;
	totalCost: number;
	totalTurns: number;
} {
	const db = getDB();
	const row = db.prepare(`
		SELECT
			COUNT(*) as totalSessions,
			COALESCE(SUM(total_input), 0) as totalInput,
			COALESCE(SUM(total_output), 0) as totalOutput,
			COALESCE(SUM(total_cache), 0) as totalCache,
			COALESCE(SUM(total_thinking), 0) as totalThinking,
			COALESCE(SUM(total_cost_usd), 0.0) as totalCost,
			COALESCE(SUM(total_turns), 0) as totalTurns
		FROM session_summary
	`).get() as {
		totalSessions: number;
		totalInput: number;
		totalOutput: number;
		totalCache: number;
		totalThinking: number;
		totalCost: number;
		totalTurns: number;
	};
	return row;
}

function getModelBreakdown(days?: number): ModelBreakdown[] {
	const db = getDB();
	const whereClause = days ? "WHERE created_at > ?" : "";
	const params = days ? [Date.now() - days * 86400000] : [];

	return db.prepare(`
		SELECT
			model,
			provider,
			COUNT(*) as calls,
			SUM(input_tokens) as input_tokens,
			SUM(output_tokens) as output_tokens,
			SUM(cost_usd) as total_cost
		FROM usage_events
		${whereClause}
		GROUP BY model, provider
		ORDER BY SUM(input_tokens + output_tokens) DESC
		LIMIT 20
	`).all(...params) as unknown as ModelBreakdown[];
}

function getTodayUsage(): { input: number; output: number; cost: number; turns: number } {
	const db = getDB();
	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);

	const row = db.prepare(`
		SELECT
			COALESCE(SUM(input_tokens), 0) as input,
			COALESCE(SUM(output_tokens), 0) as output,
			COALESCE(SUM(cost_usd), 0.0) as cost,
			COUNT(*) as turns
		FROM usage_events
		WHERE created_at >= ?
	`).get(todayStart.getTime()) as { input: number; output: number; cost: number; turns: number };
	return row;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

function formatCost(usd: number): string {
	if (usd === 0) return "free";
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(2)}`;
}

// Extract provider from model id (e.g., "github-copilot/claude-sonnet-4" → "github-copilot")
function extractProvider(modelId: string): string {
	const slash = modelId.indexOf("/");
	return slash > 0 ? modelId.slice(0, slash) : "unknown";
}

// Extract model name (e.g., "github-copilot/claude-sonnet-4" → "claude-sonnet-4")
function extractModel(modelId: string): string {
	const slash = modelId.indexOf("/");
	return slash > 0 ? modelId.slice(slash + 1) : modelId;
}

interface NormalizedUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	thinking: number;
	cost: number;
}

function toNumber(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}

function normalizeUsage(raw: any): NormalizedUsage | null {
	if (!raw || typeof raw !== "object") return null;

	const input = toNumber(raw.input ?? raw.input_tokens ?? raw.prompt_tokens);
	const output = toNumber(raw.output ?? raw.output_tokens ?? raw.completion_tokens);
	const cacheRead = toNumber(raw.cacheRead ?? raw.cache_read_input_tokens ?? raw.cache_read_tokens ?? raw.cache_read);
	const cacheWrite = toNumber(raw.cacheWrite ?? raw.cache_creation_input_tokens ?? raw.cache_write_tokens ?? raw.cache_write);
	const thinking = toNumber(raw.thinking ?? raw.thinking_tokens ?? raw.reasoning);
	const cost = toNumber(raw.cost?.total ?? raw.cost_total ?? raw.cost);

	// Ignore empty usage payloads
	if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0 && thinking === 0) {
		return null;
	}

	return { input, output, cacheRead, cacheWrite, thinking, cost };
}

function estimateTokens(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return Math.max(1, Math.ceil(trimmed.length / 4));
}

function extractAssistantText(message: any): string {
	if (!message) return "";
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.filter((c: any) => c?.type === "text" && typeof c?.text === "string")
		.map((c: any) => c.text)
		.join("\n");
}

function fallbackUsageFromMessage(message: any, lastInputEstimate: number): NormalizedUsage | null {
	const output = estimateTokens(extractAssistantText(message));
	const input = Math.max(0, lastInputEstimate);
	if (input === 0 && output === 0) return null;
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		thinking: 0,
		cost: 0,
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export default function usageTrackerExtension(pi: ExtensionAPI): void {
	try {
		getDB();
	} catch (err) {
		console.error("[usage-tracker] Failed to initialize database:", err);
		return;
	}

	let currentTurn = 0;
	let currentSessionId = "default";
	let lastRecordedTurn = -1;
	let lastInputEstimate = 0;

	// Track turns, session id, and estimate input tokens for fallback accounting
	pi.on("input", (event: any) => {
		currentTurn++;
		if (event?.sessionId) currentSessionId = event.sessionId;
		const text = typeof event === "string" ? event : (event?.text ?? event?.content ?? "");
		if (typeof text === "string") {
			lastInputEstimate = estimateTokens(text);
		}
	});

	// Capture usage from turn_end events (primary source)
	pi.on("turn_end", (event: any) => {
		try {
			const explicitUsage = normalizeUsage(
				event?.message?.usage ?? event?.usage ?? event?.response?.usage ?? event?.result?.usage,
			);
			const usage =
				explicitUsage ??
				(lastRecordedTurn === currentTurn
					? null
					: fallbackUsageFromMessage(event?.message, lastInputEstimate));
			if (!usage) return;

			const modelId =
				event?.message?.model ?? event?.model?.id ?? event?.modelId ?? event?.model ?? "unknown";
			const provider = event?.message?.provider ?? extractProvider(modelId);
			const sessionId = event?.sessionId ?? currentSessionId;

			recordUsage(
				sessionId,
				extractModel(modelId),
				provider,
				usage.input,
				usage.output,
				usage.cacheRead,
				usage.cacheWrite,
				usage.thinking,
				usage.cost,
				currentTurn,
			);
			lastRecordedTurn = currentTurn;
		} catch {
			// best-effort
		}
	});

	// Fallback: capture from message_end for assistant messages if turn_end didn't fire
	pi.on("message_end", (event: any) => {
		try {
			if (event?.message?.role !== "assistant") return;
			if (lastRecordedTurn === currentTurn) return;

			const usage =
				normalizeUsage(event?.message?.usage ?? event?.usage) ??
				fallbackUsageFromMessage(event?.message, lastInputEstimate);
			if (!usage) return;

			const modelId =
				event?.message?.model ?? event?.model?.id ?? event?.modelId ?? event?.model ?? "unknown";
			const provider = event?.message?.provider ?? extractProvider(modelId);
			const sessionId = event?.sessionId ?? currentSessionId;

			recordUsage(
				sessionId,
				extractModel(modelId),
				provider,
				usage.input,
				usage.output,
				usage.cacheRead,
				usage.cacheWrite,
				usage.thinking,
				usage.cost,
				currentTurn,
			);
			lastRecordedTurn = currentTurn;
		} catch {
			// best-effort
		}
	});

	// /usage command
	pi.registerCommand("usage", {
		description: "Show token usage and cost statistics",
		async handler(_args: any, ctx: any) {
			try {
				const today = getTodayUsage();
				const global = getGlobalUsage();
				const models = getModelBreakdown(7);

				const lines = [
					"## Usage Statistics\n",
					"### Today",
					`  Input: ${formatTokens(today.input)} | Output: ${formatTokens(today.output)} | Cost: ${formatCost(today.cost)} | Turns: ${today.turns}`,
					"",
					"### All Time",
					`  Sessions: ${global.totalSessions}`,
					`  Input: ${formatTokens(global.totalInput)} | Output: ${formatTokens(global.totalOutput)}`,
					`  Cache: ${formatTokens(global.totalCache)} | Thinking: ${formatTokens(global.totalThinking)}`,
					`  Total cost: ${formatCost(global.totalCost)} | Total turns: ${global.totalTurns}`,
				];

				if (models.length > 0) {
					lines.push("", "### Models (last 7 days)");
					for (const m of models) {
						const total = m.input_tokens + m.output_tokens;
						lines.push(
							`  ${m.provider}/${m.model}: ${formatTokens(total)} tokens (${m.calls} calls) ${formatCost(m.total_cost)}`,
						);
					}
				}

				const output = lines.join("\n");
				if (ctx?.ui) {
					ctx.ui.notify(output);
				}
			} catch (err) {
				const message = `Usage stats error: ${err}`;
				if (ctx?.ui) {
					ctx.ui.notify(message);
				}
			}
		},
	});

	// Cleanup
	pi.on("session_shutdown", () => {
		closeDB();
	});
}
