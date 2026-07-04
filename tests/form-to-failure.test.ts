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

test("writing-skills has a 'Match the Form to the Failure' section", () => {
	const body = readSkill("writing-skills");
	assert.match(body, /## Match the Form to the Failure/i);
});

test("writing-skills explains why prohibitions backfire on shaping problems", () => {
	const body = readSkill("writing-skills");
	assert.match(body, /prohibitions backfire/i);
	assert.match(body, /recipe/i);
});

test("writing-skills includes the form-to-failure classification table", () => {
	const body = readSkill("writing-skills");
	assert.match(body, /Baseline failure/i);
	assert.match(body, /Right form/i);
	assert.match(body, /Wrong form/i);
});
