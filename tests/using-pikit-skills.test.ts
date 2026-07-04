import { test } from "node:test";
import assert from "node:assert/strict";
import {
	stripFrontmatter,
	messageContainsBootstrap,
	firstNonCompactionSummaryIndex,
} from "../.pi/extensions/using-pikit-skills.ts";

test("stripFrontmatter removes YAML frontmatter", () => {
	const input = `---
name: foo
description: bar
---

# Body

Hello.`;
	const out = stripFrontmatter(input);
	assert.equal(out, "# Body\n\nHello.");
});

test("stripFrontmatter passes through content without frontmatter", () => {
	const input = "# Body\n\nHello.";
	const out = stripFrontmatter(input);
	assert.equal(out, "# Body\n\nHello.");
});

test("stripFrontmatter trims leading whitespace after frontmatter", () => {
	const input = `---
name: foo
---

   body`;
	const out = stripFrontmatter(input);
	assert.equal(out, "body");
});

test("messageContainsBootstrap detects marker in string content", () => {
	const marker = "pikit:using-pikit-skills bootstrap";
	const msg = { role: "user", content: `prefix ${marker} suffix` };
	assert.equal(messageContainsBootstrap(msg, marker), true);
});

test("messageContainsBootstrap detects marker in array text part", () => {
	const marker = "pikit:using-pikit-skills bootstrap";
	const msg = { role: "user", content: [{ type: "text", text: `prefix ${marker} suffix` }] };
	assert.equal(messageContainsBootstrap(msg, marker), true);
});

test("messageContainsBootstrap returns false for unrelated string content", () => {
	const marker = "pikit:using-pikit-skills bootstrap";
	const msg = { role: "user", content: "nothing relevant here" };
	assert.equal(messageContainsBootstrap(msg, marker), false);
});

test("messageContainsBootstrap returns false for array with non-text parts", () => {
	const marker = "pikit:using-pikit-skills bootstrap";
	const msg = { role: "user", content: [{ type: "image", url: "x" }] };
	assert.equal(messageContainsBootstrap(msg, marker), false);
});

test("firstNonCompactionSummaryIndex returns 0 for normal messages", () => {
	const msgs = [
		{ role: "user", content: "a" },
		{ role: "assistant", content: "b" },
	];
	assert.equal(firstNonCompactionSummaryIndex(msgs), 0);
});

test("firstNonCompactionSummaryIndex skips leading compaction summaries", () => {
	const msgs = [
		{ role: "compactionSummary", content: "summary" },
		{ role: "compactionSummary", content: "summary 2" },
		{ role: "user", content: "actual message" },
	];
	assert.equal(firstNonCompactionSummaryIndex(msgs), 2);
});

test("firstNonCompactionSummaryIndex returns full length when all are summaries", () => {
	const msgs = [
		{ role: "compactionSummary", content: "a" },
		{ role: "compactionSummary", content: "b" },
	];
	assert.equal(firstNonCompactionSummaryIndex(msgs), 2);
});

test("firstNonCompactionSummaryIndex returns 0 for empty array", () => {
	assert.equal(firstNonCompactionSummaryIndex([]), 0);
});
