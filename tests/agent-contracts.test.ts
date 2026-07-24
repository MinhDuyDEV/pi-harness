import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const agents = ["explore", "general", "reviewer", "scout"] as const;
// Keys Pi accepts in agent frontmatter. `model` is intentionally permitted so
// this harness can preserve its existing per-agent model overrides.
const supportedKeys = new Set([
	"description",
	"model",
	"thinking",
	"readonly",
	"proactive",
	"tools",
	"disallowed_tools",
	"skills",
	"prompt_mode",
]);

function parseHeader(content: string): Map<string, string> {
	const match = /^---\n(.*?)\n---\n/s.exec(content);
	assert.ok(match, "agent file must begin with frontmatter");
	const values = new Map<string, string>();
	for (const line of match[1].split("\n")) {
		// Only parse top-level `key: value` lines; skip multi-line continuation rows.
		const keyMatch = /^([a-z_]+):\s*(.*)$/s.exec(line);
		if (!keyMatch) continue;
		values.set(keyMatch[1], keyMatch[2].trim());
	}
	return values;
}

for (const name of agents) {
	test(`${name} uses portable Pi agent frontmatter`, async () => {
		const values = parseHeader(await readFile(`.pi/agents/${name}.md`, "utf8"));
		for (const key of values.keys()) {
			assert.ok(supportedKeys.has(key), `unsupported ${name} key: ${key}`);
		}
		assert.ok(values.get("description"), `${name} needs a description`);
	});
}

test("discovery and review agents are read-only; general is not", async () => {
	for (const name of ["explore", "reviewer", "scout"]) {
		const values = parseHeader(await readFile(`.pi/agents/${name}.md`, "utf8"));
		assert.equal(values.get("readonly"), "true", `${name} must be read-only`);
	}
	const general = parseHeader(await readFile(".pi/agents/general.md", "utf8"));
	assert.notEqual(general.get("readonly"), "true", "general must not be read-only");
});

test("specialist agent prompts require evidence and a structured result", async () => {
	const explore = await readFile(".pi/agents/explore.md", "utf8");
	const reviewer = await readFile(".pi/agents/reviewer.md", "utf8");
	const scout = await readFile(".pi/agents/scout.md", "utf8");

	assert.match(explore, /path:line/i);
	assert.match(explore, /<result>/);
	assert.match(reviewer, /severity/i);
	assert.match(reviewer, /<result>/);
	assert.match(scout, /official|primary source/i);
	assert.match(scout, /<result>/);
});