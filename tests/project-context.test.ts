import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();

test(".pi/APPEND_SYSTEM.md defines the portable runtime contract", async () => {
  const content = await readFile(join(ROOT, ".pi", "APPEND_SYSTEM.md"), "utf8");

  assert.match(content, /Pi harness runtime guidance/);
  assert.match(content, /higher-priority instructions/i);
  assert.match(content, /preserve unrelated/i);
  assert.match(content, /optional tools? or extensions?/i);
  assert.match(content, /delegat/i);
  assert.match(content, /verification/i);
  assert.match(content, /do not claim/i);
  assert.doesNotMatch(content, /validate:skills|typecheck:diagnostics|test:diagnostics/);
  assert.ok(content.length < 8_000, `APPEND_SYSTEM.md is too large: ${content.length}`);
});

test("root AGENTS.md owns package-development instructions", async () => {
  const content = await readFile(join(ROOT, "AGENTS.md"), "utf8");

  assert.match(content, /Pi Coding Agent package/);
  assert.match(content, /npm run check/);
  assert.match(content, /npm run pack:check/);
  assert.match(content, /\.pi\/settings\.json/);
  assert.match(content, /provider.*model.*portable/i);
  assert.match(content, /installed package/i);
  assert.match(content, /APPEND_SYSTEM\.md/);
  assert.doesNotMatch(content, /functions\.(read|bash|task)/);
  assert.ok(content.length < 8_000, `AGENTS.md is too large: ${content.length}`);
});

test("the obsolete .pi/AGENTS.md context file stays removed", async () => {
  await assert.rejects(access(join(ROOT, ".pi", "AGENTS.md")));
});
