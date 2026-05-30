/**
 * Pi Memory Extension — Entry Point
 *
 * 4-tier persistent memory system: capture → distill → curate → recall.
 *
 * DEPENDENCIES:
 *   node:sqlite (built into Node.js v22.5+, no native compilation)
 *   sqlite-vec (optional: npm install sqlite-vec) — for vector similarity search
 *
 * WHAT THIS EXTENSION DOES:
 *   - Registers compact memory tools (observation, search, read, update, admin, feedback)
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

import type { TextContent } from "@earendil-works/pi-ai";
import { MEMORY_CONFIG } from "./memory/config.js";
import { curateFromDistillations } from "./memory/curator.js";
import { closeMemoryDB, getMemoryDB } from "./memory/db.js";
import { distillSession } from "./memory/distill.js";
import { clearEmbeddings, embed, warmupEmbeddings } from "./memory/embeddings.js";
import { checkpointWAL, getDatabaseSizes, optimizeFTS5 } from "./memory/maintenance.js";
import { backfillEmbeddings, getObservationStats } from "./memory/observations.js";
import { getRelevantKnowledge, storeTemporalMessage } from "./memory/pipeline.js";
import { sanitize } from "./memory/sanitize.js";
import { refreshAllScores } from "./memory/scoring.js";
import { registerMemoryTools } from "./memory/tools.js";
import { generatePersona, readPersona } from "./memory/persona.js";
import { detectAndStoreScenes, listScenes } from "./memory/scene.js";
import type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  ExtensionContext,
  InputEvent,
  SessionCompactEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

// Stable session identifier from Pi's extension context
function getSessionId(ctx: ExtensionContext, _event?: unknown): string {
  return ctx?.sessionManager?.getSessionId?.() ?? ctx?.cwd ?? "default";
}

function stringifyForCapture(value: unknown, maxLength: number): string | null {
	try {
		const json = JSON.stringify(value);
		if (!json) return null;
		return json.length > maxLength ? json.slice(0, maxLength) : json;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Extension factory (Pi entry point)
// ---------------------------------------------------------------------------

export default function memoryExtension(pi: ExtensionAPI): void {
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
	let lastMaintenanceAt = 0;
	let maintenanceCycleCount = 0;

	// --- Capture user messages ---
	pi.on("input", (event: InputEvent, ctx: ExtensionContext) => {
		if (!MEMORY_CONFIG.capture.enabled) return;

		// Skip mid-stream steers — only process idle prompts and follow-ups
		if (event.streamingBehavior === "steer") return;

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
			const sessionId = getSessionId(ctx, event);

			storeTemporalMessage({
				session_id: sessionId,
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
	pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
		if (!MEMORY_CONFIG.capture.enabled) return;

		try {
			const toolName = event.toolName ?? "tool";
			const toolCallId = event.toolCallId ?? null;
			const isError = Boolean(event.isError);
			const status = isError ? "error" : "completed";
			let rawJson = stringifyForCapture(event, MEMORY_CONFIG.capture.maxRawJsonLength);
			if (rawJson && MEMORY_CONFIG.sanitization.enabled) {
				rawJson = sanitize(rawJson).text;
			}
			const textParts = Array.isArray(event.content)
				? event.content
					.filter((c): c is TextContent => c.type === "text" && typeof c.text === "string")
					.map((c) => c.text)
				: [];
			const legacyResult = event?.result;
			const legacyText =
				typeof legacyResult === "string"
					? legacyResult
					: Array.isArray(legacyResult?.content)
						? legacyResult.content
								.filter((c): c is TextContent => c?.type === "text" && typeof c.text === "string")
								.map((c) => c.text)
								.join("\n")
						: typeof legacyResult?.content === "string"
							? legacyResult.content
							: "";
			const text = textParts.join("\n") || legacyText;
			if (!text) return;

			let content = text.slice(0, MEMORY_CONFIG.capture.maxContentLength);

			// Sanitize secrets before storage
			if (MEMORY_CONFIG.sanitization.enabled) {
				const { text: sanitized } = sanitize(content);
				content = sanitized;
			}

			const tokenEstimate = Math.ceil(content.length / 4);
			const now = Date.now();
			const sessionId = getSessionId(ctx, event);

			storeTemporalMessage({
				session_id: sessionId,
				message_id: `tool-${toolName}-${now}-${Math.random().toString(36).slice(2, 8)}`,
				role: "tool",
				content: `[${toolName}] ${content}`,
				token_estimate: tokenEstimate,
				time_created: now,
				tool_name: toolName,
				tool_call_id: toolCallId,
				status,
				is_error: isError,
				raw_json: rawJson,
			});
		} catch {
			// Capture is best-effort
		}
	});

	// -----------------------------------------------------------------------
	// Pipeline auto-trigger state (per session turn counter + timer)
	// -----------------------------------------------------------------------
	const pipelineTurnCounts = new Map<string, { count: number; warmupThreshold: number; lastRunMs: number; lastActivityMs: number }>();

	// --- Track user input for turn counting ---
	pi.on("input", (_event: InputEvent, ctx: ExtensionContext) => {
		// Skip mid-stream steers — only count idle prompts and follow-ups
		if (_event.streamingBehavior === "steer") return;
		const sessionId = getSessionId(ctx, _event);
		const state = pipelineTurnCounts.get(sessionId) ?? {
			count: 0,
			warmupThreshold: 1,
			lastRunMs: 0,
			lastActivityMs: Date.now(),
		};
		state.count++;
		state.lastActivityMs = Date.now();
		pipelineTurnCounts.set(sessionId, state);
	});

	/**
	 * Check whether the pipeline should run for this session.
	 * Implements:
	 *   - everyNConversations throttle
	 *   - Warmup doubling (1→2→4→...→everyNConversations)
	 *   - Idle timeout trigger
	 */
	function shouldRunPipeline(sessionId: string): boolean {
		const state = pipelineTurnCounts.get(sessionId);
		if (!state) return false;

		const { pipeline } = MEMORY_CONFIG;
		const now = Date.now();

		// Respect min interval between runs
		if (now - state.lastRunMs < pipeline.l1MinIntervalSeconds * 1000) {
			return false;
		}

		// Check idle timeout trigger
		if (pipeline.l1IdleTimeoutSeconds > 0) {
			const idleSec = (now - state.lastActivityMs) / 1000;
			if (idleSec >= pipeline.l1IdleTimeoutSeconds) {
				return true;
			}
		}

		// Check turn-count trigger with warmup
		const threshold = pipeline.enableWarmup
			? Math.min(state.warmupThreshold, pipeline.everyNConversations)
			: pipeline.everyNConversations;

		if (threshold === 0) return true; // every turn
		if (state.count >= threshold) return true;
		return false;
	}

	// --- Run pipeline on agent_end ---
	pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
		try {
			const sessionId = getSessionId(ctx, event);

			// Check auto-trigger conditions
			if (!shouldRunPipeline(sessionId)) return;

			// Bump warmup threshold (doubling) after a triggered run
			const state = pipelineTurnCounts.get(sessionId);
			if (state) {
				state.count = 0;
				state.lastRunMs = Date.now();
				if (MEMORY_CONFIG.pipeline.enableWarmup) {
					state.warmupThreshold = Math.min(
						state.warmupThreshold * 2,
						MEMORY_CONFIG.pipeline.everyNConversations,
					);
				}
			}

			// Distill accumulated messages
			const distillationId = distillSession(sessionId);
			if (distillationId) {
				// Curate observations from distillations
				curateFromDistillations(sessionId);

				// Regenerate L3 persona after pipeline pass
				try {
					generatePersona("default");
				} catch {
					// Persona generation is best-effort
				}

				// L2 Scene detection: cluster observations into work patterns
				if (MEMORY_CONFIG.scene.enabled) {
					try {
						const sceneCount = detectAndStoreScenes();
						// scene detection complete (stored in memory_files)
					} catch {
						// Scene detection is best-effort
					}
				}
			}

			const now = Date.now();
			if (now - lastMaintenanceAt >= MEMORY_CONFIG.maintenance.minIntervalMs) {
				lastMaintenanceAt = now;
				maintenanceCycleCount++;

				// Refresh time-decay scores periodically
				refreshAllScores();

				// Periodic maintenance
				optimizeFTS5();
				checkpointWAL();

				// Background: warm up embedding model for next search
				warmupEmbeddings().catch(() => {});

				// Periodic health telemetry (every N cycles)
				const telemetryEvery = MEMORY_CONFIG.telemetry.everyNCycles;
				if (telemetryEvery > 0 && maintenanceCycleCount % telemetryEvery === 0) {
					try {
						const obsStats = getObservationStats();
						const obsTotal = Object.values(obsStats).reduce((sum, n) => sum + n, 0);
						const sizes = getDatabaseSizes();
						const scenes = listScenes();
						const telemetry = {
							event: "memory-health",
							observations: obsTotal,
							scenes: scenes.length,
							dbSizeKB: Math.round(sizes.total / 1024),
							timestamp: new Date().toISOString(),
						};
						if (MEMORY_CONFIG.debug) console.log(JSON.stringify(telemetry));
					} catch {
						// Telemetry is best-effort
					}
				}
			}
		} catch {
			// Pipeline is best-effort
		}
	});

	// --- Reset pipeline state on session compact ---
	pi.on("session_compact", (_event: SessionCompactEvent, ctx: ExtensionContext) => {
		try {
			const sessionId = getSessionId(ctx, _event);
			pipelineTurnCounts.delete(sessionId);
		} catch {
			// best-effort
		}
	});

	// --- Auto context injection on agent start ---
	pi.on("before_agent_start", async (event: BeforeAgentStartEvent) => {
		if (!MEMORY_CONFIG.injection.enabled) return;

		try {
			// Inject L3 persona context (if available)
			let personaContext = "";
			try {
				const personaMd = readPersona("default");
				if (personaMd) {
					const lines = personaMd.split("\n").filter(l => l.startsWith("**") || l.startsWith("-") || l.startsWith("|")).slice(0, 15);
					if (lines.length > 0) {
						personaContext = "\n\n## User Persona Context\n_Learned patterns from past sessions._\n" + lines.join("\n");
					}
				}
			} catch {}

			// Inject L2 scene context
			let sceneContext = "";
			if (MEMORY_CONFIG.scene.enabled) {
				try {
					const scenes = listScenes();
					if (scenes.length > 0) {
						sceneContext = "\n\n## Active Work Patterns (Scenes)\n_Recurring work patterns from past sessions._\n";
						for (const s of scenes.slice(0, 5)) {
							sceneContext += `- **${s.name}** (${s.count} obs, score: ${s.score.toFixed(2)}, ${s.span})\n`;
						}
					}
				} catch {}
			}

			const stats = getObservationStats();
			const totalObs = Object.values(stats).reduce((sum: number, n: number) => sum + n, 0);
			if (totalObs === 0 && !personaContext && !sceneContext) return;

			const userMessage = event?.userMessage ?? event?.message ?? event?.input ?? "";
			const taskTerms = typeof userMessage === "string"
				? userMessage.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2).slice(0, 20)
				: [];
			if (taskTerms.length === 0) return;

			let queryEmbedding: number[] | null = null;
			try { queryEmbedding = await embed(taskTerms.join(" ")); } catch {}

			const knowledge = getRelevantKnowledge(taskTerms, {
				tokenBudget: MEMORY_CONFIG.injection.tokenBudget,
				minScore: MEMORY_CONFIG.injection.minScore,
				queryEmbedding,
			});

			const parts: string[] = [];
			if (personaContext) parts.push(personaContext);
			if (sceneContext) parts.push(sceneContext);

			if (knowledge.length > 0) {
				const memLines = ["\n## Relevant Memory (Auto-Injected)", "_The following observations were retrieved from memory based on the current task._\n"];
				for (const item of knowledge) {
					memLines.push(`- **[${item.type}]** ${item.title} _(score: ${item.score.toFixed(2)})_`);
					if (item.content) memLines.push(`  ${item.content.slice(0, 200).replace(/\n/g, " ")}`);
				}
				parts.push(memLines.join("\n"));
			}

			if (parts.length === 0) return;
			return { systemPrompt: (event.systemPrompt ?? "") + parts.join("\n") };
		} catch {
			// Injection is best-effort — never break agent startup
		}
	});

	// --- Cleanup on shutdown ---
	pi.on("session_shutdown", () => {
		pipelineTurnCounts.clear();
		try {
			clearEmbeddings();
			closeMemoryDB();
		} catch {
			// Cleanup is best-effort
		}
	});

	// 4. No /memory command — this extension is for the agent, not the user.
}
