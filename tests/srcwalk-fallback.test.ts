import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const POLICY = readFileSync(join(ROOT, ".pi", "APPEND_SYSTEM.md"), "utf8");
const FALLBACK = /missing srcwalk|srcwalk.*ENOENT/i;
const BUILTINS = /read.*grep.*find.*ls/is;

test("srcwalk-first policy has an explicit capability fallback", () => {
  assert.match(POLICY, /prefer.*srcwalk/i);
  assert.match(POLICY, FALLBACK);
  assert.match(POLICY, /fall back/i);
  assert.match(POLICY, BUILTINS);
});

test("every standalone agent carries the same srcwalk fallback contract", () => {
  const agentDir = join(ROOT, ".pi", "agents");
  for (const file of readdirSync(agentDir).filter((name) => name.endsWith(".md") && name !== "README.md")) {
    const content = readFileSync(join(agentDir, file), "utf8");
    assert.match(content, FALLBACK, `${file}: missing srcwalk capability check`);
    assert.match(content, /fall back/i, `${file}: missing navigation fallback`);
  }
});

test("portable harness does not depend on a postinstall-downloaded srcwalk binary", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies?.srcwalk, undefined);
});
