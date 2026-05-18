/**
 * L3 Persona Generator — User Profile from Observations
 *
 * Reads observations weighted by effective_score + recency, groups
 * by concept clusters, and generates a human-readable Markdown persona.
 *
 * Design:
 *   - Scans all non-deprecated observations
 *   - Groups by concept (recurring topics → work patterns)
 *   - Infers: preferred tools, communication style, domain focus, workflow patterns
 *   - Generates Markdown persona stored via upsertMemoryFile
 *   - Regenerated on each pipeline pass (incremental)
 *
 * Output stored in memory_files: "persona/{user}"
 */

import {
	type ObservationRow,
	type ObservationType,
	MEMORY_CONFIG,
} from "./config.js";
import { getMemoryDB } from "./db.js";
import { parseConcepts, TYPE_ICONS } from "./helpers.js";
import { upsertMemoryFile, getMemoryFile } from "./maintenance.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonaObservation {
	id: number;
	type: ObservationType;
	title: string;
	narrative: string | null;
	concepts: string[];
	files_modified: string[];
	confidence: string;
	effective_score: number;
	retrieval_count: number;
	created_at_epoch: number;
}

export interface PersonaProfile {
	/** Primary user identifier */
	userId: string;
	/** When the persona was generated */
	generatedAt: string;
	/** Total observations contributing */
	observationCount: number;
	/** Inferred work domains (concept clusters with high weight) */
	domains: Array<{ name: string; weight: number; observationCount: number }>;
	/** Preferred tools / technologies (from files_modified) */
	preferredTools: Array<{ name: string; freq: number }>;
	/** Communication style signals */
	communicationStyle: {
		prefersDetailed: boolean;
		prefersShort: boolean;
		usesFormatting: boolean;
		dominantTypes: Array<{ type: string; count: number }>;
	};
	/** Recurring workflow patterns */
	workflowPatterns: Array<{
		concept: string;
		type: string;
		count: number;
		examples: string[];
	}>;
	/** Top decisions */
	keyDecisions: Array<{ title: string; score: number; created: string }>;
}

// ---------------------------------------------------------------------------
// Persona Generator
// ---------------------------------------------------------------------------

/**
 * Build a persona profile for a user ID from observations.
 * Queries the database, scores and clusters, returns structured profile.
 */
export function buildPersona(userId: string = "default"): PersonaProfile {
	const db = getMemoryDB();

	// Fetch all active (non-deprecated, non-superseded) observations
	const rows = db
		.prepare(
			`SELECT id, type, title, narrative, concepts, files_modified,
              confidence, effective_score, retrieval_count, created_at_epoch
       FROM observations
       WHERE superseded_by IS NULL AND maturity != 'deprecated'
       ORDER BY effective_score DESC, created_at_epoch DESC`,
		)
		.all() as Array<{
		id: number;
		type: string;
		title: string;
		narrative: string | null;
		concepts: string | null;
		files_modified: string | null;
		confidence: string;
		effective_score: number;
		retrieval_count: number;
		created_at_epoch: number;
	}>;

	const observations: PersonaObservation[] = rows.map((r) => ({
		...r,
		type: r.type as ObservationType,
		concepts: parseConcepts(r.concepts),
		files_modified: parseFilesModified(r.files_modified),
	}));

	// --- Build concept clusters (weighted) ---
	const conceptMap = new Map<
		string,
		{ sumWeight: number; count: number; observations: PersonaObservation[] }
	>();
	const toolMap = new Map<string, number>();
	const typeCount = new Map<string, number>();
	const decisions: Array<{ title: string; score: number; created: string }> = [];

	for (const obs of observations) {
		// Compute weight: effective_score (0-10 scale) × recency (0-1)
		const ageDays = (Date.now() - obs.created_at_epoch) / 86_400_000;
		const recencyFactor = Math.max(0, 1 - ageDays / 180); // linear decay over 6 months
		const weight = Math.max(0, obs.effective_score) * recencyFactor + 0.1;

		if (obs.type === "decision") {
			decisions.push({
				title: obs.title,
				score: weight,
				created: new Date(obs.created_at_epoch).toISOString().slice(0, 10),
			});
		}

		// Track type distribution (communication style)
		typeCount.set(obs.type, (typeCount.get(obs.type) ?? 0) + 1);

		for (const concept of obs.concepts) {
			const entry = conceptMap.get(concept) ?? {
				sumWeight: 0,
				count: 0,
				observations: [],
			};
			entry.sumWeight += weight;
			entry.count++;
			entry.observations.push(obs);
			conceptMap.set(concept, entry);
		}

		for (const file of obs.files_modified) {
			// Extract technology/filetype from path
			const tech = inferTechnology(file);
			toolMap.set(tech, (toolMap.get(tech) ?? 0) + 1);
		}
	}

	// --- Build domains from concept clusters ---
	const domains: PersonaProfile["domains"] = [...conceptMap.entries()]
		.filter(([, entry]) => entry.count >= 2)
		.sort((a, b) => b[1].sumWeight - a[1].sumWeight)
		.slice(0, 20)
		.map(([name, entry]) => ({
			name,
			weight: entry.sumWeight,
			observationCount: entry.count,
		}));

	// --- Build tools list ---
	const preferredTools: PersonaProfile["preferredTools"] = [...toolMap.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 15)
		.map(([name, freq]) => ({ name, freq }));

	// --- Build workflow patterns ---
	const workflowPatterns: PersonaProfile["workflowPatterns"] = [
		...conceptMap.entries(),
	]
		.filter(([, entry]) => {
			// A pattern cluster has ≥2 obs and at least one pattern-type or recurring discovery
			const typeSet = new Set(entry.observations.map((o) => o.type));
			return entry.count >= 2 && (typeSet.has("pattern") || entry.sumWeight > 2);
		})
		.sort((a, b) => b[1].sumWeight - a[1].sumWeight)
		.slice(0, 10)
		.map(([concept, entry]) => {
			const typeCounts = new Map<string, number>();
			for (const obs of entry.observations) {
				typeCounts.set(obs.type, (typeCounts.get(obs.type) ?? 0) + 1);
			}
			const dominantType = [...typeCounts.entries()].sort(
				(a, b) => b[1] - a[1],
			)[0]?.[0] ?? "observation";
			return {
				concept,
				type: dominantType,
				count: entry.count,
				examples: entry.observations
					.sort((a, b) => b.effective_score - a.effective_score)
					.slice(0, 3)
					.map((o) => o.title),
			};
		});

	// --- Communication style ---
	const dominantTypes = [...typeCount.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([type, count]) => ({ type, count }));

	const prefersDetailed = observations.some(
		(o) => (o.narrative?.length ?? 0) > 200,
	);
	const prefersShort = observations.some(
		(o) => o.narrative === null || (o.narrative?.length ?? 0) < 50,
	);
	const usesFormatting = observations.some(
		(o) => o.narrative?.includes("\n") && o.narrative.length > 100,
	);

	const communicationStyle = {
		prefersDetailed,
		prefersShort,
		usesFormatting,
		dominantTypes,
	};

	return {
		userId,
		generatedAt: new Date().toISOString(),
		observationCount: observations.length,
		domains,
		preferredTools,
		communicationStyle,
		workflowPatterns,
		keyDecisions: decisions.sort((a, b) => b.score - a.score).slice(0, 10),
	};
}

// ---------------------------------------------------------------------------
// Persona Markdown Rendering
// ---------------------------------------------------------------------------

/**
 * Render a PersonaProfile to Markdown for human+agent reading.
 */
export function renderPersonaToMarkdown(profile: PersonaProfile): string {
	const lines: string[] = [];

	lines.push(`# Persona: ${profile.userId}`);
	lines.push("");
	lines.push(
		`> Generated from ${profile.observationCount} observations on ${profile.generatedAt.slice(0, 19)}.`,
	);
	lines.push(`> Auto-updated as new observations are captured.`);
	lines.push("");

	// --- Overview ---
	lines.push("## Overview");
	lines.push("");
	if (profile.domains.length > 0) {
		const top = profile.domains.slice(0, 5).map((d) => d.name);
		lines.push(`**Primary domains:** ${top.join(", ")}`);
	}
	const styleParts: string[] = [];
	if (profile.communicationStyle.prefersDetailed)
		styleParts.push("detailed context");
	if (profile.communicationStyle.prefersShort) styleParts.push("also concise");
	if (profile.communicationStyle.usesFormatting)
		styleParts.push("structured formatting");
	if (styleParts.length > 0)
		lines.push(`**Communication:** prefers ${styleParts.join(", ")}`);
	lines.push("");

	// --- Domains (Concept Clusters) ---
	if (profile.domains.length > 0) {
		lines.push("## Active Domains");
		lines.push("");
		lines.push("| Domain | Weight | Observations |");
		lines.push("|--------|--------|-------------|");
		for (const domain of profile.domains.slice(0, 15)) {
			lines.push(
				`| ${domain.name} | ${domain.weight.toFixed(1)} | ${domain.observationCount} |`,
			);
		}
		lines.push("");
	}

	// --- Preferred Tools ---
	if (profile.preferredTools.length > 0) {
		lines.push("## Preferred Tools & Technologies");
		lines.push("");
		for (const tool of profile.preferredTools) {
			const bar = "█".repeat(Math.min(tool.freq, 10));
			lines.push(`- **${tool.name}** ${bar} (${tool.freq}x)`);
		}
		lines.push("");
	}

	// --- Workflow Patterns ---
	if (profile.workflowPatterns.length > 0) {
		lines.push("## Workflow Patterns");
		lines.push("");
		lines.push("Recurring work patterns observed across sessions:");
		lines.push("");
		for (const pattern of profile.workflowPatterns) {
			const icon = TYPE_ICONS[pattern.type] ?? "📌";
			lines.push(`### ${icon} ${pattern.concept}`);
			lines.push(`_${pattern.count} observations_`);
			if (pattern.examples.length > 0) {
				for (const ex of pattern.examples) {
					lines.push(`- ${ex}`);
				}
			}
			lines.push("");
		}
	}

	// --- Key Decisions ---
	if (profile.keyDecisions.length > 0) {
		lines.push("## Key Decisions");
		lines.push("");
		for (const dec of profile.keyDecisions) {
			lines.push(`- **${dec.title}** _(${dec.created}, score: ${dec.score.toFixed(2)})_`);
		}
		lines.push("");
	}

	// --- Communication Style ---
	if (profile.communicationStyle.dominantTypes.length > 0) {
		lines.push("## Communication Profile");
		lines.push("");
		lines.push("| Type | Count |");
		lines.push("|------|-------|");
		for (const t of profile.communicationStyle.dominantTypes) {
			const icon = TYPE_ICONS[t.type] ?? "📌";
			lines.push(`| ${icon} ${t.type} | ${t.count} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate and persist the persona for a user.
 * Stores via upsertMemoryFile as "persona/{userId}".
 * Safe to call on every pipeline pass (idempotent).
 */
export function generatePersona(userId: string = "default"): PersonaProfile {
	const profile = buildPersona(userId);
	const markdown = renderPersonaToMarkdown(profile);
	upsertMemoryFile(`persona/${userId}`, markdown, "replace");
	return profile;
}

/**
 * Read the currently stored persona Markdown for a user.
 * Returns null if no persona has been generated yet.
 */
export function readPersona(userId: string = "default"): string | null {
	const row = getMemoryFile(`persona/${userId}`);
	return row?.content ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the files_modified JSON/CSV field into a clean string array.
 */
function parseFilesModified(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed.map(String);
	} catch {
		// fall through to CSV split
	}
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Infer a technology/domain name from a file path.
 * e.g. "src/auth/login.ts" → "TypeScript/Auth"
 *       "Dockerfile" → "Docker"
 *       "package.json" → "Node.js"
 */
function inferTechnology(filePath: string): string {
	const lower = filePath.toLowerCase();

	if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
		if (lower.includes("test") || lower.includes("spec")) return "Testing";
		if (lower.includes("pipeline") || lower.includes("distill") || lower.includes("curat"))
			return "Memory System";
		if (lower.includes("dcp") || lower.includes("compact")) return "Context Management";
		return "TypeScript";
	}
	if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "JavaScript";
	if (lower.endsWith(".py")) return "Python";
	if (lower.endsWith(".rs")) return "Rust";
	if (lower.endsWith(".go")) return "Go";
	if (lower.endsWith(".sql")) return "SQL";
	if (lower.endsWith(".sh")) return "Shell";
	if (lower.endsWith(".md")) {
		if (lower.includes("changelog") || lower.includes("readme")) return "Documentation";
		if (lower.includes("skill")) return "Skills";
		return "Markdown";
	}
	if (lower.endsWith(".json")) {
		if (lower.includes("package")) return "Node.js";
		return "JSON Config";
	}
	if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "YAML Config";
	if (lower.endsWith(".css") || lower.endsWith(".scss")) return "CSS/Styles";
	if (lower.includes("dockerfile") || lower.endsWith(".dockerfile")) return "Docker";
	if (lower.includes("makefile") || lower.endsWith(".mk")) return "Make";
	if (lower.includes(".github") || lower.includes("workflow")) return "CI/CD";

	// Extract extension or directory-based name
	const ext = filePath.split("/").pop()?.split(".").pop();
	if (ext) return ext.toUpperCase();

	return "Other";
}
