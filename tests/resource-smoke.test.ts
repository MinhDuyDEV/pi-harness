/**
 * Unit tests for the shared resource-smoke path-containment helper.
 *
 * assertResourcesLoad() is exercised end-to-end by the source smoke (in `check`)
 * and the packed smoke (in `release:check`/CI) against real DefaultResourceLoader
 * instances, so it is not mocked here. assertPathsWithinRoot() is a pure helper
 * with a clear reject path, so it gets focused positive + negative coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  assertPackageResourcesLoad,
  assertPathsWithinRoot,
} from "../scripts/lib/resource-smoke.mjs";

test("paths inside the root are accepted", () => {
  const root = "/tmp/pkg";
  assert.doesNotThrow(() =>
    assertPathsWithinRoot(["/tmp/pkg/.pi/skills/x/SKILL.md", "/tmp/pkg/AGENTS.md"], root),
  );
});

test("a path that escapes the root is rejected", () => {
  const root = "/tmp/pkg";
  assert.throws(
    () => assertPathsWithinRoot(["/tmp/repo/.pi/agents/general.md"], root),
    /outside the package root/,
  );
});

test("the root itself and parent-relative paths are rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "rs-test-"));
  try {
    assert.throws(
      () => assertPathsWithinRoot([root], root),
      /outside the package root/,
    );
    assert.throws(
      () => assertPathsWithinRoot([join(root, "..", "sibling")], root),
      /outside the package root/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("undefined/null paths are skipped, not treated as escapes", () => {
  const root = "/tmp/pkg";
  assert.doesNotThrow(() => assertPathsWithinRoot([undefined, null, "/tmp/pkg/x"], root));
});
test("package-mode smoke requires every manifest resource type inside the package root", () => {
  const root = "/tmp/pkg";
  const loader = {
    getExtensions: () => ({ extensions: [{ path: `${root}/.pi/extensions/example.ts` }], errors: [] }),
    getSkills: () => ({ skills: [{ filePath: `${root}/.pi/skills/example/SKILL.md` }], diagnostics: [] }),
    getPrompts: () => ({ prompts: [{ path: `${root}/.pi/prompts/example.md` }], diagnostics: [] }),
    getThemes: () => ({ themes: [{ path: `${root}/.pi/themes/example.json` }], diagnostics: [] }),
    getDiagnostics: () => [],
  };

  assert.deepEqual(assertPackageResourcesLoad(loader, { packageRoot: root }), {
    extensions: 1,
    skills: 1,
    prompts: 1,
    themes: 1,
  });
});

test("package-mode smoke rejects a missing manifest resource group", () => {
  const root = "/tmp/pkg";
  const loader = {
    getExtensions: () => ({ extensions: [], errors: [] }),
    getSkills: () => ({ skills: [{ filePath: `${root}/skill.md` }], diagnostics: [] }),
    getPrompts: () => ({ prompts: [{ path: `${root}/prompt.md` }], diagnostics: [] }),
    getThemes: () => ({ themes: [{ path: `${root}/theme.json` }], diagnostics: [] }),
    getDiagnostics: () => [],
  };

  assert.throws(() => assertPackageResourcesLoad(loader, { packageRoot: root }), /No extensions loaded/);
});
