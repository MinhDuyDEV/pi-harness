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

test("writing-skills states TDD as REQUIRED BACKGROUND", () => {
	const body = readSkill("writing-skills");
	assert.match(body, /\*\*REQUIRED BACKGROUND:\*\*[\s\S]*?test-driven-development/);
});
