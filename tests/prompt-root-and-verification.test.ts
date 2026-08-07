import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

test("artifact-writing prompts resolve and anchor paths at the repository root", () => {
  const system = read(".pi/APPEND_SYSTEM.md");
  assert.match(system, /git rev-parse --show-toplevel/);
  assert.match(system, /package\.json.*\.pi/is);

  for (const name of ["create", "plan", "research", "ship", "verify", "fix", "handoff", "init"]) {
    const prompt = read(`.pi/prompts/${name}.md`);
    assert.match(prompt, /Resolve `<repo-root>` before/i, `${name} must establish its path anchor`);
    assert.doesNotMatch(
      prompt,
      /(?<!<repo-root>\/)\.pi\/(?:artifacts|MEMORY\.md|memory\/)/,
      `${name} still contains a cwd-relative durable path`,
    );
  }
});

test("verification uses concise evidence prose and strict completion gates", () => {
  const skill = read(".pi/skills/verification-before-completion/SKILL.md");
  assert.match(skill, /Result.*Evidence.*Limits/is);
  assert.match(skill, /normal, concise prose/i);
  assert.doesNotMatch(skill, /<skill_result>/i);

  const verify = read(".pi/prompts/verify.md");
  assert.match(verify, /zero open checklist items/i);
  assert.match(verify, /independent review/i);
  assert.match(verify, /self-review is not independent/i);
  assert.match(verify, /--quick.*--gate-only.*never.*READY TO SHIP/is);
});
