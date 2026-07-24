import { test } from "node:test";
import assert from "node:assert/strict";
import superpiExtension, {
	stripFrontmatter,
	messageContainsBootstrap,
	firstNonCompactionSummaryIndex,
	getBootstrapSkillPath,
} from "../.pi/extensions/superpi.ts";
import { existsSync } from "node:fs";

test("getBootstrapSkillPath resolves to an existing skill file", () => {
	// Regression: the bootstrap skill path must point at .pi/skills, not a
	// nonexistent root-level skills/ dir, otherwise the extension becomes a
	// silent no-op (ENOENT swallowed by getBootstrapContent).
	const path = getBootstrapSkillPath();
	assert.ok(
		path.endsWith([".pi", "skills", "superpi", "SKILL.md"].join("/")),
		`expected path under .pi/skills, got ${path}`,
	);
	assert.equal(existsSync(path), true, `bootstrap skill file not found: ${path}`);
});

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
	const marker = "pi-harness:superpi bootstrap";
	const msg = { role: "user", content: `prefix ${marker} suffix` };
	assert.equal(messageContainsBootstrap(msg, marker), true);
});

test("messageContainsBootstrap detects marker in array text part", () => {
	const marker = "pi-harness:superpi bootstrap";
	const msg = { role: "user", content: [{ type: "text", text: `prefix ${marker} suffix` }] };
	assert.equal(messageContainsBootstrap(msg, marker), true);
});

test("messageContainsBootstrap returns false for unrelated string content", () => {
	const marker = "pi-harness:superpi bootstrap";
	const msg = { role: "user", content: "nothing relevant here" };
	assert.equal(messageContainsBootstrap(msg, marker), false);
});

test("messageContainsBootstrap returns false for array with non-text parts", () => {
	const marker = "pi-harness:superpi bootstrap";
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

test("PI_HARNESS_NO_SUPERPI=1 disables bootstrap injection", async () => {
	const handlers: Record<string, (...args: unknown[]) => unknown> = {};
	const mockPi = {
		on: (event: string, handler: (...args: unknown[]) => unknown) => {
			handlers[event] = handler;
		},
	} as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
	superpiExtension(mockPi);
	const prev = process.env.PI_HARNESS_NO_SUPERPI;
	try {
		process.env.PI_HARNESS_NO_SUPERPI = "1";
		await handlers.session_start?.();
		const result = await handlers.context({ messages: [{ role: "user", content: "hello" }] });
		assert.equal(result, undefined, "bootstrap must not inject when PI_HARNESS_NO_SUPERPI=1");
	} finally {
		if (prev === undefined) delete process.env.PI_HARNESS_NO_SUPERPI;
		else process.env.PI_HARNESS_NO_SUPERPI = prev;
	}
});

test("PI_HARNESS_NO_SUPERPI unset allows bootstrap injection", async () => {
	const handlers: Record<string, (...args: unknown[]) => unknown> = {};
	const mockPi = {
		on: (event: string, handler: (...args: unknown[]) => unknown) => {
			handlers[event] = handler;
		},
	} as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
	superpiExtension(mockPi);
	const prev = process.env.PI_HARNESS_NO_SUPERPI;
	try {
		delete process.env.PI_HARNESS_NO_SUPERPI;
		await handlers.session_start?.();
		const messages = [{ role: "user", content: "hello" }];
		const result = (await handlers.context({ messages })) as
			| { messages: unknown[] }
			| undefined;
		assert.ok(result, "bootstrap should inject when PI_HARNESS_NO_SUPERPI is unset");
		assert.ok(
			result && result.messages.length > messages.length,
			"injection should add a bootstrap message",
		);
	} finally {
		if (prev === undefined) delete process.env.PI_HARNESS_NO_SUPERPI;
		else process.env.PI_HARNESS_NO_SUPERPI = prev;
	}
});
