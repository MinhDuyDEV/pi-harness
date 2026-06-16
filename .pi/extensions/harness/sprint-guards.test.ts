/**
 * Tests for pure sprint guards extracted from orchestrator.ts.
 *
 * These cover the small pure helpers used by runBuildEvaluatePhase:
 * dependency check, high-risk guard, evaluation prompt builder, and the
 * fix prompt builder. Running these tests first lets us safely extract
 * the large per-sprint body into its own module.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	buildEvalPrompt,
	buildFixPrompt,
	findFailedDependencies,
	shouldRequireInteractiveApproval,
} from "./sprint-guards.js";
import type { Sprint, SprintResult } from "./parsing.js";

function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
	return {
		number: 1,
		title: "Test Sprint",
		description: "A test sprint",
		files: "src/example.ts",
		ownedFiles: ["src/example.ts"],
		dependencies: [],
		proofRequired: ["tests pass"],
		criteria: "tests pass",
		verificationCommands: ["echo done"],
		verificationRequired: false,
		riskLane: "normal",
		riskFlags: [],
		contextNeeded: [],
		skills: [],
		...overrides,
	} as Sprint;
}

function makeResult(overrides: Partial<SprintResult> = {}): SprintResult {
	return {
		sprint: "1",
		iterations: 1,
		passed: true,
		verdict: "PASS",
		confidence: "high",
		evalOutput: "",
		...overrides,
	} as SprintResult;
}

test("findFailedDependencies: no deps, no results", () => {
	assert.deepEqual(findFailedDependencies(makeSprint(), []), []);
});

test("findFailedDependencies: all deps pass", () => {
	const sprint = makeSprint({ dependencies: [1, 2] });
	const results = [makeResult({ sprint: "1", passed: true }), makeResult({ sprint: "2", passed: true })];
	assert.deepEqual(findFailedDependencies(sprint, results), []);
});

test("findFailedDependencies: one dep failed", () => {
	const sprint = makeSprint({ dependencies: [1, 2] });
	const results = [makeResult({ sprint: "1", passed: true }), makeResult({ sprint: "2", passed: false })];
	assert.deepEqual(findFailedDependencies(sprint, results), [2]);
});

test("findFailedDependencies: missing result treated as failed", () => {
	const sprint = makeSprint({ dependencies: [1, 3] });
	const results = [makeResult({ sprint: "1", passed: true })];
	assert.deepEqual(findFailedDependencies(sprint, results), [3]);
});

test("shouldRequireInteractiveApproval: normal lane never requires", () => {
	assert.equal(shouldRequireInteractiveApproval(makeSprint({ riskLane: "normal" })), false);
});

test("shouldRequireInteractiveApproval: tiny lane never requires", () => {
	assert.equal(shouldRequireInteractiveApproval(makeSprint({ riskLane: "tiny" })), false);
});

test("shouldRequireInteractiveApproval: high-risk lane requires approval", () => {
	assert.equal(shouldRequireInteractiveApproval(makeSprint({ riskLane: "high-risk" })), true);
});

test("shouldRequireInteractiveApproval: explicit risk flag forces approval", () => {
	assert.equal(shouldRequireInteractiveApproval(makeSprint({ riskFlags: ["destructive"] })), true);
});

test("buildEvalPrompt: contains sprint info and generator output", () => {
	const sprint = makeSprint({ number: 2, title: "Add feature", proofRequired: ["type check"] });
	const generation = { outputText: "Generated code here", usage: { turnCount: 3 } };
	const prompt = buildEvalPrompt(sprint, generation, null, 1, 3);
	assert.match(prompt, /Sprint 2/);
	assert.match(prompt, /Add feature/);
	assert.match(prompt, /Generated code here/);
	assert.match(prompt, /iteration 1\/3/);
	assert.match(prompt, /type check/);
	assert.match(prompt, /PASS, FAIL, ATTESTED, UNVERIFIABLE/);
});

test("buildEvalPrompt: includes previous evaluator feedback on later iterations", () => {
	const sprint = makeSprint();
	const generation = { outputText: "code", usage: { turnCount: 1 } };
	const previousEval = { outputText: "fix the imports", verdict: "FAIL" };
	const prompt = buildEvalPrompt(sprint, generation, previousEval, 2, 3);
	assert.match(prompt, /Previous evaluator feedback/);
	assert.match(prompt, /fix the imports/);
	assert.match(prompt, /iteration 2\/3/);
});

test("buildFixPrompt: includes previous attempt and feedback", () => {
	const sprint = makeSprint({ number: 1, title: "Refactor" });
	const generation = { outputText: "old code" };
	const evaluation = { outputText: "needs work", verdict: "FAIL", issues: ["unused import", "missing test"] };
	const prompt = buildFixPrompt(sprint, generation, evaluation, 2);
	assert.match(prompt, /Sprint 1/);
	assert.match(prompt, /Refactor/);
	assert.match(prompt, /old code/);
	assert.match(prompt, /needs work/);
	assert.match(prompt, /unused import/);
	assert.match(prompt, /missing test/);
	assert.match(prompt, /iteration 2/);
});
