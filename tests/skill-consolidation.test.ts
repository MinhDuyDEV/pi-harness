import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const skills = resolve(import.meta.dirname, "../.pi/skills");

const merges = [
  ["source-driven-development", "context-engineering", "references/source-provenance.md", "Source hierarchy"],
  ["memory", "context-engineering", "references/memory.md", ".pi/MEMORY.md"],
  ["ts-package-authoring", "typescript-coding-standards", "references/package-authoring.md", "Package contract"],
  ["defense-in-depth", "security-and-hardening", "references/layered-validation.md", "Boundary matrix"],
  ["accessibility-audit", "frontend-design", "references/shadcn/accessibility.md", "Manual WCAG AA Audit"],
  ["design-system-audit", "frontend-design", "references/design-system-audit.md", "Five audit layers"],
  ["mockup-to-code", "frontend-design", "references/mockup-to-code.md", "Mockup-to-code workflow"],
  ["api-and-interface-design", "deep-module-design", "references/api-interface-design.md", "Error contract"],
  ["git-workflow-and-versioning", "shipping-and-launch", "references/git-hygiene.md", "Atomic workflow"],
  ["browser-testing-with-devtools", "playwright", "references/browser-devtools.md", "tool routing"],
  ["performance-optimization", "observability-and-instrumentation", "references/performance.md", "Measure-first performance"],
  ["redesign-existing-projects", "frontend-design", "references/redesign-existing.md", "Behavior-preserving visual redesign"],
] as const;

for (const [source, destination, reference, marker] of merges) {
  test(`${source} is absorbed by ${destination} with a loadable reference`, () => {
    assert.equal(
      existsSync(join(skills, source, "SKILL.md")),
      false,
      `${source} should not remain as a duplicate skill`,
    );
    const destinationSkill = readFileSync(
      join(skills, destination, "SKILL.md"),
      "utf8",
    );
    assert.match(destinationSkill, new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const referenceBody = readFileSync(join(skills, destination, reference), "utf8");
    assert.match(referenceBody, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  });
}

test("development lifecycle remains a hidden user-invoked artifact workflow", () => {
  const body = readFileSync(join(skills, "development-lifecycle", "SKILL.md"), "utf8");
  assert.match(body, /disable-model-invocation:\s*true/u);
  assert.match(body, /TODO\.md[\s\S]*PLAN\.md[\s\S]*PROGRESS\.md[\s\S]*DECISIONS\.md/u);
  assert.match(body, /\/create[\s\S]*\/plan[\s\S]*\/ship[\s\S]*\/verify[\s\S]*\/research/u);
});

