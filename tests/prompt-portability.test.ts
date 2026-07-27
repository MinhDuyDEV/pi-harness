import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { discoverRepositoryGates } from "../scripts/lib/discover-gates.mjs";

const ROOT = resolve(import.meta.dirname, "..");

for (const name of ["verify", "ship"]) {
  test(`${name} discovers repository gates instead of prescribing npm`, () => {
    const content = readFileSync(resolve(ROOT, ".pi", "prompts", `${name}.md`), "utf8");
    assert.doesNotMatch(content, /`npm (?:run |test)/);
    assert.match(content, /AGENTS\.md|project\s+instructions/i);
    assert.match(content, /manifest/i);
    assert.match(content, /lockfile/i);
    assert.match(content, /CI/i);
    assert.match(content, /exact.*command/i);
    assert.match(content, /cwd/i);
    assert.match(content, /exit\s+status/i);
  });
}

test("init template stores observed commands rather than npm examples", () => {
  const content = readFileSync(resolve(ROOT, ".pi", "prompts", "init.md"), "utf8");
  assert.doesNotMatch(content, /\*\*(?:Build|Test|Lint|Typecheck|Dev):\*\* `npm/);
  assert.match(content, /validated command or "not configured"/);
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "gate-discovery-"));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return root;
}

for (const [manager, lockfile] of [
  ["npm", "package-lock.json"],
  ["pnpm", "pnpm-lock.yaml"],
  ["yarn", "yarn.lock"],
  ["bun", "bun.lock"],
] as const) {
  test(`discovers the aggregate check script with ${manager}`, async () => {
    const root = fixture({
      "package.json": JSON.stringify({ scripts: { check: "project-check", test: "project-test" } }),
      [lockfile]: "",
    });
    try {
      const result = await discoverRepositoryGates(root);
      assert.equal(result.status, "ready");
      assert.deepEqual(result.gates.map(({ command }) => command), [`${manager} run check`]);
      assert.equal(result.gates[0]?.cwd, root);
      assert.equal(result.gates[0]?.source, "package.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("discovers non-JavaScript repository gates", async () => {
  const root = fixture({ "Cargo.toml": "[package]\nname = \"fixture\"\n" });
  try {
    const result = await discoverRepositoryGates(root);
    assert.deepEqual(
      result.gates.map(({ command }) => command),
      ["cargo test", "cargo check"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checked-in wrapper wins over manifest heuristics", async () => {
  const root = fixture({
    "scripts/check.sh": "#!/bin/sh\nexit 0\n",
    "package.json": JSON.stringify({ scripts: { check: "wrong" } }),
    "package-lock.json": "",
  });
  try {
    const result = await discoverRepositoryGates(root);
    assert.deepEqual(result.gates.map(({ command }) => command), ["sh scripts/check.sh"]);
    assert.deepEqual(result.sources, ["scripts/check.sh"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("conflicting JavaScript lockfiles stop discovery instead of guessing", async () => {
  const root = fixture({
    "package.json": JSON.stringify({ scripts: { check: "project-check" } }),
    "package-lock.json": "",
    "pnpm-lock.yaml": "",
  });
  try {
    const result = await discoverRepositoryGates(root);
    assert.equal(result.status, "ambiguous");
    assert.deepEqual(result.gates, []);
    assert.match(result.conflicts[0] ?? "", /npm, pnpm/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
