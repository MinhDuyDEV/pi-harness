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
			const verdict = checkFailClosed(rule, ctx);
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
		const verdict = checkFailClosed(rule, ctx);
		if (verdict) {
			fired.push(verdict);
			if (!worst || severityRank(verdict.severity) > severityRank(worst.severity)) {
				worst = verdict;
			}
		}
	}
	return { verdict: worst, fired };
}

/**
 * Run one rule, converting a crash into a block verdict.
 *
 * A rule that throws used to propagate out of the tool_call hook, and what Pi
 * does with a throwing hook is not this module's to assume — if the host logs
 * and continues, a crashing rule silently allowed the very call it was
 * examining. A rule that cannot evaluate an input has not approved it.
 */
function checkFailClosed(
	rule: RuleSet[number],
	ctx: ToolCallContext,
): Verdict | null {
	try {
		return rule.check(ctx);
	} catch (error) {
		return {
			kind: "block",
			ruleId: rule.id,
			severity: rule.severity,
			threat: rule.threat,
			message:
				`Rule ${rule.id} failed while evaluating this call and cannot approve it: ` +
				`${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
