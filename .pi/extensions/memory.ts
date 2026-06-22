/**
 * Memory extension — entry point.
 *
 * After ADR-001 cleanup: removed the L1/L2/L3 pipeline, persona/scene
 * injection, project-index FTS5 crawler, and embedding-based search.
 * The agent now drives all compaction and curation decisions. Per the
 * Syntax #976 thesis: "the agent itself has some autonomy over how it
 * compresses it" and "bash is all you need."
 *
 * Surfaces:
 * - 3 tools (observation, memory-search, memory-admin) — see tools.ts
 * - before_agent_start context injection: FTS5 search of relevant observations
 * - /memory-compact slash command: agent-driven weekly compaction to
 *   `<project>/.pi/artifacts/notes/{ISO-week}.md`
 *
 * See: .pi/artifacts/DECISIONS.md#adr-001-memory-extension-cleanup
 */

import type {
	ExtensionAPI,
	AgentEndEvent,
	SessionCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { getMemoryDB } from "./memory/db.js";
import { archiveDuplicateObservations } from "./memory/maintenance.js";
import { getObservationStats, searchObservationsFTS } from "./memory/observations.js";
import {
	getCurrentWeekId,
	getObservationsForCompaction,
	formatObservationsForCompaction,
	writeCompactionNote,
} from "./memory/distill.js";
import { registerMemoryTools } from "./memory/tools.js";
import { getCheckpointRebuildContext } from "./checkpoint/index.js";
import { MEMORY_CONFIG } from "./memory/config.js";

const MAX_INJECTION_TOKENS = MEMORY_CONFIG.injection.maxTokens;

/** Rough token estimate: 1 token ≈ 4 characters. */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export default function (pi: ExtensionAPI): void {
	// Initialize DB on extension load (also keeps WAL warm)
	getMemoryDB();

	// Register 3 tools: observation, memory-search, memory-admin
	registerMemoryTools(pi);

	// Auto-context-inject relevant observations on each new turn
	pi.on("before_agent_start", async (event, ctx) => {
		if (!MEMORY_CONFIG.injection.enabled) return {};
		const prompt = (event as any).prompt ?? "";
		if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
			return {};
		}

		const sessionId = (ctx as any)?.sessionManager?.getSessionId?.() ?? undefined;
		const cwd = (ctx as any)?.cwd ?? process.cwd();
		const sections: string[] = [];

		// 1. Checkpoint context (independent of memory DB)
		try {
			const checkpointContext = (await getCheckpointRebuildContext(cwd, sessionId)) ?? "";
			if (checkpointContext) {
				sections.push(checkpointContext);
			}
		} catch {
			// Best-effort; never break the user turn
		}

		// 2. FTS5 search of relevant observations (replaces getRelevantKnowledge)
		try {
			const stats = getObservationStats();
			const totalObs = Object.values(stats).reduce((sum, n) => sum + n, 0);
			if (totalObs > 0) {
				const results = searchObservationsFTS(prompt, { limit: 5 });
				if (results.length > 0) {
					const lines = results.map((r) => {
						const snippet = r.snippet ? r.snippet.replace(/\s+/g, " ").trim() : "";
						return `- [#${r.id}] (${r.type}) ${r.title}${snippet ? ` — ${snippet}` : ""}`;
					});
					sections.push(`## Relevant Memory\n${lines.join("\n")}`);
				}
			}
		} catch {
			// Best-effort
		}

		if (sections.length === 0) return {};

		const joined = sections.join("\n\n");
		const estimated = estimateTokens(joined);
		if (estimated > MAX_INJECTION_TOKENS) {
			return { systemPrompt: joined.slice(0, MAX_INJECTION_TOKENS * 4) };
		}

		return { systemPrompt: joined };
	});

	// agent_end and session_compact are now no-ops (no more auto-pipeline)
	pi.on("agent_end", (_event: AgentEndEvent) => {
		// Intentionally empty. The agent drives observation creation
		// explicitly via the `observation` tool, not via background pipeline.
	});

	pi.on("session_compact", (_event: SessionCompactEvent) => {
		// Intentionally empty. Memory is decoupled from session compaction.
	});

	// /memory-compact slash command — agent-driven lossy compression.
	// Per the video: "the agent itself has some autonomy over how it compresses it."
	pi.registerCommand("memory-compact", {
		description: "Compact recent observations into a weekly markdown note at .pi/artifacts/notes/. Args: <sinceDays>",
		async handler(args: string, ctx: any) {
			const sinceDays = parseInt(args.trim() || "7", 10) || 7;
			const projectRoot = ctx?.cwd ?? process.cwd();
			// Clean active memory before generating the raw compaction payload.
			// Otherwise compaction faithfully reprints historical duplicate rows and
			// relies on a human/agent to remember to run memory-admin dedupe first.
			// This archives duplicates via superseded_by; it does not delete data.
			const dedupeStats = archiveDuplicateObservations({ dryRun: false });
			const observations = getObservationsForCompaction(sinceDays);
			if (observations.length === 0) {
				ctx.ui?.notify?.(`No observations in the last ${sinceDays} days.`, "info");
				return;
			}
			const payload = formatObservationsForCompaction(observations);
			const weekId = getCurrentWeekId();
			const notePath = writeCompactionNote(weekId, payload, projectRoot);
			const message = [
				`Compaction note written: ${notePath}`,
				`Observations covered: ${observations.length}`,
				`Duplicates archived before compaction: ${dedupeStats.archived}`,
				`Duplicate candidates remaining: ${dedupeStats.candidates - dedupeStats.archived}`,
				`Week: ${weekId}`,
				``,
				`Next: read ${notePath} and write a curated summary to it.`,
				`Do not call the observation tool during compaction. The note file is the durable artifact; compaction status, warnings, and meta-comments must stay out of memory observations.`,
			].join("\n");
			ctx.ui?.notify?.(message, "info");
		},
	});
}
