/**
 * Memory Lint — Self-Healing Knowledge Base
 *
 * Inspired by Karpathy's LLM Wiki "lint" operation:
 * scans observations for duplicates, contradictions, stale claims,
 * orphan concepts, and missing cross-references.
 *
 * Returns structured issues for human or automated resolution.
 */

import type { ObservationRow } from "./config.js";
import { getMemoryDB } from "./db.js";
import { hasWord, parseConcepts } from "./helpers.js";

// ============================================================================
// Types
// ============================================================================

export type LintIssueType =
	| "duplicate"
	| "contradiction"
	| "stale"
	| "orphan"
	| "missing-narrative";

export interface LintIssue {
	type: LintIssueType;
	severity: "high" | "medium" | "low";
	observation_ids: number[];
	title: string;
	detail: string;
	suggestion: string;
}

export interface LintResult {
	issues: LintIssue[];
	stats: {
		total_observations: number;
		duplicates: number;
		contradictions: number;
		stale: number;
		orphans: number;
		missing_narrative: number;
	};
}

// ============================================================================
// Core Lint Operations
// ============================================================================

/**
 * Run all lint checks and return a consolidated report.
 */
export function lintMemory(options: { staleDays?: number } = {}): LintResult {
	const staleDays = options.staleDays ?? 90;
	const issues: LintIssue[] = [];

	const duplicates = findDuplicates();
	const contradictions = findContradictions();
	const stale = findStaleObservations(staleDays);
	const orphans = findOrphanObservations();
	const missing = findMissingNarratives();

	issues.push(
		...duplicates,
		...contradictions,
		...stale,
		...orphans,
		...missing,
	);

	// Count total active observations
	const db = getMemoryDB();
	const row = db
		.prepare(
			"SELECT COUNT(*) as count FROM observations WHERE superseded_by IS NULL",
		)
		.get() as { count: number };

	return {
		issues,
		stats: {
			total_observations: row.count,
			duplicates: duplicates.length,
			contradictions: contradictions.length,
			stale: stale.length,
			orphans: orphans.length,
			missing_narrative: missing.length,
		},
	};
}

/**
 * Find observations with very similar titles (potential duplicates).
 * Uses normalized title comparison + concept overlap.
 */
function findDuplicates(): LintIssue[] {
	const db = getMemoryDB();
	const issues: LintIssue[] = [];

	const observations = db
		.prepare(
			"SELECT id, type, title, concepts, narrative FROM observations WHERE superseded_by IS NULL ORDER BY created_at_epoch DESC",
		)
		.all() as Pick<
		ObservationRow,
		"id" | "type" | "title" | "concepts" | "narrative"
	>[];

	// Group by normalized title
	const titleMap = new Map<string, typeof observations>();
	for (const obs of observations) {
		const normalized = normalizeTitle(obs.title);
		const group = titleMap.get(normalized) ?? [];
		group.push(obs);
		titleMap.set(normalized, group);
	}

	for (const [normalized, group] of titleMap) {
		if (group.length > 1) {
			issues.push({
				type: "duplicate",
				severity: "medium",
				observation_ids: group.map((o) => o.id),
				title: `Duplicate: "${group[0].title}"`,
				detail: `${group.length} observations with similar title "${normalized}": IDs ${group.map((o) => `#${o.id}`).join(", ")}`,
				suggestion: `Use \`observation({ supersedes: "${group[group.length - 1].id}" })\` to merge, keeping the most recent.`,
			});
		}
	}

	// Also check concept overlap for same-type observations
	const byType = new Map<string, typeof observations>();
	for (const obs of observations) {
		if (!obs.concepts) continue;
		const group = byType.get(obs.type) ?? [];
		group.push(obs);
		byType.set(obs.type, group);
	}

	for (const [, group] of byType) {
		for (let i = 0; i < group.length; i++) {
			for (let j = i + 1; j < group.length; j++) {
				const overlap = conceptOverlap(group[i].concepts, group[j].concepts);
				if (overlap > 0.8 && group[i].id !== group[j].id) {
					// Check not already flagged by title
					const alreadyFlagged = issues.some(
						(iss) =>
							iss.type === "duplicate" &&
							iss.observation_ids.includes(group[i].id) &&
							iss.observation_ids.includes(group[j].id),
					);
					if (!alreadyFlagged) {
						issues.push({
							type: "duplicate",
							severity: "low",
							observation_ids: [group[i].id, group[j].id],
							title: `High concept overlap: #${group[i].id} ↔ #${group[j].id}`,
							detail: `"${group[i].title}" and "${group[j].title}" share ${(overlap * 100).toFixed(0)}% concepts`,
							suggestion: `Review if these should be merged with \`supersedes\`.`,
						});
					}
				}
			}
		}
	}

	return issues;
}

/**
 * Find observations of the same type/concepts that may contradict each other.
 * Looks for opposing signal words in narratives.
 */
function findContradictions(): LintIssue[] {
	const db = getMemoryDB();
	const issues: LintIssue[] = [];

	// Get decision-type observations that share concepts
	const decisions = db
		.prepare(
			`SELECT id, title, concepts, narrative FROM observations
			 WHERE type = 'decision' AND superseded_by IS NULL AND concepts IS NOT NULL`,
		)
		.all() as Pick<ObservationRow, "id" | "title" | "concepts" | "narrative">[];

	// Check pairs for contradictory language
	const contradictionPairs = [
		["use", "don't use"],
		["enable", "disable"],
		["add", "remove"],
		["prefer", "avoid"],
		["always", "never"],
		["yes", "no"],
	];

	for (let i = 0; i < decisions.length; i++) {
		for (let j = i + 1; j < decisions.length; j++) {
			const overlap = conceptOverlap(
				decisions[i].concepts,
				decisions[j].concepts,
			);
			if (overlap < 0.3) continue; // Unrelated decisions

			const textA =
				`${decisions[i].title} ${decisions[i].narrative ?? ""}`.toLowerCase();
			const textB =
				`${decisions[j].title} ${decisions[j].narrative ?? ""}`.toLowerCase();

			for (const [wordA, wordB] of contradictionPairs) {
				if (
					(hasWord(textA, wordA) && hasWord(textB, wordB)) ||
					(hasWord(textA, wordB) && hasWord(textB, wordA))
				) {
					issues.push({
						type: "contradiction",
						severity: "high",
						observation_ids: [decisions[i].id, decisions[j].id],
						title: `Potential contradiction: #${decisions[i].id} vs #${decisions[j].id}`,
						detail: `"${decisions[i].title}" and "${decisions[j].title}" share concepts but contain opposing signals ("${wordA}" vs "${wordB}")`,
						suggestion: `Review both and supersede the outdated one.`,
					});
					break; // One contradiction signal per pair is enough
				}
			}
		}
	}

	return issues;
}

/**
 * Find observations older than N days with no references in recent distillations.
 */
function findStaleObservations(staleDays: number): LintIssue[] {
	const db = getMemoryDB();
	const cutoffEpoch = Date.now() - staleDays * 24 * 60 * 60 * 1000;

	const stale = db
		.prepare(
			`SELECT id, type, title, created_at, created_at_epoch FROM observations
			 WHERE superseded_by IS NULL AND created_at_epoch < ? AND valid_until IS NULL
			 ORDER BY created_at_epoch ASC`,
		)
		.all(cutoffEpoch) as Pick<
		ObservationRow,
		"id" | "type" | "title" | "created_at" | "created_at_epoch"
	>[];

	return stale.map((obs) => {
		const ageDays = Math.floor(
			(Date.now() - obs.created_at_epoch) / (1000 * 60 * 60 * 24),
		);
		return {
			type: "stale" as const,
			severity:
				ageDays > staleDays * 2 ? ("high" as const) : ("medium" as const),
			observation_ids: [obs.id],
			title: `Stale (${ageDays}d): #${obs.id} "${obs.title}"`,
			detail: `[${obs.type}] created ${obs.created_at.slice(0, 10)}, ${ageDays} days old with no valid_until set`,
			suggestion: `Review: still relevant? If yes, update it. If no, supersede or set valid_until.`,
		};
	});
}

/**
 * Find observations with concepts that appear in only one observation.
 * These are "orphan concepts" — knowledge islands with no connections.
 */
function findOrphanObservations(): LintIssue[] {
	const db = getMemoryDB();
	const issues: LintIssue[] = [];

	const observations = db
		.prepare(
			"SELECT id, title, concepts FROM observations WHERE superseded_by IS NULL AND concepts IS NOT NULL",
		)
		.all() as Pick<ObservationRow, "id" | "title" | "concepts">[];

	// Build concept → observation IDs map
	const conceptMap = new Map<string, number[]>();
	for (const obs of observations) {
		const concepts = parseConcepts(obs.concepts);
		for (const concept of concepts) {
			const ids = conceptMap.get(concept) ?? [];
			ids.push(obs.id);
			conceptMap.set(concept, ids);
		}
	}

	// Find observations where ALL concepts are orphans (only appear once)
	for (const obs of observations) {
		const concepts = parseConcepts(obs.concepts);
		if (concepts.length === 0) continue;
		const allOrphan = concepts.every(
			(c) => (conceptMap.get(c)?.length ?? 0) <= 1,
		);
		if (allOrphan && concepts.length >= 2) {
			issues.push({
				type: "orphan",
				severity: "low",
				observation_ids: [obs.id],
				title: `Isolated: #${obs.id} "${obs.title}"`,
				detail: `All concepts [${concepts.join(", ")}] appear in no other observation — this knowledge is disconnected`,
				suggestion: `Consider adding cross-references or broadening concept tags.`,
			});
		}
	}

	return issues;
}

/**
 * Find observations with no narrative (title-only, low value).
 */
function findMissingNarratives(): LintIssue[] {
	const db = getMemoryDB();

	const missing = db
		.prepare(
			`SELECT id, type, title FROM observations
			 WHERE superseded_by IS NULL AND (narrative IS NULL OR narrative = '')`,
		)
		.all() as Pick<ObservationRow, "id" | "type" | "title">[];

	return missing.map((obs) => ({
		type: "missing-narrative" as const,
		severity: "low" as const,
		observation_ids: [obs.id],
		title: `No narrative: #${obs.id} "${obs.title}"`,
		detail: `[${obs.type}] has title but no narrative — low-value observation`,
		suggestion: `Add narrative context or remove if the title alone is not useful.`,
	}));
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function conceptOverlap(a: string | null, b: string | null): number {
	const conceptsA = new Set(parseConcepts(a));
	const conceptsB = new Set(parseConcepts(b));
	if (conceptsA.size === 0 || conceptsB.size === 0) return 0;

	let overlap = 0;
	for (const c of conceptsA) {
		if (conceptsB.has(c)) overlap++;
	}
	return overlap / Math.min(conceptsA.size, conceptsB.size);
}
