/**
 * Prompt-template contracts: prevent regressions found in REVIEW-v2.
 * - No fabricated `skill({...})` tool-call syntax (Pi has no `skill()` tool;
 *   prompts use the declarative `skill: name` prose pattern — see fix.md).
 * - No inert `agentType:` frontmatter (Pi reads only `description` + `argument-hint`
 *   for prompts; `agentType` is dead metadata that implies routing that never happens).
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const PROMPTS_DIR = join(ROOT, ".pi", "prompts");

test("prompts never emit fabricated skill({...}) tool-call syntax", async () => {
  const files = (await readdir(PROMPTS_DIR)).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = await readFile(join(PROMPTS_DIR, file), "utf8");
    assert.doesNotMatch(
      content,
      /skill\s*\(\s*\{[\s\S]*?\}\s*\)/,
      `${file}: fabricated skill({...}) tool-call syntax — Pi has no skill() tool; use the declarative "skill: \`name\`" prose pattern (see .pi/prompts/fix.md)`,
    );
  }
});

test("prompts do not declare inert agentType frontmatter", async () => {
  const files = (await readdir(PROMPTS_DIR)).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = await readFile(join(PROMPTS_DIR, file), "utf8");
    assert.doesNotMatch(
      content,
      /^agentType:\s*.+$/m,
      `${file}: inert agentType frontmatter — Pi reads only description + argument-hint for prompts`,
    );
  }
});