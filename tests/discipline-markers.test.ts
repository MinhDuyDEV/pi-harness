import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", ".pi", "skills");

function readSkill(name: string): string {
	return readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
}

test("test-driven-development has a <HARD-GATE> marker around the red-green mandate", () => {
	const body = readSkill("test-driven-development");
	assert.match(body, /<HARD-GATE>[\s\S]*?<\/HARD-GATE>/);
});

test("brainstorming has a <HARD-GATE> marker around no-implement-without-design", () => {
	const body = readSkill("brainstorming");
	assert.match(body, /<HARD-GATE>[\s\S]*?<\/HARD-GATE>/);
});

test("writing-skills has an <EXTREMELY-IMPORTANT> marker for the iron law", () => {
	const body = readSkill("writing-skills");
	assert.match(body, /<EXTREMELY-IMPORTANT>[\s\S]*?<\/EXTREMELY-IMPORTANT>/);
});
