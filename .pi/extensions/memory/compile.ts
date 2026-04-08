/**
 * Memory Compilation — Observations → Structured Articles
 *
 * Inspired by Karpathy's LLM Wiki "compilation" layer:
 * reads clusters of related observations and produces structured
 * summary articles with cross-references. This is the missing 5th stage:
 *
 * capture → distill → curate → **compile** → inject
 *
 * Unlike Karpathy's approach (which uses LLM for compilation), this
 * implementation uses pure heuristics — grouping by concept clusters,
 * ranking by confidence/recency, and templated article generation.
 *
 * For LLM-powered compilation, use the compile admin operation which
 * generates articles the agent can review and edit.
 */

import type { ObservationRow } from "./config.js";
import { getMemoryDB } from "./db.js";
import { TYPE_ICONS, parseConcepts } from "./helpers.js";
import { upsertMemoryFile } from "./maintenance.js";
import { appendOperationLog } from "./operation-log.js";

// ============================================================================
// Types
// ============================================================================

export interface ConceptCluster {
	concept: string;
	observations: Pick<
		ObservationRow,
		"id" | "type" | "title" | "narrative" | "confidence" | "created_at"
	>[];
	relatedConcepts: string[];
}

export interface CompiledArticle {
	concept: string;
	content: string;
	observationCount: number;
	relatedConcepts: string[];
}

export interface CompileResult {
	articles: CompiledArticle[];
	totalObservations: number;
	skippedClusters: number;
}

// ============================================================================
// Compilation Operations
// ============================================================================

/**
 * Compile observations into structured articles grouped by concept.
 * Only generates articles for concepts with `minObservations` or more observations.
 * Stores articles in memory_files as "compiled/{concept}".
 */
export function compileObservations(
	options: { minObservations?: number; maxArticles?: number } = {},
): CompileResult {
	const minObs = options.minObservations ?? 3;
	const maxArticles = options.maxArticles ?? 20;

	const clusters = buildConceptClusters(minObs);
	const articles: CompiledArticle[] = [];
	let skipped = 0;

	// Sort clusters by observation count (most connected first)
	const sortedClusters = clusters
		.sort((a, b) => b.observations.length - a.observations.length)
		.slice(0, maxArticles);

	let totalObservations = 0;

	for (const cluster of sortedClusters) {
		const article = compileCluster(cluster);
		if (article) {
			articles.push(article);
			totalObservations += article.observationCount;
			// Store in memory_files
			const safeName = cluster.concept.replace(/[^a-z0-9-]/g, "-");
			upsertMemoryFile(`compiled/${safeName}`, article.content, "replace");
		} else {
			skipped++;
		}
	}

	// Log the operation
	appendOperationLog({
		operation: "compile-run",
		targets: articles.map((a) => a.concept),
		summary: `Compiled ${articles.length} articles from ${totalObservations} observations (${skipped} clusters skipped)`,
	});

	return { articles, totalObservations, skippedClusters: skipped };
}

// ============================================================================
// Internal
// ============================================================================

/**
 * Build concept clusters from active observations.
 */
function buildConceptClusters(minObservations: number): ConceptCluster[] {
	const db = getMemoryDB();

	const observations = db
		.prepare(
			`SELECT id, type, title, narrative, concepts, confidence, created_at
			 FROM observations
			 WHERE superseded_by IS NULL AND concepts IS NOT NULL
			 ORDER BY created_at_epoch DESC`,
		)
		.all() as Pick<
		ObservationRow,
		| "id"
		| "type"
		| "title"
		| "narrative"
		| "concepts"
		| "confidence"
		| "created_at"
	>[];

	// Build concept → observations map
	const conceptMap = new Map<string, typeof observations>();

	for (const obs of observations) {
		const concepts = parseConcepts(obs.concepts);
		for (const concept of concepts) {
			const group = conceptMap.get(concept) ?? [];
			group.push(obs);
			conceptMap.set(concept, group);
		}
	}

	// Filter to clusters with enough observations
	const clusters: ConceptCluster[] = [];
	for (const [concept, obsGroup] of conceptMap) {
		if (obsGroup.length < minObservations) continue;

		// Find related concepts (co-occurring)
		const relatedCounts = new Map<string, number>();
		for (const obs of obsGroup) {
			const concepts = parseConcepts(obs.concepts);
			for (const c of concepts) {
				if (c === concept) continue;
				relatedCounts.set(c, (relatedCounts.get(c) ?? 0) + 1);
			}
		}
		const relatedConcepts = [...relatedCounts.entries()]
			.filter(([, count]) => count >= 2)
			.sort((a, b) => b[1] - a[1])
			.map(([c]) => c);

		clusters.push({
			concept,
			observations: obsGroup,
			relatedConcepts,
		});
	}

	return clusters;
}

/**
 * Compile a single concept cluster into a markdown article.
 */
function compileCluster(cluster: ConceptCluster): CompiledArticle | null {
	if (cluster.observations.length === 0) return null;

	const lines: string[] = [];

	// Header
	lines.push(`# ${cluster.concept}`);
	lines.push("");
	lines.push(`> Compiled from ${cluster.observations.length} observations.`);
	lines.push(`> Last compiled: ${new Date().toISOString().slice(0, 19)}`);

	// Related concepts
	if (cluster.relatedConcepts.length > 0) {
		lines.push(`> Related: ${cluster.relatedConcepts.join(", ")}`);
	}
	lines.push("");

	// Group observations by type for structure
	const byType = new Map<string, typeof cluster.observations>();
	for (const obs of cluster.observations) {
		const group = byType.get(obs.type) ?? [];
		group.push(obs);
		byType.set(obs.type, group);
	}

	// Decisions first (most important)
	const typeOrder = [
		"decision",
		"pattern",
		"warning",
		"bugfix",
		"discovery",
		"feature",
		"learning",
	];
	for (const type of typeOrder) {
		const group = byType.get(type);
		if (!group || group.length === 0) continue;

		const icon = TYPE_ICONS[type] ?? "📌";
		const heading = type.charAt(0).toUpperCase() + type.slice(1);
		lines.push(`## ${icon} ${heading}s`);
		lines.push("");

		for (const obs of group) {
			lines.push(`### #${obs.id}: ${obs.title}`);
			if (obs.narrative) {
				// Truncate long narratives for the compiled view
				const narrative =
					obs.narrative.length > 500
						? `${obs.narrative.slice(0, 500)}...`
						: obs.narrative;
				lines.push("");
				lines.push(narrative);
			}
			lines.push("");
			lines.push(
				`_Confidence: ${obs.confidence} | Created: ${obs.created_at.slice(0, 10)}_`,
			);
			lines.push("");
		}
	}

	// Cross-reference footer
	lines.push("---");
	lines.push("");
	lines.push(
		`**Source observations:** ${cluster.observations.map((o) => `#${o.id}`).join(", ")}`,
	);
	if (cluster.relatedConcepts.length > 0) {
		lines.push(
			`**See also:** ${cluster.relatedConcepts.map((c) => `[[${c}]]`).join(", ")}`,
		);
	}

	return {
		concept: cluster.concept,
		content: lines.join("\n"),
		observationCount: cluster.observations.length,
		relatedConcepts: cluster.relatedConcepts,
	};
}
