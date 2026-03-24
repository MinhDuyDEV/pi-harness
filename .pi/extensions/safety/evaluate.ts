/**
 * Safety Module — Evaluator
 *
 * Runs a RuleSet against a ToolCallContext and returns the result.
 * Two strategies: first-match (fast) and highest-severity (thorough).
 */

import { forTool, severityRank, sortBySeverity } from "./compose.js";
import type { RuleSet, ToolCallContext, Verdict } from "./types.js";

export interface EvalResult {
	/** The winning verdict, or null if all rules passed. */
	readonly verdict: Verdict | null;
	/** Every rule that fired (for audit log). */
	readonly fired: ReadonlyArray<Verdict>;
}

export type EvalStrategy = "first-match" | "highest-severity";

/**
 * Evaluate a RuleSet against a context.
 *
 * "first-match" (default): Short-circuit on first non-null verdict.
 *   Rules are pre-sorted by severity so the most severe fires first.
 *
 * "highest-severity": Evaluate ALL rules, return the most severe verdict.
 */
export function evaluate(
	rules: RuleSet,
	ctx: ToolCallContext,
	strategy: EvalStrategy = "first-match",
): EvalResult {
	// Pre-filter to rules that target this tool
	const applicable = sortBySeverity(forTool(rules, ctx.tool));

	const fired: Verdict[] = [];

	if (strategy === "first-match") {
		for (const rule of applicable) {
			const verdict = rule.check(ctx);
			if (verdict) {
				fired.push(verdict);
				return { verdict, fired };
			}
		}
		return { verdict: null, fired };
	}

	// highest-severity: collect all, pick the worst
	let worst: Verdict | null = null;
	for (const rule of applicable) {
		const verdict = rule.check(ctx);
		if (verdict) {
			fired.push(verdict);
			if (!worst || severityRank(verdict.severity) > severityRank(worst.severity)) {
				worst = verdict;
			}
		}
	}
	return { verdict: worst, fired };
}
