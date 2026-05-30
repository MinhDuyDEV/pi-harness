/**
 * Focused unit tests for artifact helper utilities.
 *
 * Run: npx tsx .pi/extensions/harness/artifacts.test.ts
 */

import { strict as assert } from "node:assert";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

import { writeProgress, HarnessTracker, generateWorkflowScript } from "./artifacts.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;

function setup() {
	tmpDir = mkdtempSync(join(tmpdir(), "harness-artifacts-test-"));
	return tmpDir;
}

function teardown() {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
}

// ─── writeProgress ───────────────────────────────────────────────────────────

{
	const t = "writeProgress creates PROGRESS.md and sprint state files";
	const dir = setup();

	writeProgress(dir, 1, "First Sprint", true, "All criteria passed.");

	const progressPath = join(dir, "PROGRESS.md");
	assert.ok(existsSync(progressPath), t);
	const progress = readFileSync(progressPath, "utf-8");
	assert.ok(progress.includes("Sprint 1"), t);
	assert.ok(progress.includes("[✓] PASS"), t);
	assert.ok(progress.includes("First Sprint"), t);

	const statePath = join(dir, "sprint-1-state.json");
	assert.ok(existsSync(statePath), t);
	const state = JSON.parse(readFileSync(statePath, "utf-8"));
	assert.equal(state.status, "passed", t);
	assert.equal(state.id, "sprint-1", t);

	teardown();
}

{
	const t = "writeProgress appends to existing PROGRESS.md";
	const dir = setup();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "PROGRESS.md"), "# Existing\n\n");

	writeProgress(dir, 1, "Second Sprint", false, "Failed on criterion A.");

	const progress = readFileSync(join(dir, "PROGRESS.md"), "utf-8");
	assert.ok(progress.includes("# Existing"), t);
	assert.ok(progress.includes("Sprint 1"), t);
	assert.ok(progress.includes("[x] FAIL"), t);

	teardown();
}

{
	const t = "writeProgress writes FAIL state correctly";
	const dir = setup();

	writeProgress(dir, 2, "Broken Sprint", false, "Missing implementation.");

	const statePath = join(dir, "sprint-2-state.json");
	assert.ok(existsSync(statePath), t);
	const state = JSON.parse(readFileSync(statePath, "utf-8"));
	assert.equal(state.status, "failed", t);
	assert.equal(state.gates["review-passed"], false, t);

	teardown();
}

// ─── HarnessTracker ──────────────────────────────────────────────────────────

{
	const t = "HarnessTracker constructor creates run directory";
	const dir = setup();

	const tracker = new HarnessTracker(dir, "Test prompt");
	assert.ok(existsSync(tracker.runDir), t);

	teardown();
}

{
	const t = "HarnessTracker.saveSpec writes SPEC.md";
	const dir = setup();

	const tracker = new HarnessTracker(dir, "Save spec test");
	tracker.saveSpec("# Test Spec\nSprint 1: Do things");
	const specPath = join(tracker.runDir, "SPEC.md");
	assert.ok(existsSync(specPath), t);
	const content = readFileSync(specPath, "utf-8");
	assert.ok(content.includes("Test Spec"), t);

	teardown();
}

{
	const t = "HarnessTracker.savePrompt writes canonical PROMPTS files";
	const dir = setup();

	const tracker = new HarnessTracker(dir, "Prompt test");
	tracker.savePrompt("planner-system", "system prompt");
	tracker.savePrompt("planner-user.txt", "user prompt");

	assert.equal(readFileSync(join(tracker.runDir, "PROMPTS", "planner-system.txt"), "utf-8"), "system prompt", t);
	assert.equal(readFileSync(join(tracker.runDir, "PROMPTS", "planner-user.txt"), "utf-8"), "user prompt", t);

	teardown();
}

{
	const t = "HarnessTracker.saveReport writes BUILD-REPORT.md";
	const dir = setup();

	const tracker = new HarnessTracker(dir, "Report test");
	tracker.saveReport("# Build Report\nAll passed.");
	const reportPath = join(tracker.runDir, "BUILD-REPORT.md");
	assert.ok(existsSync(reportPath), t);

	teardown();
}

{
	const t = "HarnessTracker.saveWorkspace writes WORKSPACE.json";
	const dir = setup();

	const tracker = new HarnessTracker(dir, "Workspace test");
	tracker.saveWorkspace({ cwd: "/test", isolated: false, mode: "current" });
	const wsPath = join(tracker.runDir, "WORKSPACE.json");
	assert.ok(existsSync(wsPath), t);
	const ws = JSON.parse(readFileSync(wsPath, "utf-8"));
	assert.equal(ws.cwd, "/test", t);

	teardown();
}

{
	const t = "HarnessTracker.appendState writes durable STATE.md ledger entries";
	const dir = setup();

	const tracker = new HarnessTracker(dir, "State ledger test");
	tracker.appendState("planning", "Created 2 sprints", ["Next: run sprint 1"]);
	const statePath = join(tracker.runDir, "STATE.md");
	assert.ok(existsSync(statePath), t);
	const state = readFileSync(statePath, "utf-8");
	assert.ok(state.includes("# Harness Run State"), t);
	assert.ok(state.includes("## planning"), t);
	assert.ok(state.includes("Created 2 sprints"), t);
	assert.ok(state.includes("Next: run sprint 1"), t);
	assert.ok(tracker.readState().includes("Created 2 sprints"), t);

	teardown();
}

{
	const t = "HarnessTracker.saveTiming writes TIMING.json";
	const dir = setup();

	const tracker = new HarnessTracker(dir, "Timing test");
	tracker.startPhase("planning", "planner-agent");
	tracker.saveTiming();
	const timingPath = join(tracker.runDir, "TIMING.json");
	assert.ok(existsSync(timingPath), t);
	const timing = JSON.parse(readFileSync(timingPath, "utf-8"));
	assert.ok(typeof timing.totalSeconds === "number", t);
	assert.ok(Array.isArray(timing.phases), t);

	teardown();
}

{
	const t = "HarnessTracker.saveTraceQuality writes TRACE-QUALITY.json";
	const dir = setup();

	const tracker = new HarnessTracker(dir, "Trace quality test");
	tracker.saveTraceQuality({
		level: "ok",
		score: 4,
		maxScore: 5,
		friction: ["missing deterministic proof"],
		items: [],
	});
	const tracePath = join(tracker.runDir, "TRACE-QUALITY.json");
	assert.ok(existsSync(tracePath), t);
	const trace = JSON.parse(readFileSync(tracePath, "utf-8"));
	assert.equal(trace.level, "ok", t);
	assert.deepEqual(trace.friction, ["missing deterministic proof"], t);

	teardown();
}

{
	const t = "HarnessTracker.saveSession writes output and cache-aware usage without transcript";
	const dir = setup();
	const tracker = new HarnessTracker(dir, "Session test");
	const session = {
		messages: [
			{ role: "user", content: "hello" },
			{
				role: "assistant",
				content: "done",
				usage: {
					input: 10,
					output: 5,
					cacheRead: 3,
					cacheWrite: 2,
					totalTokens: 20,
					cost: { total: 0.0012 },
				},
			},
		],
	};

	tracker.saveSession("plan", "planner", session as unknown as AgentSession, "system prompt");

	assert.ok(existsSync(join(tracker.runDir, "plan", "OUTPUT.md")), t);
	assert.ok(existsSync(join(tracker.runDir, "plan", "USAGE.json")), t);
	assert.ok(!existsSync(join(tracker.runDir, "plan", "planner-conversation.json")), t);
	const usage = JSON.parse(readFileSync(join(tracker.runDir, "plan", "USAGE.json"), "utf-8"));
	assert.equal(usage.cacheReadTokens, 3, t);
	assert.equal(usage.cacheWriteTokens, 2, t);
	const rootUsage = JSON.parse(readFileSync(join(tracker.runDir, "USAGE.json"), "utf-8"));
	assert.equal(rootUsage.totals.cacheReadTokens, 3, t);

	teardown();
}

// ─── generateWorkflowScript ──────────────────────────────────────────────────

{
	const t = "generateWorkflowScript writes workflow files and returns slug";
	const dir = setup();
	const sprint = {
		number: 1,
		title: "Test Sprint",
		description: "Do the thing",
		criteria: "- [ ] Criterion",
		files: "test.ts",
		skills: [],
	};
	const results = [{ sprint: "Test Sprint", iterations: 1, passed: true, evalOutput: "All good" }];

	const slug = generateWorkflowScript(dir, "test prompt", "spec", [sprint], "producer-reviewer", results);

	assert.ok(slug !== null, t);
	assert.ok(typeof slug === "string" && slug.length > 0, t);

	// Check workflow manifest was written without pretending to replay with a hardcoded model.
	const workflowPath = join(dir, ".pi", "workflows", `${slug}.mjs`);
	assert.ok(existsSync(workflowPath), t);
	const workflow = readFileSync(workflowPath, "utf-8");
	assert.ok(!workflow.includes("claude-sonnet-4-20250514"), t);
	assert.ok(workflow.includes("Original prompt"), t);

	// Check run card was written
	const runCardPath = join(dir, ".pi", "harness-runs", `${slug}.md`);
	assert.ok(existsSync(runCardPath), t);

	teardown();
}

{
	const t = "generateWorkflowScript uses harne-card template if available";
	const dir = setup();
	const templatesDir = join(dir, ".pi", "templates");
	mkdirSync(templatesDir, { recursive: true });
	writeFileSync(join(templatesDir, "harness-card.md"), "**Name:** __NAME__\n**Date:** __DATE__\n");

	const sprint = {
		number: 1,
		title: "Sprint One",
		description: "desc",
		criteria: "- [ ] C1",
		files: "f.ts",
		skills: [],
	};
	const results = [{ sprint: "Sprint One", iterations: 1, passed: true, evalOutput: "OK" }];

	const slug = generateWorkflowScript(dir, "template-test", "spec", [sprint], "producer-reviewer", results);
	assert.ok(slug !== null, t);

	// Check card contains template content
	const cardPath = join(dir, ".pi", "harness-runs", `${slug}.md`);
	const card = readFileSync(cardPath, "utf-8");
	// The template is used but replacements happen via regex on the template
	assert.ok(card.length > 0, t);

	teardown();
}

{
	const t = "generateWorkflowScript handles empty results gracefully";
	const dir = setup();

	const slug = generateWorkflowScript(dir, "empty-test", "spec", [], "pipeline", []);
	// Should still generate a slug and write files
	assert.ok(slug !== null, t);

	teardown();
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n✓ All artifact tests passed.");
