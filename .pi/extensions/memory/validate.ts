/**
 * Observation Validation Gate
 *
 * Inspired by jumperz's Secondmate Hermes validation:
 * checks for duplicates and contradictions BEFORE storing an observation.
 *
 * Unlike Secondmate's approach (separate LLM model), this uses
 * FTS5 similarity search + heuristic contradiction detection.
 *
 * Returns a validation result that can:
 * - PASS: store normally
 * - WARN: store but flag issues
 * - REJECT: don't store, return reason
 */

import type { ObservationInput, ObservationRow } from "./config.js";
import { getMemoryDB } from "./db.js";
import { hasWord } from "./helpers.js";
import { appendOperationLog } from "./operation-log.js";

// ============================================================================
// Types
// ============================================================================

export type ValidationVerdict = "pass" | "warn" | "reject";

export interface ValidationResult {
	verdict: ValidationVerdict;
	issues: ValidationIssue[];
	/** If a near-duplicate was found, its ID */
	duplicateOf?: number;
}

export interface ValidationIssue {
	type: "duplicate" | "near-duplicate" | "contradiction" | "low-quality";
	severity: "high" | "medium" | "low";
	message: string;
	relatedId?: number;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate an observation before storing.
 * Returns verdict (pass/warn/reject) with issues.
 */
export function validateObservation(input: ObservationInput): ValidationResult {
	const issues: ValidationIssue[] = [];

	// Check 1: Exact title duplicate
	const exactDup = findExactDuplicate(input);
	if (exactDup) {
		// If it's explicitly superseding, that's fine
		if (input.supersedes === exactDup.id) {
			// Intentional supersede — pass
		} else {
			issues.push({
				type: "duplicate",
				severity: "high",
				message: `Exact duplicate of #${exactDup.id}: "${exactDup.title}"`,
				relatedId: exactDup.id,
			});

			appendOperationLog({
				operation: "observation-duplicate-warning",
				targets: [`#${exactDup.id}`],
				summary: `Duplicate warning: "${input.title}" (matches #${exactDup.id})`,
			});

			return {
				verdict: "warn",
				issues,
				duplicateOf: exactDup.id,
			};
		}
	}

	// Check 2: Near-duplicate via FTS5
	const nearDup = findNearDuplicate(input);
	if (nearDup) {
		issues.push({
			type: "near-duplicate",
			severity: "medium",
			message: `Similar to #${nearDup.id}: "${nearDup.title}" (consider superseding)`,
			relatedId: nearDup.id,
		});
	}

	// Check 3: Contradiction with existing decisions
	if (input.type === "decision") {
		const contradiction = findContradiction(input);
		if (contradiction) {
			issues.push({
				type: "contradiction",
				severity: "medium",
				message: `May contradict #${contradiction.id}: "${contradiction.title}"`,
				relatedId: contradiction.id,
			});
		}
	}

	// Check 4: Low quality (no narrative, no concepts)
	if (!input.narrative && !input.concepts) {
		issues.push({
			type: "low-quality",
			severity: "low",
			message:
				"Observation has no narrative and no concepts — low knowledge value",
		});
	}

	// Determine verdict
	const hasHigh = issues.some((i) => i.severity === "high");
	const verdict: ValidationVerdict = hasHigh
		? "reject"
		: issues.length > 0
			? "warn"
			: "pass";

	if (verdict === "pass" || verdict === "warn") {
		appendOperationLog({
			operation: "observation-validated",
			targets: [input.title],
			summary: `Validated [${input.type}] "${input.title}" — ${verdict}${issues.length > 0 ? ` (${issues.length} issues)` : ""}`,
		});
	}

	return { verdict, issues };
}

// ============================================================================
// Internal Checks
// ============================================================================

/**
 * Check for exact title match (same type, active).
 */
function findExactDuplicate(input: ObservationInput): ObservationRow | null {
	const db = getMemoryDB();
	return (
		(db
			.prepare(
				`SELECT * FROM observations
			 WHERE type = ? AND LOWER(title) = LOWER(?) AND superseded_by IS NULL
			 LIMIT 1`,
			)
			.get(input.type, input.title) as ObservationRow | undefined) ?? null
	);
}

/**
 * Check for near-duplicate via FTS5 title search.
 */
function findNearDuplicate(input: ObservationInput): ObservationRow | null {
	const db = getMemoryDB();

	// Build FTS query from title words
	// Strip FTS5 special operators and characters to prevent query syntax errors
	const FTS5_OPERATORS = /\b(AND|OR|NOT|NEAR)\b/gi;
	const words = input.title
		.replace(FTS5_OPERATORS, "")
		.replace(/['"*^+(){}]/g, "")
		.split(/\s+/)
		.filter((w) => w.length > 2)
		.map((w) => `"${w}"*`)
		.join(" AND ");

	if (!words) return null;

	try {
		const result = db
			.prepare(
				`SELECT o.* FROM observations o
				 JOIN observations_fts fts ON fts.rowid = o.id
				 WHERE observations_fts MATCH ?
				   AND o.type = ?
				   AND o.superseded_by IS NULL
				   AND o.id != COALESCE(?, -1)
				 ORDER BY bm25(observations_fts) LIMIT 1`,
			)
			.get(
				words,
				input.type,
				input.supersedes ?? null,
			) as ObservationRow | undefined;

		return result ?? null;
	} catch {
		return null;
	}
}

/**
 * Check for contradictions with existing decisions.
 */
function findContradiction(input: ObservationInput): ObservationRow | null {
	if (!input.concepts || input.concepts.length === 0) return null;

	const db = getMemoryDB();

	// Search for decisions with overlapping concepts
	const conceptQuery = input.concepts.map((c) => `"${c}"*`).join(" OR ");

	try {
		const candidates = db
			.prepare(
				`SELECT o.* FROM observations o
				 JOIN observations_fts fts ON fts.rowid = o.id
				 WHERE observations_fts MATCH ?
				   AND o.type = 'decision'
				   AND o.superseded_by IS NULL
				 ORDER BY bm25(observations_fts) LIMIT 5`,
			)
			.all(conceptQuery) as ObservationRow[];

		// Check for opposing signals
		const inputText = `${input.title} ${input.narrative ?? ""}`.toLowerCase();
		const contradictionPairs = [
			["use", "don't use"],
			["enable", "disable"],
			["add", "remove"],
			["prefer", "avoid"],
			["always", "never"],
		];

		for (const candidate of candidates) {
			const candidateText =
				`${candidate.title} ${candidate.narrative ?? ""}`.toLowerCase();
			for (const [wordA, wordB] of contradictionPairs) {
				if (
					(hasWord(inputText, wordA) && hasWord(candidateText, wordB)) ||
					(hasWord(inputText, wordB) && hasWord(candidateText, wordA))
				) {
					return candidate;
				}
			}
		}
	} catch {
		// FTS5 query failed
	}

	return null;
}
