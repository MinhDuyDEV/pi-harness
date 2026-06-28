/**
 * Memory Index Generator — Auto-Generated Knowledge Catalog
 *
 * Inspired by Karpathy's LLM Wiki index.md:
 * generates a structured catalog of all observations, grouped by type,
 * with cross-references and concept clusters.
 *
 * Stored in memory_files as "index" for injection or on-demand reading.
 */

import type { ObservationRow } from "./config.js";
import { getMemoryDB } from "./db.js";
import { parseConcepts } from "./helpers.js";
import { upsertMemoryFile } from "./storage.js";

// ============================================================================
// Types
// ============================================================================

export interface IndexEntry {
	id: number;
	type: string;
	title: string;
	concepts: string[];
	created_at: string;
}

export interface IndexResult {
	entryCount: number;
	conceptCount: number;
	content: string;
}

// ============================================================================
// Index Generation
// ============================================================================

/**
 * Generate a comprehensive index of all active observations.
 * Groups by type, lists concept clusters, and writes to memory_files.
 */
export function generateMemoryIndex(): IndexResult {
	const db = getMemoryDB();

	const observations = db
		.prepare(
			`SELECT id, type, title, concepts, created_at FROM observations
			 WHERE superseded_by IS NULL
			 ORDER BY type, created_at_epoch DESC`,
		)
		.all() as Pick<
		ObservationRow,
		"id" | "type" | "title" | "concepts" | "created_at"
	>[];

	// Group by type
	const byType = new Map<string, IndexEntry[]>();
	const allConcepts = new Map<string, number[]>();

	for (const obs of observations) {
		const entry: IndexEntry = {
			id: obs.id,
			type: obs.type,
			title: obs.title,
			concepts: parseConcepts(obs.concepts),
			created_at: obs.created_at,
		};

		const group = byType.get(obs.type) ?? [];
		group.push(entry);
		byType.set(obs.type, group);

		for (const concept of entry.concepts) {
			const ids = allConcepts.get(concept) ?? [];
			ids.push(obs.id);
			allConcepts.set(concept, ids);
		}
	}

	// Build markdown
	const lines: string[] = [];
	lines.push("# Memory Index");
	lines.push("");
	lines.push(
		`> Auto-generated catalog of ${observations.length} active observations.`,
	);
	lines.push(`> Last updated: ${new Date().toISOString().slice(0, 19)}`);
	lines.push("");

	// Summary table
	lines.push("## Summary");
	lines.push("");
	lines.push("| Type | Count |");
	lines.push("|------|-------|");
	for (const [type, entries] of byType) {
		lines.push(`| ${type} | ${entries.length} |`);
	}
	lines.push(`| **Total** | **${observations.length}** |`);
	lines.push("");

	// By type
	for (const [type, entries] of byType) {
		lines.push(
			`## ${type.charAt(0).toUpperCase() + type.slice(1)} (${entries.length})`,
		);
		lines.push("");
		for (const entry of entries) {
			const concepts =
				entry.concepts.length > 0 ? ` [${entry.concepts.join(", ")}]` : "";
			lines.push(
				`- **#${entry.id}** ${entry.title}${concepts} _(${entry.created_at.slice(0, 10)})_`,
			);
		}
		lines.push("");
	}

	// Concept clusters
	const significantConcepts = [...allConcepts.entries()]
		.filter(([, ids]) => ids.length >= 2)
		.sort((a, b) => b[1].length - a[1].length);

	if (significantConcepts.length > 0) {
		lines.push("## Concept Clusters");
		lines.push("");
		lines.push("Concepts appearing in 2+ observations:");
		lines.push("");
		for (const [concept, ids] of significantConcepts.slice(0, 30)) {
			lines.push(
				`- **${concept}** (${ids.length}): ${ids.map((id) => `#${id}`).join(", ")}`,
			);
		}
		lines.push("");
	}

	// Orphan concepts
	const orphanConcepts = [...allConcepts.entries()].filter(
		([, ids]) => ids.length === 1,
	);

	if (orphanConcepts.length > 0) {
		lines.push("## Orphan Concepts");
		lines.push("");
		lines.push(
			`${orphanConcepts.length} concepts appear in only 1 observation:`,
		);
		lines.push("");
		const orphanList = orphanConcepts
			.slice(0, 20)
			.map(([concept, ids]) => `${concept} (#${ids[0]})`);
		lines.push(orphanList.join(", "));
		if (orphanConcepts.length > 20) {
			lines.push(`... and ${orphanConcepts.length - 20} more`);
		}
		lines.push("");
	}

	const content = lines.join("\n");

	// Store in memory_files
	upsertMemoryFile("index", content, "replace");

	return {
		entryCount: observations.length,
		conceptCount: allConcepts.size,
		content,
	};
}
