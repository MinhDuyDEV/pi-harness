/**
 * Pure sprint guards and prompt builders.
 *
 * Extracted from orchestrator.ts to make the per-sprint logic testable
 * without mocking agents, widget, or tracker. The functions in this file
 * are pure (no side effects, no I/O) and depend only on the Sprint and
 * SprintResult types.
 */

import type { Sprint, SprintResult } from "./parsing.js";

/**
 * Return the sprint numbers of dependencies that have not yet passed.
 * A missing result counts as not passed.
 */
export function findFailedDependencies(sprint: Sprint, results: SprintResult[]): number[] {
	return sprint.dependencies.filter((dep) => {
		const depResult = results.find((r) => r.sprint === String(dep));
		return !depResult || !depResult.passed;
	});
}

/**
 * High-risk sprints or any sprint with an explicit risk flag require
 * interactive approval before proceeding. Standard-lane sprints skip
 * the approval gate.
 */
export function shouldRequireInteractiveApproval(sprint: Sprint): boolean {
	if (sprint.riskLane === "high-risk") return true;
	return sprint.riskFlags.length > 0;
}

interface GenerationSummary {
	outputText: string;
	usage: { turnCount: number };
}

interface EvaluationSummary {
	outputText: string;
	verdict: string;
}

/**
 * Build the evaluator prompt for a given iteration. Includes the
 * previous evaluator's feedback when re-evaluating after a fix.
 */
export function buildEvalPrompt(
	sprint: Sprint,
	generation: GenerationSummary,
	previousEval: EvaluationSummary | null,
	iteration: number,
	maxIterations: number,
): string {
	const previousContext = previousEval
		? `\n\nPrevious evaluator feedback (iteration ${iteration - 1}):\n${previousEval.outputText}\n`
		: "";
	return [
		`Evaluate Sprint ${sprint.number}: ${sprint.title}`,
		"",
		`Description: ${sprint.description}`,
		`Proof Required: ${sprint.proofRequired.join(", ") || "none"}`,
		`Files: ${sprint.files}`,
		`Risk Flags: ${sprint.riskFlags.join(", ") || "none"}`,
		"",
		`Generator output (iteration ${iteration}/${maxIterations}, ${generation.usage.turnCount} turns):`,
		"```",
		generation.outputText,
		"```",
		previousContext,
		`Your verdict options: PASS, FAIL, ATTESTED, UNVERIFIABLE.`,
		`Return a JSON object with fields: verdict, passed (boolean), confidence (low/medium/high), issues (string[]), suggestions (string[]).`,
	].join("\n");
}

interface EvaluationWithIssues {
	outputText: string;
	verdict: string;
	issues?: string[];
}

/**
 * Build the fix prompt for the generator to address evaluator feedback.
 * The `iteration` argument is the upcoming iteration number (1-based).
 */
export function buildFixPrompt(
	sprint: Sprint,
	generation: { outputText: string },
	evaluation: EvaluationWithIssues,
	iteration: number,
): string {
	const issues = evaluation.issues?.join("\n- ") ?? "(see evaluator output)";
	return [
		`Re-implement Sprint ${sprint.number} (iteration ${iteration}): ${sprint.title}`,
		"",
		`Description: ${sprint.description}`,
		`Proof Required: ${sprint.proofRequired.join(", ") || "none"}`,
		`Files: ${sprint.files}`,
		"",
		`Previous attempt (verdict: ${evaluation.verdict}):`,
		"```",
		generation.outputText,
		"```",
		"",
		`Evaluator feedback:`,
		"```",
		evaluation.outputText,
		"```",
		"",
		`Issues to address: ${issues}`,
		`Fix the issues in the same files. Do not introduce new files unless required.`,
	].join("\n");
}
