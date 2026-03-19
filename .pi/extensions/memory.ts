/**
 * Pi Memory Extension — Entry Point
 *
 * 4-tier persistent memory system: capture → distill → curate → recall.
 *
 * DEPENDENCIES:
 *   npm install better-sqlite3
 *   npm install -D @types/better-sqlite3
 *
 * WHAT THIS EXTENSION DOES:
 *   - Registers 8 memory tools (observation, search, get, read, update, timeline, admin, feedback)
 *   - Auto-captures user messages on each input event (with secret sanitization)
 *   - Runs TF-IDF distillation + pattern-based curation on agent_end
 *   - Time-decay scoring on observations (CASS-inspired)
 *   - Maturity state machine: candidate → established → proven / deprecated
 *   - Auto-injects relevant observations into system prompt on agent start
 *   - Stores everything in SQLite with FTS5 full-text search
 *
 * UPGRADES (v3, CASS-inspired):
 *   - Time-decay scoring: feedback events decay with 90-day half-life
 *   - Feedback tool: mark observations as helpful/harmful
 *   - Auto context injection: relevant observations injected before agent starts
 *   - Secret sanitization: API keys, tokens, passwords stripped before storage
 *   - Maturity states: candidate → established → proven (auto-deprecate on harmful)
 */

import { MEMORY_CONFIG } from "./memory/config.js";
import { curateFromDistillations } from "./memory/curator.js";
import { closeMemoryDB, getMemoryDB } from "./memory/db.js";
import { distillSession } from "./memory/distill.js";
import { clearEmbeddings, embed, warmupEmbeddings } from "./memory/embeddings.js";
import { checkpointWAL, optimizeFTS5 } from "./memory/maintenance.js";
import { backfillEmbeddings } from "./memory/observations.js";
import { storeTemporalMessage } from "./memory/pipeline.js";
import { sanitize } from "./memory/sanitize.js";
import { refreshAllScores } from "./memory/scoring.js";
import { registerMemoryTools } from "./memory/tools.js";

// ---------------------------------------------------------------------------
// Extension factory (Pi entry point)
// ---------------------------------------------------------------------------

export default function memoryExtension(pi: any): void {
	// 1. Initialize database (ensures schema is up to date)
	try {
		getMemoryDB();
	} catch (err) {
		console.error("[memory] Failed to initialize database:", err);
		return;
	}

	// 2. Register all memory tools
	registerMemoryTools(pi);

	// 3. Backfill embeddings for pre-existing observations (async, non-blocking)
	backfillEmbeddings().catch(() => {});

	// 3. Register event handlers

	// --- Capture user messages ---
	pi.on("input", (event: any) => {
		if (!MEMORY_CONFIG.capture.enabled) return;

		try {
			const text =
				typeof event === "string"
					? event
					: (event?.text ?? event?.content ?? "");
			if (!text || typeof text !== "string") return;

			let content = text.slice(0, MEMORY_CONFIG.capture.maxContentLength);

			// Sanitize secrets before storage
			if (MEMORY_CONFIG.sanitization.enabled) {
				const { text: sanitized } = sanitize(content);
				content = sanitized;
			}

			const tokenEstimate = Math.ceil(content.length / 4);
			const now = Date.now();

			storeTemporalMessage({
				session_id: "default",
				message_id: `user-${now}-${Math.random().toString(36).slice(2, 8)}`,
				role: "user",
				content,
				token_estimate: tokenEstimate,
				time_created: now,
			});
		} catch {
			// Capture is best-effort, never throw
		}
	});

	// --- Capture tool results ---
	pi.on("tool_result", (event: any) => {
		if (!MEMORY_CONFIG.capture.enabled) return;

		try {
			const result = event?.result;
			if (!result) return;

			// Extract text from tool result content
			let text = "";
			if (typeof result === "string") {
				text = result;
			} else if (Array.isArray(result?.content)) {
				text = result.content
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text)
					.join("\n");
			} else if (result?.content && typeof result.content === "string") {
				text = result.content;
			}

			if (!text) return;

			let content = text.slice(0, MEMORY_CONFIG.capture.maxContentLength);

			// Sanitize secrets before storage
			if (MEMORY_CONFIG.sanitization.enabled) {
				const { text: sanitized } = sanitize(content);
				content = sanitized;
			}

			const tokenEstimate = Math.ceil(content.length / 4);
			const now = Date.now();
			const toolName = event?.name ?? event?.toolName ?? "tool";

			storeTemporalMessage({
				session_id: "default",
				message_id: `tool-${toolName}-${now}-${Math.random().toString(36).slice(2, 8)}`,
				role: "assistant",
				content: `[${toolName}] ${content}`,
				token_estimate: tokenEstimate,
				time_created: now,
			});
		} catch {
			// Capture is best-effort
		}
	});

	// --- Run pipeline on agent_end ---
	pi.on("agent_end", async () => {
		try {
			// Distill accumulated messages
			const distillationId = distillSession("default");
			if (distillationId) {
				// Curate observations from distillations
				curateFromDistillations("default");
			}

			// Refresh time-decay scores periodically
			refreshAllScores();

			// Periodic maintenance
			optimizeFTS5();
			checkpointWAL();

			// Warm up embedding model in background for next search
			warmupEmbeddings().catch(() => {});
		} catch {
			// Pipeline is best-effort
		}
	});

	// --- Auto context injection on agent start ---
	pi.on("before_agent_start", async (event: any) => {
		if (!MEMORY_CONFIG.injection.enabled) return;

		try {
			const { getRelevantKnowledge } = await import(
				"./memory/pipeline.js"
			);
			const { getObservationStats } = await import(
				"./memory/observations.js"
			);

			const stats = getObservationStats();
			const totalObs = Object.values(stats).reduce(
				(sum, n) => sum + n,
				0,
			);
			if (totalObs === 0) return; // No observations yet

			// Extract terms from the user's task/message if available
			const userMessage =
				event?.userMessage ?? event?.message ?? event?.input ?? "";
			const taskTerms = typeof userMessage === "string"
				? userMessage
						.toLowerCase()
						.split(/\s+/)
						.filter((t: string) => t.length > 2)
						.slice(0, 20)
				: [];

			if (taskTerms.length === 0) return; // Nothing to match against

			// Retrieve relevant knowledge (uses FTS5 + BM25 + recency decay + vector when available)
			// Generate query embedding for hybrid search
			let queryEmbedding: number[] | null = null;
			try {
				queryEmbedding = await embed(taskTerms.join(" "));
			} catch {
				// Embedding is best-effort
			}

			const knowledge = getRelevantKnowledge(taskTerms, {
				tokenBudget: MEMORY_CONFIG.injection.tokenBudget,
				minScore: MEMORY_CONFIG.injection.minScore,
				queryEmbedding,
			});

			if (knowledge.length === 0) return;

			// Build injection block
			const lines = [
				"\n\n## Relevant Memory (Auto-Injected)",
				"_The following observations were retrieved from memory based on the current task. Use them as context._\n",
			];

			for (const item of knowledge) {
				const scoreStr = item.score.toFixed(2);
				lines.push(
					`- **[${item.type}]** ${item.title} _(score: ${scoreStr})_`,
				);
				if (item.content) {
					const snippet = item.content.slice(0, 200).replace(/\n/g, " ");
					lines.push(`  ${snippet}`);
				}
			}

			return {
				systemPrompt: (event.systemPrompt ?? "") + lines.join("\n"),
			};
		} catch {
			// Injection is best-effort — never break agent startup
		}
	});

	// --- Cleanup on shutdown ---
	pi.on("session_shutdown", () => {
		try {
			clearEmbeddings();
			closeMemoryDB();
		} catch {
			// Cleanup is best-effort
		}
	});

	// 4. Register /memory command for quick status
	pi.registerCommand("memory", {
		description: "Show memory system status",
		async handler(ctx: any) {
			try {
				const { getDatabaseSizes } = await import("./memory/maintenance.js");
				const { getObservationStats } = await import(
					"./memory/observations.js"
				);
				const { getCaptureStats, getDistillationStats } = await import(
					"./memory/pipeline.js"
				);
				const { checkFTS5Available } = await import("./memory/maintenance.js");

				const sizes = getDatabaseSizes();
				const stats = getObservationStats();
				const capture = getCaptureStats();
				const distill = getDistillationStats();
				const fts = checkFTS5Available();

				const lines = [
					"## Memory System Status\n",
					`**Database**: ${(sizes.total / 1024).toFixed(1)} KB`,
					`**FTS5**: ${fts ? "Available" : "Unavailable"}`,
					"",
					"### Observations",
					...Object.entries(stats).map(([k, v]) => `  ${k}: ${v}`),
					"",
					"### Capture Pipeline",
					`  Messages: ${capture.total} (undistilled: ${capture.undistilled})`,
					`  Sessions: ${capture.sessions}`,
					"",
					"### Distillations",
					`  Total: ${distill.total} (${distill.sessions} sessions)`,
					`  Avg compression: ${((distill.avgCompression ?? 0) * 100).toFixed(1)}%`,
				];

				if (ctx?.ui) {
					ctx.ui.notify(lines.join("\n"));
				}
			} catch (err) {
				if (ctx?.ui) {
					ctx.ui.notify(`Memory status error: ${err}`);
				}
			}
		},
	});
}
