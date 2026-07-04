import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", ".pi", "skills");

const ALLOWED_PREFIXES = [
	"Use when ",
	"Use before ",
	"Use after ",
	"Use INSTEAD OF ",
	"Use during ",
	"Use this skill when ",
	"Use when working with ",
	"ALWAYS ",
	"MUST ",
	"Don't use ",
	"Don't ",
];

function getSkillFrontmatter(skillDir: string): { name: string; description: string } {
	const skillMd = join(skillDir, "SKILL.md");
	const content = readFileSync(skillMd, "utf8");
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) throw new Error(`No frontmatter in ${skillMd}`);
	const fm = match[1];
	const nameMatch = fm.match(/^name:\s*(.+)$/m);
	const descMatch = fm.match(/^description:\s*"?(.+?)"?\s*$/m);
	if (!nameMatch || !descMatch) throw new Error(`Missing name/description in ${skillMd}`);
	return {
		name: nameMatch[1].trim(),
		description: descMatch[1].trim(),
	};
}

const allSkills = readdirSync(SKILLS_DIR)
	.filter((entry) => statSync(join(SKILLS_DIR, entry)).isDirectory())
	.map((entry) => getSkillFrontmatter(join(SKILLS_DIR, entry)));

test("all skill descriptions start with an allowed prefix", () => {
	const offenders = allSkills.filter(
		(s) => !ALLOWED_PREFIXES.some((p) => s.description.startsWith(p)),
	);
	if (offenders.length > 0) {
		const msg = offenders.map((s) => `  ${s.name}: "${s.description.slice(0, 80)}..."`).join("\n");
		assert.fail(`${offenders.length} descriptions don't start with an allowed prefix:\n${msg}`);
	}
});

test("no skill description exceeds 500 characters (except well-known large skills)", () => {
	const EXEMPT = new Set([
		"using-pikit-skills",
		"artifact-format",
		"swift-concurrency",
		"inference-service",
	]);
	const offenders = allSkills.filter(
		(s) => !EXEMPT.has(s.name) && s.description.length > 500,
	);
	if (offenders.length > 0) {
		const msg = offenders.map((s) => `  ${s.name}: ${s.description.length} chars`).join("\n");
		assert.fail(`${offenders.length} descriptions exceed 500 chars:\n${msg}`);
	}
});

test("no skill description uses first person (I/we)", () => {
	const offenders = allSkills.filter(
		(s) => /\b(I |I'|we |we'|We |We're|We've|I'll|we'll|I'll have)\b/.test(s.description),
	);
	if (offenders.length > 0) {
		const msg = offenders.map((s) => `  ${s.name}: "${s.description.slice(0, 80)}..."`).join("\n");
		assert.fail(`${offenders.length} descriptions use first person:\n${msg}`);
	}
});

test("no skill description summarizes a multi-step process with a colon-list", () => {
	const offenders = allSkills.filter((s) =>
		/:\s*[^.]*\([^)]+\)|\bstep\s+\d+:|\bphase\s+\d+:/i.test(s.description),
	);
	if (offenders.length > 0) {
		const msg = offenders
			.map((s) => `  ${s.name}: ${s.description.length} chars`)
			.join("\n");
		assert.fail(`${offenders.length} descriptions include a multi-step process summary:\n${msg}`);
	}
});
