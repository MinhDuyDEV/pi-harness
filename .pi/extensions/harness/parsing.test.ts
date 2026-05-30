/**
 * Focused unit tests for parsing utilities.
 *
 * Run: npx tsx .pi/extensions/harness/parsing.test.ts
 */

import { strict as assert } from "node:assert";
import {
	parseSprints,
	parseEvalOutput,
	parseMarkdownFrontmatter,
	parseCriteriaItems,
	extractText,
	getLastAssistantText,
	HARNESS_FORMAT_INSTRUCTIONS,
	HARNESS_EVAL_INSTRUCTIONS,
} from "./parsing.js";

// ─── extractText ─────────────────────────────────────────────────────────────

{
	const t = "extractText with string returns it directly";
	const input = "hello world";
	assert.equal(extractText(input), input, t);
}

{
	const t = "extractText with content array extracts text parts";
	const input = [
		{ type: "text" as const, text: "hello " },
		{ type: "text" as const, text: "world" },
	];
	assert.equal(extractText(input), "hello \nworld", t);
}

{
	const t = "extractText with content array skips non-text";
	const input = [
		{ type: "text" as const, text: "only " },
		{ type: "image" as const, data: "abc" },
		{ type: "text" as const, text: "text" },
	];
	assert.equal(extractText(input), "only \ntext", t);
}

{
	const t = "extractText handles empty array";
	assert.equal(extractText([]), "", t);
}

// ─── getLastAssistantText ────────────────────────────────────────────────────

{
	const t = "getLastAssistantText returns last assistant text";
	const session = {
		messages: [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
			{ role: "user", content: "how are you" },
			{ role: "assistant", content: [{ type: "text" as const, text: "I'm good" }] },
		],
	};
	assert.equal(getLastAssistantText(session as any), "I'm good", t);
}

{
	const t = "getLastAssistantText joins text blocks with newline";
	const session = {
		messages: [
			{ role: "assistant", content: [{ type: "text" as const, text: "line1" }, { type: "text" as const, text: "line2" }] },
		],
	};
	assert.equal(getLastAssistantText(session as any), "line1\nline2", t);
}

{
	const t = "getLastAssistantText returns empty string when no assistant messages";
	const session = { messages: [{ role: "user", content: "hello" }] };
	assert.equal(getLastAssistantText(session as any), "", t);
}

{
	const t = "getLastAssistantText returns empty string on empty messages";
	const session = { messages: [] };
	assert.equal(getLastAssistantText(session as any), "", t);
}

// ─── parseSprints ────────────────────────────────────────────────────────────

{
	const t = "parseSprints extracts numbered sprint sections";
	const input = `## Sprint 1: Setup Project
Description: Initialize the project structure
Lane: normal
Risk Flags: none
Context Needed:
- package.json
Proof Required:
- unit
Criteria:
- [ ] Create package.json
- [ ] Add TypeScript config
Files: package.json, tsconfig.json

## Sprint 2: Core Logic
Description: Implement the core algorithm
Lane: normal
Risk Flags: none
Context Needed:
- src/index.ts
Proof Required:
- unit
Criteria:
- [ ] Write main module
Files: src/index.ts`;

	const sprints = parseSprints(input);
	assert.equal(sprints.length, 2, t);
	assert.equal(sprints[0].number, 1, t);
	assert.equal(sprints[0].title, "Setup Project", t);
	assert.ok(sprints[0].description.includes("Initialize the project structure"), t);
	assert.ok(sprints[0].criteria.includes("- [ ] Create package.json"), t);
	assert.equal(sprints[0].files, "package.json, tsconfig.json", t);
	assert.deepEqual(sprints[0].ownedFiles, ["package.json", "tsconfig.json"], t);
	assert.deepEqual(sprints[0].skills, [], t);
	assert.equal(sprints[1].number, 2, t);
	assert.equal(sprints[1].title, "Core Logic", t);
}

{
	const t = "parseSprints extracts optional Skills section";
	const input = `## Sprint 1: Debug Flow
Description: Fix failing runtime flow
Lane: normal
Risk Flags: weak_proof
Context Needed:
- src/runtime.ts
Proof Required:
- regression test
Criteria:
- [ ] Reproduce failure
- [ ] Add regression coverage
Skills:
- diagnose
- test-driven-development
Files: src/runtime.ts`;
	const sprints = parseSprints(input);
	assert.deepEqual(sprints[0].skills, ["diagnose", "test-driven-development"], t);
	assert.ok(!sprints[0].criteria.includes("Skills:"), t);
	assert.equal(sprints[0].files, "src/runtime.ts", t);
}

{
	const t = "parseSprints is strict by default and rejects output without sprint markers";
	const input = "Just a simple description with no sprint markers.\nCriteria:\n- [ ] Do something";
	const sprints = parseSprints(input);
	assert.deepEqual(sprints, [], t);
}

{
	const t = "parseSprints handles empty input";
	assert.deepEqual(parseSprints(""), [], t);
}

{
	const t = "parseSprints handles Windows line endings";
	const input = "## Sprint 1: Test\r\nDescription: Win line endings\r\nLane: tiny\r\nRisk Flags: none\r\nContext Needed:\r\n- a.ts\r\nProof Required:\r\n- node --check\r\nCriteria:\r\n- [ ] A\r\nFiles: a.ts";
	const sprints = parseSprints(input);
	assert.equal(sprints.length, 1, t);
	assert.equal(sprints[0].title, "Test", t);
}

{
	const t = "parseSprints extracts criteria before Files:";
	const input = `## Sprint 1: Feature
Description: Build feature
Lane: normal
Risk Flags: none
Context Needed:
- main.ts
Proof Required:
- unit
Criteria:
- [ ] Criterion A
- [ ] Criterion B
Files: main.ts`;
	const sprints = parseSprints(input);
	assert.ok(sprints[0].criteria.includes("- [ ] Criterion A"), t);
	assert.ok(sprints[0].criteria.includes("- [ ] Criterion B"), t);
}

{
	const t = "parseSprints extracts optional Verification Commands section";
	const input = `## Sprint 1: Feature
Description: Build feature
Lane: normal
Risk Flags: none
Context Needed:
- src/index.js
Proof Required:
- unit
Criteria:
- [ ] Criterion A
Verification Commands:
- npm test
- node --check src/index.js
Files: src/index.js`;
	const sprints = parseSprints(input);
	assert.deepEqual(sprints[0].verificationCommands, ["npm test", "node --check src/index.js"], t);
	assert.ok(!sprints[0].criteria.includes("Verification Commands:"), t);
}

{
	const t = "parseSprints extracts risk, context, and proof metadata";
	const input = `## Sprint 1: Auth Gate
Description: Add guarded route behavior
Lane: high-risk
Risk Flags: auth, authorization
Context Needed:
- docs/product/permissions.md
- src/auth/session.ts
Proof Required: unit, integration, e2e smoke
Criteria:
- [ ] Reject anonymous users
Verification Commands:
- npm test -- auth
Files: src/auth/session.ts, test/auth.test.ts`;
	const sprints = parseSprints(input);
	assert.equal(sprints[0].description, "Add guarded route behavior", t);
	assert.equal(sprints[0].riskLane, "high-risk", t);
	assert.deepEqual(sprints[0].riskFlags, ["auth", "authorization"], t);
	assert.deepEqual(sprints[0].contextNeeded, ["docs/product/permissions.md", "src/auth/session.ts"], t);
	assert.deepEqual(sprints[0].proofRequired, ["unit", "integration", "e2e smoke"], t);
	assert.deepEqual(sprints[0].ownedFiles, ["src/auth/session.ts", "test/auth.test.ts"], t);
	assert.ok(!sprints[0].criteria.includes("Proof Required:"), t);
}

{
	const t = "parseSprints rejects incomplete sprint sections missing required risk metadata";
	const input = `## Sprint 1: Incomplete Manifest
Description: Missing strict metadata
Criteria:
- [ ] Still works
Files: src/index.js`;
	assert.deepEqual(parseSprints(input), [], t);
}

// ─── parseCriteriaItems ───────────────────────────────────────────────────────

{
	const t = "parseCriteriaItems normalizes checklist criteria";
	assert.deepEqual(parseCriteriaItems("- [ ] Criterion A\n- Criterion B\n* [x] Criterion C"), ["Criterion A", "Criterion B", "Criterion C"], t);
}

// ─── parseMarkdownFrontmatter ────────────────────────────────────────────────

{
	const t = "parseMarkdownFrontmatter extracts frontmatter fields";
	const input = `---
title: Test Agent
model: anthropic/claude-sonnet-4-20250514
thinking: high
max_turns: 10
---

This is the body content.`;
	const { frontmatter, body } = parseMarkdownFrontmatter(input);
	assert.equal(frontmatter.title, "Test Agent", t);
	assert.equal(frontmatter.model, "anthropic/claude-sonnet-4-20250514", t);
	assert.equal(frontmatter.thinking, "high", t);
	assert.equal(frontmatter.max_turns, "10", t);
	assert.equal(body, "This is the body content.", t);
}

{
	const t = "parseMarkdownFrontmatter returns empty frontmatter when no delimiter";
	const { frontmatter, body } = parseMarkdownFrontmatter("Just body text");
	assert.deepEqual(frontmatter, {}, t);
	assert.equal(body, "Just body text", t);
}

{
	const t = "parseMarkdownFrontmatter strips quotes from values";
	const input = `---
name: "Quoted Name"
desc: 'Single Quoted'
---
Body`;
	const { frontmatter } = parseMarkdownFrontmatter(input);
	assert.equal(frontmatter.name, "Quoted Name", t);
	assert.equal(frontmatter.desc, "Single Quoted", t);
}

{
	const t = "parseMarkdownFrontmatter handles frontmatter-only content with trailing newline";
	const input = `---
key: value
---\n`;
	const { frontmatter, body } = parseMarkdownFrontmatter(input);
	assert.equal(frontmatter.key, "value", t);
	assert.equal(body, "", t);
}

{
	const t = "parseMarkdownFrontmatter returns empty frontmatter when no trailing newline after ---";
	const input = `---
key: value
---`;
	const { frontmatter, body } = parseMarkdownFrontmatter(input);
	assert.deepEqual(frontmatter, {}, t);
	assert.equal(body, "---\nkey: value\n---", t);
}

// ─── parseEvalOutput ─────────────────────────────────────────────────────────

{
	const t = "parseEvalOutput parses PASS verdict with concrete criteria evidence";
	const input = JSON.stringify({
		verdict: "PASS",
		criteria: [{ id: "c1", description: "Test A", passes: true, evidence: "test.js:1 Works" }],
		summary: "All good",
	});
	const result = parseEvalOutput(input, ["Test A"]);
	assert.equal(result.verdict, "PASS", t);
	assert.equal(result.criteria.length, 1, t);
	assert.equal(result.criteria[0].passes, true, t);
	assert.equal(result.summary, "All good", t);
}

{
	const t = "parseEvalOutput parses FAIL verdict";
	const input = JSON.stringify({
		verdict: "FAIL",
		criteria: [
			{ id: "c1", description: "Test A", passes: false, evidence: "Missing X" },
		],
		summary: "One failure",
	});
	const result = parseEvalOutput(input);
	assert.equal(result.verdict, "FAIL", t);
	assert.equal(result.criteria[0].passes, false, t);
}

{
	const t = "parseEvalOutput default-FAIL on non-JSON output";
	const result = parseEvalOutput("Some free text with no JSON structure");
	assert.equal(result.verdict, "FAIL", t);
	assert.ok(result.criteria.length > 0, t);
	assert.ok(!result.criteria[0].passes, t);
}

{
	const t = "parseEvalOutput default-FAIL on JSON missing verdict field";
	const input = JSON.stringify({ foo: "bar" });
	const result = parseEvalOutput(input);
	assert.equal(result.verdict, "FAIL", t);
}

{
	const t = "parseEvalOutput extracts JSON from markdown-wrapped output";
	const input = "Some preamble\n```json\n" + JSON.stringify({ verdict: "PASS", criteria: [{ description: "A", passes: true, evidence: "cmd: pass" }], summary: "OK" }) + "\n```";
	const result = parseEvalOutput(input, ["A"]);
	assert.equal(result.verdict, "PASS", t);
}

{
	const t = "parseEvalOutput rejects PASS with no criteria evidence";
	const input = '{"verdict": "PASS", "criteria": [], "summary": "valid" }';
	const result = parseEvalOutput(input, ["A"]);
	assert.equal(result.verdict, "FAIL", t);
	assert.ok(result.criteria.some((criterion) => !criterion.passes), t);
}

{
	const t = "parseEvalOutput handles criteria with extra fields gracefully";
	const input = JSON.stringify({
		verdict: "FAIL",
		criteria: [
			{ id: "c1", passes: false, evidence: "broke" },
			{ id: "c2", passes: true, evidence: "ok" },
		],
		summary: "Mixed",
	});
	const result = parseEvalOutput(input);
	assert.equal(result.verdict, "FAIL", t);
	assert.equal(result.criteria.length, 2, t);
	assert.equal(result.criteria[0].passes, false, t);
	assert.equal(result.criteria[1].passes, true, t);
}

{
	const t = "parseEvalOutput rejects PASS when evidence is missing";
	const input = JSON.stringify({
		verdict: "PASS",
		criteria: [{ description: "A", passes: true, evidence: "" }],
		summary: "No evidence",
	});
	const result = parseEvalOutput(input, ["A"]);
	assert.equal(result.verdict, "FAIL", t);
}

{
	const t = "parseEvalOutput rejects PASS when not all expected criteria are represented";
	const input = JSON.stringify({
		verdict: "PASS",
		criteria: [{ description: "A", passes: true, evidence: "a.test:1" }],
		summary: "Missing B",
	});
	const result = parseEvalOutput(input, ["A", "B"]);
	assert.equal(result.verdict, "FAIL", t);
}

// ─── Format Instructions ─────────────────────────────────────────────────────

{
	const t = "HARNESS_FORMAT_INSTRUCTIONS contains sprint format";
	assert.ok(HARNESS_FORMAT_INSTRUCTIONS.includes("## Sprint 1:"), t);
}

{
	const t = "HARNESS_EVAL_INSTRUCTIONS contains verdict format";
	assert.ok(HARNESS_EVAL_INSTRUCTIONS.includes("PASS"), t);
	assert.ok(HARNESS_EVAL_INSTRUCTIONS.includes("FAIL"), t);
}

// Simple test reporting through process exit
process.on("exit", (code) => {
	if (code === 0) {
		console.log(`\n✓ All parsing tests passed.`);
	}
});

console.log("parsing.test.ts: all assertions passed.");
