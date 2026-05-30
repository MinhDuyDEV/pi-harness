/**
 * Focused unit tests for harness trace-quality scoring.
 *
 * Run: npx tsx .pi/extensions/harness/traceQuality.test.ts
 */

import { strict as assert } from "node:assert";
import type { Sprint, SprintResult } from "./parsing.js";
import { assessRunTrace, assessSprintTrace, formatTraceQualitySummary } from "./traceQuality.js";

function sprint(overrides: Partial<Sprint> = {}): Sprint {
	return {
		number: 1,
		title: "Safe Slice",
		description: "Description: Build safe slice",
		riskLane: "normal",
		riskFlags: ["weak_proof"],
		contextNeeded: ["src/index.ts"],
		proofRequired: ["unit"],
		criteria: "- [ ] Implements behavior",
		files: "src/index.ts, test/index.test.ts",
		ownedFiles: ["src/index.ts", "test/index.test.ts"],
		skills: [],
		verificationCommands: ["npm test"],
		verificationRequired: true,
		dependencies: [],
		...overrides,
	};
}

function result(overrides: Partial<SprintResult> = {}): SprintResult {
	return {
		sprint: "Safe Slice",
		iterations: 1,
		passed: true,
		evalOutput: "{\"verdict\":\"PASS\"}",
		verification: { status: "passed", results: [] },
		...overrides,
	};
}

{
	const t = "assessSprintTrace marks fully evidenced sprint strong";
	const quality = assessSprintTrace(sprint(), result());
	assert.equal(quality.level, "strong", t);
	assert.equal(quality.score, quality.maxScore, t);
	assert.deepEqual(quality.friction, [], t);
}

{
	const t = "assessSprintTrace records friction for high-risk sprint without deterministic proof";
	const quality = assessSprintTrace(
		sprint({ riskLane: "high-risk", verificationCommands: [], proofRequired: ["integration"] }),
		result({ verification: { status: "skipped", results: [] } }),
	);
	assert.notEqual(quality.level, "strong", t);
	assert.ok(quality.friction.some((item) => item.includes("deterministic verification was required")), t);
}

{
	const t = "assessRunTrace aggregates sprint friction and formats summary";
	const summary = assessRunTrace(
		[sprint(), sprint({ number: 2, title: "Weak Slice", files: "", contextNeeded: [], proofRequired: [] })],
		[result(), result({ sprint: "Weak Slice", passed: false, verification: { status: "failed", results: [] } })],
	);
	assert.equal(summary.items.length, 2, t);
	assert.ok(summary.friction.length >= 3, t);
	const formatted = formatTraceQualitySummary(summary);
	assert.ok(formatted.includes("Trace quality:"), t);
	assert.ok(formatted.includes("Friction:"), t);
}

console.log("\n✓ All trace quality tests passed.");
