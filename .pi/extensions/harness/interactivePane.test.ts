/**
 * Focused unit tests for interactive tmux pane session helpers.
 *
 * Run: npx tsx .pi/extensions/harness/interactivePane.test.ts
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readInteractivePaneUsage } from "./interactivePane.js";

const dir = mkdtempSync(join(tmpdir(), "interactive-pane-test-"));
try {
	const sessionFile = join(dir, "session.jsonl");
	writeFileSync(
		sessionFile,
		[
			JSON.stringify({ type: "session", version: 3 }),
			JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
			JSON.stringify({ type: "message", message: { role: "assistant", stopReason: "toolUse", usage: { input: 100, output: 20, cacheRead: 300, cacheWrite: 40, cost: { total: 0.0012 } } } }),
			"{malformed partial line",
			JSON.stringify({ type: "message", message: { role: "toolResult", content: [] } }),
			JSON.stringify({ type: "message", message: { role: "assistant", stopReason: "stop", usage: { input: 7, output: 11, cacheRead: 13, cacheWrite: 17, cost: { total: 0.0023 } } } }),
		].join("\n"),
		"utf-8",
	);

	const usage = readInteractivePaneUsage(sessionFile);
	assert.equal(usage.turnCount, 2);
	assert.equal(usage.inputTokens, 107);
	assert.equal(usage.outputTokens, 31);
	assert.equal(usage.cacheReadTokens, 313);
	assert.equal(usage.cacheWriteTokens, 57);
	assert.ok(Math.abs(usage.totalCost - 0.0035) < 0.0000001);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("interactivePane.test.ts: all assertions passed.");
