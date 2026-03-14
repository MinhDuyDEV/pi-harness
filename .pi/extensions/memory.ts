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
 *   - Registers 7 memory tools (observation, search, get, read, update, timeline, admin)
 *   - Auto-captures user messages on each input event
 *   - Runs TF-IDF distillation + pattern-based curation on agent_end
 *   - Stores everything in SQLite with FTS5 full-text search
 *
 * WHAT IT DOES NOT DO (Pi architectural limits):
 *   - No automatic LTM injection into system prompt (use /memory-search or APPEND_SYSTEM.md)
 *   - No automatic context compression (Pi handles compaction natively)
 *   - No assistant response capture (Pi events don't expose full responses)
 *
 * The agent should be instructed (via AGENTS.md or APPEND_SYSTEM.md) to use
 * memory tools proactively: search before work, observe after decisions.
 */

import { MEMORY_CONFIG } from "./memory/config.js";
import { curateFromDistillations } from "./memory/curator.js";
import { closeMemoryDB, getMemoryDB } from "./memory/db.js";
import { distillSession } from "./memory/distill.js";
import { checkpointWAL, optimizeFTS5 } from "./memory/maintenance.js";
import { storeTemporalMessage } from "./memory/pipeline.js";
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

			const content = text.slice(0, MEMORY_CONFIG.capture.maxContentLength);
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

			const content = text.slice(0, MEMORY_CONFIG.capture.maxContentLength);
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

			// Periodic maintenance
			optimizeFTS5();
			checkpointWAL();
		} catch {
			// Pipeline is best-effort
		}
	});

	// --- Cleanup on shutdown ---
	pi.on("session_shutdown", () => {
		try {
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
