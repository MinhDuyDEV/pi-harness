/**
 * Safety Module — Composition Operators
 *
 * All operators return new RuleSet instances (never mutate).
 * Think array combinators for security rules.
 */

import type { Rule, RuleSet, Severity } from "./types.js";

const SEVERITY_ORDER: Record<Severity, number> = {
	critical: 3,
	high: 2,
	medium: 1,
	low: 0,
};

/** Severity as a number (critical=3 … low=0) for comparison. */
export function severityRank(s: Severity): number {
	return SEVERITY_ORDER[s];
}

/** Concatenate rulesets. Earlier rules take priority in first-match evaluation. */
export function merge(...sets: RuleSet[]): RuleSet {
	return sets.flat();
}

/** Remove rules by ID. */
export function exclude(set: RuleSet, ...ids: string[]): RuleSet {
	const idSet = new Set(ids);
	return set.filter((r) => !idSet.has(r.id));
}

/** Keep only rules matching predicate. */
export function filter(set: RuleSet, predicate: (r: Rule) => boolean): RuleSet {
	return set.filter(predicate);
}

/** Replace a rule by ID. If not found, appends. Pass null to remove. */
export function override(set: RuleSet, id: string, replacement: Rule | null): RuleSet {
	if (replacement === null) return exclude(set, id);
	const idx = set.findIndex((r) => r.id === id);
	if (idx === -1) return [...set, replacement];
	const copy = [...set];
	copy[idx] = replacement;
	return copy;
}

/** Only rules targeting a specific tool (or "*"). */
export function forTool(set: RuleSet, tool: string): RuleSet {
	return set.filter((r) => r.targets.includes("*") || r.targets.includes(tool));
}

/** Only rules at or above a severity threshold. */
export function atSeverity(set: RuleSet, minSeverity: Severity): RuleSet {
	const min = SEVERITY_ORDER[minSeverity];
	return set.filter((r) => SEVERITY_ORDER[r.severity] >= min);
}

/** Sort rules by severity descending (critical first). Stable sort. */
export function sortBySeverity(set: RuleSet): RuleSet {
	return [...set].sort(
		(a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
	);
}

/** List all rule descriptors (for /safety command). */
export function describe(
	set: RuleSet,
): Array<{
	id: string;
	description: string;
	severity: Severity;
	threat: string;
	targets: readonly string[];
}> {
	return set.map((r) => ({
		id: r.id,
		description: r.description,
		severity: r.severity,
		threat: r.threat,
		targets: r.targets,
	}));
}
