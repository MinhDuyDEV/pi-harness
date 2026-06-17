import { Type } from "@sinclair/typebox";

import { generateMemoryIndex } from "./index-generator.js";
import { upsertMemoryFile } from "./storage.js";
import {
	archiveDuplicateObservations,
	archiveOldObservations,
	checkFTS5Available,
	getDatabaseSizes,
	runFullMaintenance,
} from "./maintenance.js";
import {
	getAllObservations,
	getObservationStats,
	storeObservation,
} from "./observations.js";
import { getMemoryDB } from "./db.js";
import type { ConfidenceLevel, ObservationType } from "./config.js";

export const MEMORY_ADMIN_OPERATIONS = [
	"status",
	"dashboard",
	"export",
	"import",
	"rebuild",
	"maintenance",
	"dedupe",
	"write-file",
] as const;

export type MemoryAdminOperation = (typeof MEMORY_ADMIN_OPERATIONS)[number];

export interface MemoryAdminParams {
	operation?: string;
	older_than_days?: number;
	dry_run?: boolean;
	force?: boolean;
	import_json?: string;
	conflict?: string;
	json?: boolean;
	file?: string;
	content?: string;
	mode?: string;
}

export const MemoryAdminParameters = Type.Object({
	operation: Type.Optional(Type.String({
		description: `Operation: ${MEMORY_ADMIN_OPERATIONS.join(", ")}. Default: status. Mutating operations require force=true unless dry_run=true.`,
	})),
	older_than_days: Type.Optional(Type.Number({
		description: "Age threshold for maintenance/archive checks. Default: 90.",
	})),
	dry_run: Type.Optional(Type.Boolean({
		description: "Preview mutating operations without applying changes. Defaults to true for import/mutations without force.",
	})),
	force: Type.Optional(Type.Boolean({
		description: "Required for mutating operations: import, rebuild, maintenance, dedupe.",
	})),
	import_json: Type.Optional(Type.String({
		description: "JSON produced by memory-admin export; used only by import.",
	})),
	conflict: Type.Optional(Type.String({
		description: "Import conflict mode: skip or create. Default: skip.",
	})),
	json: Type.Optional(Type.Boolean({
		description: "Return JSON where supported.",
	})),
});

export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
}

function textResult(text: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text", text }], details };
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function requireForce(op: string, dryRun: boolean, force: boolean): ToolResult | null {
	if (dryRun || force) return null;
	return textResult(
		`⚠️ \`${op}\` mutates memory state. Re-run with \`dry_run: true\` to preview or \`force: true\` to apply.`,
	);
}

function normalizeOp(raw: string | undefined): MemoryAdminOperation | null {
	const op = raw ?? "status";
	return (MEMORY_ADMIN_OPERATIONS as readonly string[]).includes(op)
		? (op as MemoryAdminOperation)
		: null;
}

export async function executeMemoryAdmin(params: MemoryAdminParams): Promise<ToolResult> {
	const rawOp = params.operation ?? "status";
	const op = normalizeOp(rawOp);
	if (!op) {
		return textResult(
			`❌ Unknown memory-admin operation \"${rawOp}\". Valid operations: ${MEMORY_ADMIN_OPERATIONS.join(", ")}`,
		);
	}

	const olderThanDays = params.older_than_days ?? 90;
	const force = params.force === true;
	const jsonOutput = params.json === true;

	try {
		switch (op) {
			case "status":
			case "dashboard":
				return renderStatus(op === "dashboard");

			case "export":
				return renderExport();

			case "import": {
				const dryRun = params.dry_run ?? !force;
				const blocked = requireForce("import", dryRun, force);
				if (blocked) return blocked;
				return runImport(params.import_json ?? "", params.conflict ?? "skip", dryRun);
			}

			case "rebuild": {
				const dryRun = params.dry_run ?? false;
				const blocked = requireForce("rebuild", dryRun, force);
				if (blocked) return blocked;
				if (dryRun) {
					return textResult("## Rebuild Preview\nWould regenerate memory index.");
				}
				const index = generateMemoryIndex();
				return textResult([
					"## Memory Rebuild Complete",
					`- Index entries: ${index.entryCount}`,
				].join("\n"));
			}

			case "maintenance": {
				const dryRun = params.dry_run ?? false;
				const blocked = requireForce("maintenance", dryRun, force);
				if (blocked) return blocked;
				const stats = runFullMaintenance({ olderThanDays, dryRun });
				return textResult([
					dryRun ? "## Maintenance Preview" : "## Maintenance Complete",
					`- Archived observations: ${stats.archived}`,
					`- WAL checkpointed: ${stats.checkpointed ? "yes" : "no"}`,
					`- Vacuumed: ${stats.vacuumed ? "yes" : "no"}`,
					`- Freed: ${formatBytes(stats.freedBytes)}`,
				].join("\n"));
			}

			case "dedupe": {
				const dryRun = params.dry_run ?? !force;
				const blocked = requireForce("dedupe", dryRun, force);
				if (blocked) return blocked;
				const stats = archiveDuplicateObservations({ dryRun, sampleLimit: 10 });
				const sampleLines = stats.samples.map((sample) =>
					`  - [${sample.reason}] keep #${sample.keep_id} (${sample.type}) "${sample.title}"; archive ${sample.duplicates}: ${sample.duplicate_ids}`,
				);
				return textResult([
					dryRun ? "## Duplicate Archive Preview" : "## Duplicate Archive Complete",
					`- Candidate duplicate rows: ${stats.candidates}`,
					`- Duplicate groups: ${stats.groups}`,
					`- Exact non-warning duplicates: ${stats.exactNonWarningCandidates}`,
					`- Warning title duplicates: ${stats.warningTitleCandidates}`,
					`- Archived rows: ${stats.archived}`,
					...(sampleLines.length ? ["", "Samples:", ...sampleLines] : []),
				].join("\n"), stats as unknown as Record<string, unknown>);
			}

			case "write-file": {
				if (!params.file?.trim() || !params.content?.trim()) {
					return textResult("❌ Provide file path and content.");
				}
				const dryRun = params.dry_run ?? !force;
				if (dryRun) {
					return textResult(`[DRY RUN] Would write ${params.file.trim()} (${params.content.trim().length} chars, mode: ${params.mode === "append" ? "append" : "replace"})`);
				}
				if (!force) {
					return textResult("⚠️  write-file mutates memory. Re-run with dry_run:true to preview or force:true to apply.");
				}
				const mode = params.mode === "append" ? "append" : "replace";
				upsertMemoryFile(params.file.trim(), params.content, mode);
				return textResult(`✅ Memory file ${mode === "append" ? "appended" : "written"}: ${params.file.trim()}`);
			}

			default:
				return textResult(`❌ Unknown operation "${op}". Valid: ${MEMORY_ADMIN_OPERATIONS.join(", ")}`);
		}
	} catch (error) {
		return textResult(`❌ memory-admin ${op} failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

	function renderStatus(includeDetails: boolean): ToolResult {
		const sizes = getDatabaseSizes();
		const obsStats = getObservationStats();
		const obsTotal = Object.values(obsStats).reduce((sum, n) => sum + n, 0);

		const lines = [
			includeDetails ? "## Memory Dashboard" : "## Memory Status",
			"",
			`- Observations: ${obsTotal}`,
			`- DB: ${formatBytes(sizes.total)} (WAL ${formatBytes(sizes.wal)})`,
			`- FTS5: ${checkFTS5Available() ? "available" : "unavailable"}`,
			`- Storage: SQLite (canonical)`,
		];

		if (includeDetails) {
			lines.push("", "### Observation Types");
			for (const [type, count] of Object.entries(obsStats)) lines.push(`- ${type}: ${count}`);

			// Observability: signal quality
			const signal = getMemorySignalQuality();
			lines.push(
				"",
				"### Signal Quality",
				`- Total retrievals: ${signal.totalRetrievals}`,
				`- Helpful: ${signal.helpfulCount} · Harmful: ${signal.harmfulCount}`,
				`- Net signal: ${signal.netSignal >= 0 ? "+" : ""}${signal.netSignal}`,
				`- Avg retrievals / observation: ${signal.avgRetrievals.toFixed(2)}`,
			);

			if (signal.topRetrieved.length > 0) {
				lines.push("", "### Top Retrieved (signal-rich)");
				for (const row of signal.topRetrieved) {
					lines.push(
						`- [#${row.id}] (${row.type}) ${row.title} — ${row.retrieval_count}× retrieved, ${row.helpful_count} helpful / ${row.harmful_count} harmful`,
					);
				}
			}

			if (signal.unusedObservations > 0) {
				lines.push(
					"",
					`### Unused Observations: ${signal.unusedObservations}`,
					`Never retrieved. Consider running \`/memory-compact\` to clean up.`,
				);
			}
		}

		return textResult(lines.join("\n"));
	}

	function renderExport(): ToolResult {
		const observations = getAllObservations().map((o) => ({
			id: o.id,
			type: o.type,
			title: o.title,
			subtitle: o.subtitle,
			narrative: o.narrative,
			facts: parseJsonArray(o.facts),
			concepts: parseJsonArray(o.concepts),
			files_read: parseJsonArray(o.files_read),
			files_modified: parseJsonArray(o.files_modified),
			confidence: o.confidence,
			source: o.source,
			bead_id: o.bead_id,
			supersedes: o.supersedes,
			created_at: o.created_at,
		}));
		const archive = {
			version: 3,
			exported_at: new Date().toISOString(),
			summary: { observations: observations.length },
			observations,
		};
		return textResult(JSON.stringify(archive, null, 2), { summary: archive.summary });
	}

function runImport(importJson: string, conflict: string, dryRun: boolean): ToolResult {
	if (!importJson.trim()) return textResult("❌ import_json is required.");
	if (!["skip", "create"].includes(conflict)) {
		return textResult('❌ conflict must be "skip" or "create". Overwrite was intentionally removed to avoid corrupting canonical memory.');
	}

	let data: { observations?: Array<Record<string, unknown>> };
	try {
		data = JSON.parse(importJson);
	} catch {
		return textResult("❌ import_json is not valid JSON.");
	}

	const observations = Array.isArray(data.observations) ? data.observations : [];
	const db = getMemoryDB();
	let created = 0;
	let skipped = 0;
	const errors: string[] = [];

	for (const item of observations) {
		try {
			const sourceId = typeof item.id === "number" ? item.id : undefined;
			const exists = sourceId
				? db.prepare("SELECT id FROM observations WHERE id = ?").get(sourceId) !== undefined
				: false;
			if (exists && conflict === "skip") {
				skipped++;
				continue;
			}
			if (!dryRun) {
				storeObservation({
					type: normalizeType(item.type),
					title: typeof item.title === "string" ? item.title : "Imported observation",
					subtitle: stringOrUndefined(item.subtitle),
    				narrative: stringOrUndefined(item.narrative) ?? "",
					facts: normalizeStringArray(item.facts),
					concepts: normalizeStringArray(item.concepts),
					files_read: normalizeStringArray(item.files_read),
					files_modified: normalizeStringArray(item.files_modified),
					confidence: normalizeConfidence(item.confidence),
					bead_id: stringOrUndefined(item.bead_id),
					source: "imported",
				});
			}
			created++;
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}

	const lines = [
		dryRun ? "## Import Preview" : "## Import Complete",
		`- Observations in archive: ${observations.length}`,
		`- Created: ${created}`,
		`- Skipped: ${skipped}`,
		`- Errors: ${errors.length}`,
	];
	if (errors.length) lines.push("", ...errors.slice(0, 10).map((e) => `- ${e}`));
		if (!dryRun) {
			lines.push("", "Memory index not regenerated. Run `memory-admin({operation:\"rebuild\", force:true})` to regenerate the index.");
		}
		return textResult(lines.join("\n"), { created, skipped, errors });
}


function parseJsonArray(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
}

interface MemorySignalQuality {
	totalRetrievals: number;
	helpfulCount: number;
	harmfulCount: number;
	netSignal: number;
	avgRetrievals: number;
	topRetrieved: Array<{
		id: number;
		type: string;
		title: string;
		retrieval_count: number;
		helpful_count: number;
		harmful_count: number;
	}>;
	unusedObservations: number;
}

/**
 * Compute signal-quality metrics for the memory extension.
 * Returns total retrievals, helpful/harmful counts, and the top-N retrieved
 * observations. Used by `memory-admin status` to answer Armin's challenge:
 * "have you evaluated if memory actually helps?"
 */
function getMemorySignalQuality(): MemorySignalQuality {
	const db = getMemoryDB();
	const totals = db
		.prepare(
			`SELECT
             COALESCE(SUM(retrieval_count), 0) AS total_retrievals,
             COALESCE(SUM(helpful_count), 0) AS helpful_count,
             COALESCE(SUM(harmful_count), 0) AS harmful_count,
             COUNT(*) AS total_rows,
             SUM(CASE WHEN COALESCE(retrieval_count, 0) = 0 THEN 1 ELSE 0 END) AS unused
           FROM observations
           WHERE superseded_by IS NULL`,
		)
		.get() as {
		total_retrievals: number;
		helpful_count: number;
		harmful_count: number;
		total_rows: number;
		unused: number;
	};

	const topRetrieved = db
		.prepare(
			`SELECT id, type, title, retrieval_count, helpful_count, harmful_count
           FROM observations
           WHERE superseded_by IS NULL
             AND COALESCE(retrieval_count, 0) > 0
           ORDER BY retrieval_count DESC, helpful_count DESC
           LIMIT 5`,
		)
		.all() as MemorySignalQuality["topRetrieved"];

	const totalRet = totals.total_retrievals;
	return {
		totalRetrievals: totalRet,
		helpfulCount: totals.helpful_count,
		harmfulCount: totals.harmful_count,
		netSignal: totals.helpful_count - totals.harmful_count,
		avgRetrievals: totals.total_rows > 0 ? totalRet / totals.total_rows : 0,
		topRetrieved,
		unusedObservations: totals.unused,
	};
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const items = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
		return items.length ? items : undefined;
	}
	if (typeof value === "string" && value.trim()) {
		return value.split(",").map((s) => s.trim()).filter(Boolean);
	}
	return undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeType(value: unknown): ObservationType {
	const valid: ObservationType[] = ["decision", "bugfix", "feature", "pattern", "discovery", "learning", "warning"];
	return valid.includes(value as ObservationType) ? (value as ObservationType) : "learning";
}

function normalizeConfidence(value: unknown): ConfidenceLevel {
	return value === "low" || value === "medium" || value === "high" ? value : "medium";
}
