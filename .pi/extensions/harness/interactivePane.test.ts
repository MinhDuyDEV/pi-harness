/**
 * Focused unit tests for interactive tmux pane session helpers.
 *
 * Run: npx tsx .pi/extensions/harness/interactivePane.test.ts
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildInteractivePaneSplitArgs, chooseInteractivePaneSplitDirection, chooseInteractivePaneSplitTarget, readInteractivePaneUsage } from "./interactivePane.js";

{
	const t = "chooseInteractivePaneSplitDirection stacks narrow panes vertically";
	assert.equal(chooseInteractivePaneSplitDirection(120, 40), "-v", t);
}

{
	const t = "chooseInteractivePaneSplitDirection keeps wide panes side-by-side";
	assert.equal(chooseInteractivePaneSplitDirection(200, 40), "-h", t);
}

{
	const t = "buildInteractivePaneSplitArgs targets the measured pane and uses direct command execution";
	assert.deepEqual(
		buildInteractivePaneSplitArgs({
			cwd: "/work dir",
			command: "bash -lc 'echo ok'",
			targetPane: "%7",
			direction: "-v",
		}),
		["split-window", "-v", "-P", "-F", "#{pane_id}", "-t", "%7", "-p", "50", "-c", "/work dir", "bash -lc 'echo ok'"],
		t,
	);
}

{
	const t = "chooseInteractivePaneSplitTarget preserves the main pane when tracked task panes already exist";
	assert.equal(
		chooseInteractivePaneSplitTarget(
			"%1",
			[
				{ id: "%1", width: 148, height: 64, title: "main" },
				{ id: "%2", width: 147, height: 64, title: "harness scout" },
			],
			new Set(["%2"]),
		),
		"%2",
		t,
	);
}

{
	const t = "chooseInteractivePaneSplitTarget falls back to task pane titles when tracking is unavailable";
	assert.equal(
		chooseInteractivePaneSplitTarget("%1", [
			{ id: "%1", width: 148, height: 64, title: "main" },
			{ id: "%2", width: 147, height: 64, title: "π - task-alpha - .pi" },
		]),
		"%2",
		t,
	);
}

{
	const t = "chooseInteractivePaneSplitTarget falls back to the original pane before task panes exist";
	assert.equal(
		chooseInteractivePaneSplitTarget("%1", [{ id: "%1", width: 296, height: 64, title: "main" }]),
		"%1",
		t,
	);
}

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
