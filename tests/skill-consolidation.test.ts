import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
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
  ["api-and-interface-design", "improve-codebase-architecture", "references/api-interface-design.md", "Error contract"],
  ["deep-module-design", "improve-codebase-architecture", "references/deep-module-design.md", "Depth Metric"],
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

test("absorbed deep-module guidance retains its decision substance", () => {
  const reference = readFileSync(
    join(skills, "improve-codebase-architecture", "references", "deep-module-design.md"),
    "utf8",
  );
  for (const marker of ["Depth Metric", "Design at least two", "Warning signs", "When not to deepen"]) {
    assert.match(reference, new RegExp(marker, "i"), `missing deep-module guidance: ${marker}`);
  }
});

test("natural operator workflows remain available but are never auto-routed", () => {
  const router = JSON.parse(readFileSync(join(skills, "superpi", "route-metadata.json"), "utf8")) as {
    routes: Array<{ skills: string[] }>;
  };
  const routed = new Set(router.routes.flatMap((route) => route.skills));

  for (const name of ["prototype", "grill-me", "using-git-worktrees"]) {
    const body = readFileSync(join(skills, name, "SKILL.md"), "utf8");
    assert.match(body, /^disable-model-invocation:\s*true\s*$/m, `${name} must be hidden`);
    assert.match(body, new RegExp(`User-invoked.*\\/skill:${name}`), `${name} must disclose its manual route`);
    assert.equal(routed.has(name), false, `${name} must not be auto-routed`);
  }
});

test("skill lock regeneration preserves top-level provenance", () => {
  const root = resolve(import.meta.dirname, "..");
  const sandbox = mkdtempSync(join(tmpdir(), "pi-harness-skill-lock-"));
  try {
    cpSync(join(root, ".pi", "skills"), join(sandbox, ".pi", "skills"), { recursive: true });
    writeFileSync(
      join(sandbox, "skills-lock.json"),
      `${JSON.stringify({ version: 2, provenance: { sentinel: true }, skills: {} }, null, 2)}\n`,
    );
    execFileSync(process.execPath, [join(root, "scripts", "validate-skills.mjs"), "--update"], {
      cwd: sandbox,
      stdio: "pipe",
    });
    const lock = JSON.parse(readFileSync(join(sandbox, "skills-lock.json"), "utf8"));
    assert.deepEqual(lock.provenance, { sentinel: true });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
