/**
 * Focused unit tests for harness agent loading.
 *
 * Run: npx tsx .pi/extensions/harness/agents.test.ts
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentFile } from "./agents.js";

const root = mkdtempSync(join(tmpdir(), "pikit-harness-agents-"));
try {
	mkdirSync(join(root, ".pi", "agents"), { recursive: true });

	writeFileSync(
		join(root, ".pi", "agents", "custom.md"),
		`---
description: Custom harness agent
tools: read, bash, srcwalk_search, webclaw_scrape, edit
disallowed_tools: edit, webclaw_scrape
model: opencode-go/deepseek-v4-flash
thinking: high
---

# Custom Agent
`,
		"utf-8",
	);

	const custom = loadAgentFile("custom", root);
	assert.ok(custom, "custom agent loads");
	assert.deepEqual(custom.tools, ["read", "bash", "srcwalk_search"], "tools frontmatter allows custom tools and disallowed_tools removes matches");
	assert.equal(custom.model, "opencode-go/deepseek-v4-flash");
	assert.equal(custom.thinking, "high");
	assert.equal(custom.systemPrompt, "# Custom Agent");

	writeFileSync(
		join(root, ".pi", "agents", "default-tools.md"),
		`---
description: Default tool harness agent
disallowed_tools: edit, write
---

# Default Agent
`,
		"utf-8",
	);

	const defaultTools = loadAgentFile("default-tools", root);
	assert.ok(defaultTools, "default tool agent loads");
	assert.deepEqual(defaultTools.tools, ["read", "bash", "grep", "find", "ls"], "agents without tools frontmatter keep built-in defaults minus disallowed tools");
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log("agents.test.ts: all assertions passed.");
