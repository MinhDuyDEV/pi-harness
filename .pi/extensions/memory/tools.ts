/**
 * Compact Pi memory tool registrations.
 *
 * 3 tools is the optimal surface:
 * - observation: create observations OR give feedback on existing ones
 * - memory-search: search observations by text OR read memory files by path
 * - memory-admin: diagnostics + explicitly gated maintenance
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type {
	ConfidenceLevel,
	ObservationSource,
	ObservationType,
} from "./config.js";
import {
	autoDetectFiles,
	formatObservation,
	parseCSV,
	TYPE_ICONS,
	VALID_TYPES,
} from "./helpers.js";
import {
	getMarkdownFilesInSqlite,
	getMemoryFile,
	upsertMemoryFile,
} from "./storage.js";
import {
	getObservationsByIds,
	searchObservationsFTS,
	storeObservation,
} from "./observations.js";
import { recordFeedback } from "./scoring.js";
import {
	executeMemoryAdmin,
	MemoryAdminParameters,
	type MemoryAdminParams,
} from "./admin.js";

/**
 * Backstop for the W25 compaction noise bug: the compaction agent was
 * creating durable `type="warning"` observations about its own compaction
 * work (status, meta-comments, "this is a big observation", etc.). That
 * is not durable memory; the weekly note is the artifact.
 */
export function isCompactionSelfWarning(params: {
	type?: string;
	title?: string;
	subtitle?: string;
	narrative?: string;
	facts?: string;
	concepts?: string;
}): boolean {
	if (params.type !== "warning") return false;
	const text = [
		params.title,
		params.subtitle,
		params.narrative,
		params.facts,
		params.concepts,
	]
		.filter(Boolean)
		.join("\n")
		.toLowerCase();
	const compactionTerms = [
		"compaction",
		"memory compact",
		"memory-compact",
		"compaction note",
		"weekly summary",
		"curated summary",
	];
	const selfWorkTerms = [
		"self",
		"meta",
		"status",
		"progress",
		"artifact",
		"note file",
		"about its own work",
		"this compaction",
		"this weekly summary",
		"this curated summary",
	];
	const hasCompactionTerm = compactionTerms.some((term) => text.includes(term));
	const hasSelfWorkTerm = selfWorkTerms.some((term) => text.includes(term));
	return (
		(hasCompactionTerm && hasSelfWorkTerm) ||
		text.includes("this is a big observation")
	);
}

/**
 * Reject warning titles that are source/template noise (W25): agents and
 * deleted dream.ts used code lines or `Warning: ${terms...}` as titles.
 */
export function isTemplateOrSourceLineWarningTitle(title: string): boolean {
	const t = title.trim();
	if (!t) return false;
	if (/^Warning:\s*\$\{/i.test(t)) return true;
	if (/notices\.push\s*\(/i.test(t)) return true;
	if (/title:\s*`Warning:/i.test(t)) return true;
	if (/storeObservation\s*\(/i.test(t)) return true;
	if (/\.ts:\d+/.test(t) && /(notices|warning|push|title:)/i.test(t)) return true;
	if (/^type:\s*["']warning["']/i.test(t)) return true;
	return false;
}

const VALID_CONFIDENCES: ConfidenceLevel[] = ["high", "medium", "low"];

function textResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function parseIds(query: string): number[] {
	const ids = new Set<number>();
	for (const match of query.matchAll(/(?:#|id:)(\d+)/gi)) {
		const id = Number(match[1]);
		if (Number.isInteger(id) && id > 0) ids.add(id);
	}
	return [...ids];
}

function normalizeFilePath(file: string): string {
	return file.trim().replace(/^\/+/, "").replace(/\.md$/i, "");
}

function renderSearchResults(rows: Array<{
	id: number; type: string; title: string; snippet?: string | null;
	relevance_score?: number; combined_score?: number; created_at?: string | null;
}>): string {
	if (rows.length === 0) return "No matching observations found.";
	const lines = ["## Memory Search Results", ""];
	for (const row of rows) {
		const icon = TYPE_ICONS[row.type] ?? "📌";
		const score = row.combined_score ?? row.relevance_score;
		lines.push(`${icon} **#${row.id}** [${row.type}] ${row.title}`);
		if (score !== undefined) lines.push(`  Score: ${score.toFixed(3)}`);
		if (row.snippet) lines.push(`  ${row.snippet}`);
		if (row.created_at) lines.push(`  _${row.created_at}_`);
		lines.push("");
	}
	return lines.join("\n").trim();
}

export function registerMemoryTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "observation",
		label: "Memory — Store or Give Feedback",
		description:
			"Create a durable observation for future retrieval, or mark an existing one as helpful/harmful. " +
			"Pass id+feedback for feedback mode; pass type+title for create mode.",
		parameters: Type.Object({
			// --- Create mode params ---
			type: Type.Optional(Type.String({ description: `Observation type for create mode: ${VALID_TYPES.join(", ")}` })),
			title: Type.Optional(Type.String({ description: "Short title (create mode)" })),
			subtitle: Type.Optional(Type.String()),
			facts: Type.Optional(Type.String({ description: "Comma-separated facts" })),
			narrative: Type.Optional(Type.String({ description: "Detailed context" })),
			content: Type.Optional(Type.String({ description: "Alias for narrative" })),
			concepts: Type.Optional(Type.String({ description: "Comma-separated concepts" })),
			files_read: Type.Optional(Type.String({ description: "Comma-separated files read" })),
			files_modified: Type.Optional(Type.String({ description: "Comma-separated files modified" })),
			files: Type.Optional(Type.String({ description: "Alias for files_modified" })),
			bead_id: Type.Optional(Type.String()),
			confidence: Type.Optional(Type.String({ description: "high, medium, or low" })),
			supersedes: Type.Optional(Type.String({ description: "Observation ID this supersedes" })),
			source: Type.Optional(Type.String({ description: "manual, curator, or imported" })),
			// --- Feedback mode params ---
			id: Type.Optional(Type.Number({ description: "Observation ID for feedback mode" })),
			feedback: Type.Optional(Type.String({ description: "\"helpful\" or \"harmful\" (feedback mode)" })),
			reason: Type.Optional(Type.String({ description: "Optional reason for feedback" })),
		}),
		async execute(
			_toolCallId: string,
			params: Record<string, unknown>,
			_signal: AbortSignal | undefined,
			_onUpdate: ((partial: any) => void) | undefined,
			_ctx: any,
		) {
			// --- Feedback mode: observation #id marked helpful/harmful ---
			if (params.id !== undefined && params.feedback !== undefined) {
				const obsId = Number(params.id);
				if (!Number.isInteger(obsId)) throw new Error("id must be an integer.");
				const fb = String(params.feedback);
				if (fb !== "helpful" && fb !== "harmful") throw new Error('feedback must be "helpful" or "harmful".');
				const result = recordFeedback(obsId, fb);
				if (!result.success) throw new Error(result.error ?? "Failed to record feedback.");
				return textResult(
					[
						`✅ Observation #${obsId} marked ${fb}.`,
						`- Feedback: ${result.helpfulCount} helpful / ${result.harmfulCount} harmful`,
					].join("\n"),
					result,
				);
			}

			// --- Create mode: store a new observation ---
			if (!params.type || !params.title) {
				throw new Error("Provide type+title to create an observation, or id+feedback to give feedback.");
			}
			const type = VALID_TYPES.includes(params.type as ObservationType)
				? (params.type as ObservationType) : "learning";
			const confidence = VALID_CONFIDENCES.includes(params.confidence as ConfidenceLevel)
				? (params.confidence as ConfidenceLevel) : "high";
			const source: ObservationSource =
				params.source === "curator" || params.source === "imported" ? params.source : "manual";
			const narrative = (params.narrative ?? params.content) as string | undefined;
			const filesRead = parseCSV(params.files_read as string | undefined)
				?? (narrative ? autoDetectFiles(narrative) : undefined);
			const filesModified = parseCSV((params.files_modified ?? params.files) as string | undefined);
			const supersedes = params.supersedes ? Number(params.supersedes) : undefined;

			const titleStr = String(params.title);
			if (isCompactionSelfWarning({
				type,
				title: titleStr,
				subtitle: params.subtitle as string | undefined,
				narrative,
				facts: params.facts as string | undefined,
				concepts: params.concepts as string | undefined,
			})) {
				return textResult(
					"Skipped: compaction self-warnings are not durable observations. Keep compaction status, warnings, and meta-comments in the weekly note/artifact instead.",
					{ skipped: true, reason: "compaction-self-warning" },
				);
			}
			if (type === "warning" && isTemplateOrSourceLineWarningTitle(titleStr)) {
				return textResult(
					"Skipped: warning title looks like source/template noise, not durable memory. Summarize the underlying issue in plain language.",
					{ skipped: true, reason: "template-warning-title" },
				);
			}

			const id = storeObservation({
				type,
				title: String(params.title),
				subtitle: params.subtitle as string | undefined,
				facts: parseCSV(params.facts as string | undefined),
				narrative: narrative ?? "",
				concepts: parseCSV(params.concepts as string | undefined),
				files_read: filesRead,
				files_modified: filesModified,
				confidence,
				bead_id: params.bead_id as string | undefined,
				supersedes: Number.isInteger(supersedes) ? supersedes : undefined,
				source,
			});
			return textResult(`✅ Observation #${id} stored.`, { id });
		},
	});

	pi.registerTool({
		name: "memory-search",
		label: "Memory — Search or Read",
		description:
			"Search observations by text query / #id references, or read a memory file by path. " +
			"Pass file=path to read a memory file; pass query=text to search observations.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Search query or #id references" })),
			type: Type.Optional(Type.String({ description: "Optional observation type filter" })),
			limit: Type.Optional(Type.Number({ description: "Maximum results, default 10" })),
			file: Type.Optional(Type.String({ description: "Memory file path (e.g. persona/default, scenes/<id>)" })),
		}),
		async execute(_toolCallId: string, params: { query?: string; type?: string; limit?: number; file?: string }) {
			// File-read mode
			if (params.file?.trim()) {
				const filePath = normalizeFilePath(params.file);
				const row = getMemoryFile(filePath);
				if (!row) return textResult(`Memory file not found: ${filePath}`);
				return textResult(row.content, { file: filePath });
			}

			// List files mode (no query, no file)
			if (!params.query?.trim()) {
				const files = getMarkdownFilesInSqlite();
				return textResult(
					files.length ? ["## Memory Files", "", ...files.map((f) => `- ${f}`)].join("\n") : "No memory files stored.",
					{ files },
				);
			}

			// Search mode
			const limit = Math.max(1, Math.min(params.limit ?? 10, 50));
			const ids = parseIds(params.query);
			if (ids.length > 0) {
				const rows = getObservationsByIds(ids).slice(0, limit);
				return textResult(
					rows.length ? rows.map(formatObservation).join("\n\n---\n\n") : "No observations found for the requested IDs.",
					{ ids: rows.map((r) => r.id) },
				);
			}

			const type = VALID_TYPES.includes(params.type as ObservationType)
				? (params.type as ObservationType) : undefined;
			const rows = searchObservationsFTS(params.query, { type, limit });
			return textResult(renderSearchResults(rows), { ids: rows.map((r) => r.id) });
		},
	});

	pi.registerTool({
		name: "memory-admin",
		label: "Memory Admin",
		description: "Compact memory diagnostics and explicitly gated maintenance.",
		parameters: MemoryAdminParameters,
		async execute(_toolCallId: string, params: MemoryAdminParams) {
			return executeMemoryAdmin(params ?? {}) as any;
		},
	});
}
