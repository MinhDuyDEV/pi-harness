/**
 * Negative / mutation fixtures for prompt-to-skill policy.
 *
 * Prompt templates use declarative `skill: name` references rather than
 * pretending that every Pi installation exposes a `skill(...)` tool.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  extractSkillRefs,
  validatePromptSkillRefs,
} from "../scripts/lib/prompt-policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const FIX_PROMPT = resolve(repoRoot, ".pi/prompts/fix.md");

test("extractSkillRefs returns [] for content with no skill references", () => {
  assert.deepEqual(extractSkillRefs("Just some prose. No skill declarations here."), []);
});

test("extractSkillRefs parses plain and code-formatted declarations", () => {
  const content = [
    "- skill: plain-name",
    "- skill: `code-formatted`",
    "skill: another-name",
  ].join("\n");
  assert.deepEqual(extractSkillRefs(content), ["plain-name", "code-formatted", "another-name"]);
});

test("extractSkillRefs ignores fabricated function-style tool calls", () => {
  assert.deepEqual(extractSkillRefs('skill({ name: "not-a-supported-tool" })'), []);
});

test("validatePromptSkillRefs flags every reference missing from the inventory", () => {
  const result = validatePromptSkillRefs(
    { "fix.md": "- skill: ghost-skill\n- skill: another-ghost" },
    ["real-skill"],
  );
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /fix\.md.*ghost-skill/);
  assert.match(result.errors[1], /fix\.md.*another-ghost/);
});

test("validatePromptSkillRefs accepts references that exist in the inventory", () => {
  const result = validatePromptSkillRefs({ "fix.md": "- skill: real-skill" }, ["real-skill"]);
  assert.equal(result.errors.length, 0);
});

test("validatePromptSkillRefs rejects when the inventory is empty", () => {
  const result = validatePromptSkillRefs({ "fix.md": "- skill: any-skill" }, []);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /any-skill/);
});

test("mutation: a real fix.md with one skill name corrupted is rejected", () => {
  const original = readFileSync(FIX_PROMPT, "utf8");
  const knownSkill = "debugging-and-error-recovery";
  const corrupted = original.replace(knownSkill, "definitely-not-a-skill");
  assert.notEqual(corrupted, original, "fixture mutation did not alter fix.md content");

  const result = validatePromptSkillRefs({ "fix.md": corrupted }, [
    knownSkill,
    "root-cause-tracing",
    "verification-before-completion",
    "code-cleanup",
    "deep-module-design",
  ]);
  const hit = result.errors.find((error) => error.includes("definitely-not-a-skill"));
  assert.ok(hit, `validator should reject the corrupted skill ref; got: ${JSON.stringify(result.errors)}`);
});

test("real fix.md skill references all resolve against the live skills-lock inventory", () => {
  const original = readFileSync(FIX_PROMPT, "utf8");
  const lock = JSON.parse(readFileSync(resolve(repoRoot, "skills-lock.json"), "utf8"));
  const inventory = Object.keys(lock.skills ?? lock);
  assert.ok(inventory.length > 0, "skills-lock inventory must not be empty");

  const refs = extractSkillRefs(original);
  assert.ok(refs.length > 0, "fix.md must declare at least one skill reference");

  const result = validatePromptSkillRefs({ "fix.md": original }, inventory);
  assert.equal(
    result.errors.length,
    0,
    `fix.md skill refs must all resolve; unresolved: ${JSON.stringify(result.errors)}`,
  );
});
