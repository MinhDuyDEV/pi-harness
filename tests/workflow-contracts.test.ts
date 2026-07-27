import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");

function prompt(name: string): string {
  return readFileSync(resolve(ROOT, ".pi", "prompts", name), "utf8");
}

test("foundation prompts persist shared typed verdicts instead of prose only", () => {
  for (const name of ["create.md", "plan.md"]) {
    const content = prompt(name);
    assert.match(content, /workflow_state action=record_foundation/);
    assert.match(content, /sound.*repair-first.*accepted-risk/s);
    assert.match(content, /verified.*preference/s);
    assert.match(content, /record id.*digest/is);
  }
});

test("verify persists an evidence-backed reconcile checkpoint after applying changes", () => {
  const content = prompt("verify.md");
  assert.match(content, /workflow_state action=record_reconcile/);
  assert.match(content, /completion-threshold/);
  assert.match(content, /completed-since-last/);
  assert.match(content, /after applying the confirmed changes/i);
});

test("handoff Markdown and typed record have the same fourteen sections", () => {
  const content = prompt("handoff.md");
  const expectedHeadings = [
    "Goal",
    "Current state",
    "Verified",
    "Unknowns",
    "Real constraints",
    "Relevant files / modules",
    "Closed decisions",
    "Open decisions",
    "Existing evidence",
    "Expected deliverable",
    "Permissions (write scope)",
    "Anti-patterns to avoid",
    "Next step",
    "Resume keys",
  ];
  const template = content.slice(content.indexOf("```"), content.lastIndexOf("```"));
  const headings = [...template.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, expectedHeadings);
  assert.match(content, /14-field context pack/);
  assert.match(content, /All 14 fields are present/);
  assert.match(content, /workflow_state action=record_handoff/);
});

test("checkpoint runtime imports the public pi-todo parser and has no local Markdown regex parser", () => {
  const content = readFileSync(
    resolve(ROOT, ".pi", "extensions", "checkpoint", "subagent.ts"),
    "utf8",
  );
  assert.match(content, /@minhduydev\/pi-todo\/markdown/);
  assert.doesNotMatch(content, /line\.match\(\^?\/\^###/);
  assert.doesNotMatch(content, /parseActiveBlocks/);
});
