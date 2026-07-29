import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const agents = [
	"explore",
	"general",
	"implementer",
	"peer",
	"proof-auditor",
	"reviewer",
	"scout",
] as const;
// Keys Pi accepts in agent frontmatter. Canonical harness agents intentionally
// pin models so delegation is reproducible across consumer repositories.
const supportedKeys = new Set([
	"description",
	"model",
	"thinking",
	"readonly",
	"proactive",
	"tools",
	"disallowed_tools",
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
		assert.ok(values.get("model"), `${name} must pin a canonical model`);
	});
}

test("discovery, review, audit, and peer agents are read-only; writers are not", async () => {
	for (const name of ["explore", "peer", "proof-auditor", "reviewer", "scout"]) {
		const values = parseHeader(await readFile(`.pi/agents/${name}.md`, "utf8"));
		assert.equal(values.get("readonly"), "true", `${name} must be read-only`);
	}
	for (const name of ["general", "implementer"]) {
		const values = parseHeader(await readFile(`.pi/agents/${name}.md`, "utf8"));
		assert.notEqual(values.get("readonly"), "true", `${name} must not be read-only`);
	}
});

test("specialist agent prompts require evidence and a structured result", async () => {
	const explore = await readFile(".pi/agents/explore.md", "utf8");
	const reviewer = await readFile(".pi/agents/reviewer.md", "utf8");
	const scout = await readFile(".pi/agents/scout.md", "utf8");
	const proofAuditor = await readFile(".pi/agents/proof-auditor.md", "utf8");

	assert.match(explore, /path:line/i);
	assert.match(explore, /<result>/);
	assert.match(reviewer, /severity/i);
	assert.match(reviewer, /<result>/);
	assert.match(scout, /official|primary source/i);
	assert.match(scout, /<result>/);
	assert.match(proofAuditor, /fake-green/i);
	assert.match(proofAuditor, /<result>/);
});

test("agents own outcomes: challenge contracts and weak-scout guards present", async () => {
	const general = await readFile(".pi/agents/general.md", "utf8");
	const reviewer = await readFile(".pi/agents/reviewer.md", "utf8");
	const explore = await readFile(".pi/agents/explore.md", "utf8");
	const scout = await readFile(".pi/agents/scout.md", "utf8");
	const proofAuditor = await readFile(".pi/agents/proof-auditor.md", "utf8");

	// general may challenge a wrong-premise brief instead of comply-and-patch,
	// and must do a blind pass before consuming the provided context pack.
	assert.match(general, /<needs_decision>/);
	assert.match(general, /blind pass/i);
	// reviewer escalates verdict-changing input gaps instead of guessing.
	assert.match(reviewer, /<needs_decision>/);
	// scouts must not ship weak conclusions as verdicts — guiding artifacts only.
	assert.match(explore, /guiding artifacts/i);
	assert.match(scout, /guiding artifacts/i);
	// canonical anti-pattern vocabulary is anchored in .pi/ANTI_PATTERNS.md.
	assert.match(proofAuditor, /ANTI_PATTERNS\.md/);
	assert.match(reviewer, /ANTI_PATTERNS\.md/);
});

test("implementer and peer encode ownership and independence contracts", async () => {
	const implementer = await readFile(".pi/agents/implementer.md", "utf8");
	const peer = await readFile(".pi/agents/peer.md", "utf8");

	// implementer may challenge a wrong premise instead of comply-and-patch,
	// and must form its own view before opening the provided context pack.
	assert.match(implementer, /<needs_decision>/);
	assert.match(implementer, /blind pass/i);
	// evidence carries provenance: personally observed vs merely reported.
	assert.match(implementer, /personally observed/i);
	assert.match(implementer, /reported/i);
	assert.match(implementer, /<result>/);

	// peer may reframe a wrongly-posed question and grades every finding
	// (weak-scout-conclusion guard: confidence per finding, fact vs inference).
	assert.match(peer, /reframe/i);
	assert.match(peer, /confidence level/i);
	assert.match(peer, /inference/i);
	assert.match(peer, /<result>/);
});
