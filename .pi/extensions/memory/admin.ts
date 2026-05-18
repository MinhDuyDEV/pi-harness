import { Type } from "@sinclair/typebox";

import { generateMemoryIndex } from "./index-generator.js";
import {
	archiveOldObservations,
	checkFTS5Available,
	getDatabaseSizes,
	runFullMaintenance,
	upsertMemoryFile,
} from "./maintenance.js";
import {
	getAllObservations,
	getObservationStats,
	storeObservation,
} from "./observations.js";
import { readPersona, generatePersona } from "./persona.js";
import { getCaptureStats, getDistillationStats } from "./pipeline.js";
import { refreshAllScores } from "./scoring.js";
import { detectAndStoreScenes, listScenes } from "./scene.js";
import { getMemoryDB, isSqliteVecAvailable } from "./db.js";
import type { ConfidenceLevel, ObservationType } from "./config.js";

export const MEMORY_ADMIN_OPERATIONS = [
	"status",
	"dashboard",
	"export",
	"import",
	"rebuild",
	"maintenance",
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
		description: "Required for mutating operations: import, rebuild, maintenance.",
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
					return textResult("## Rebuild Preview\nWould refresh scores, regenerate persona, scenes, and memory index.");
				}
				const scores = refreshAllScores();
				const persona = generatePersona("default");
				const scenes = detectAndStoreScenes();
				const index = generateMemoryIndex();
				return textResult([
					"## Memory Rebuild Complete",
					`- Scores refreshed: ${scores.updated} updated, ${scores.deprecated} deprecated`,
					`- Persona: ${persona ? "generated" : "not enough signal"}`,
					`- Scenes: ${scenes}`,
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
					`- Purged temporal messages: ${stats.purgedMessages}`,
					`- Pruned markdown files: ${stats.prunedMarkdown}`,
					`- WAL checkpointed: ${stats.checkpointed ? "yes" : "no"}`,
					`- Vacuumed: ${stats.vacuumed ? "yes" : "no"}`,
					`- Freed: ${formatBytes(stats.freedBytes)}`,
				].join("\n"));
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
	const captureStats = getCaptureStats();
	const distStats = getDistillationStats();
	const obsTotal = Object.values(obsStats).reduce((sum, n) => sum + n, 0);
	const scenes = listScenes();

	const lines = [
		includeDetails ? "## Memory Dashboard" : "## Memory Status",
		"",
		`- Observations: ${obsTotal}`,
		`- Temporal messages: ${captureStats.total} (${captureStats.undistilled} undistilled)` ,
		`- Distillations: ${distStats.total}`,
		`- Scenes: ${scenes.length}`,
		`- DB: ${formatBytes(sizes.total)} (WAL ${formatBytes(sizes.wal)})`,
		`- FTS5: ${checkFTS5Available() ? "available" : "unavailable"}`,
		`- Vector search: ${isSqliteVecAvailable() ? "available" : "unavailable"}`,
		`- Storage: SQLite (canonical)`,
	];

	if (includeDetails) {
		lines.push("", "### Observation Types");
		for (const [type, count] of Object.entries(obsStats)) lines.push(`- ${type}: ${count}`);
		lines.push("", "### Top Scenes");
		if (scenes.length === 0) lines.push("- none");
		for (const scene of scenes.slice(0, 5)) {
			lines.push(`- ${scene.name} (${scene.count} obs, score ${scene.score.toFixed(2)})`);
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
		maturity: o.maturity,
		source: o.source,
		bead_id: o.bead_id,
		supersedes: o.supersedes,
		created_at: o.created_at,
	}));
	const scenes = listScenes();
	const persona = readPersona("default");
	const archive = {
		version: 2,
		exported_at: new Date().toISOString(),
		summary: { observations: observations.length, scenes: scenes.length, persona: persona !== null },
		observations,
		derived: { persona, scenes },
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
					narrative: stringOrUndefined(item.narrative),
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
		lines.push("", "Derived memory files were not imported. Run `memory-admin({operation:\"rebuild\", force:true})` to regenerate persona/scenes/index.");
	}
	return textResult(lines.join("\n"), { created, skipped, errors });
}


function parseJsonArray(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
	} catch {
		return [];
	}
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
