import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflowPath = ".github/workflows/ci.yml";

test("CI has least-privilege permissions and bounded execution", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^permissions:\s*\n\s+contents:\s+read\s*$/m);
  assert.match(workflow, /timeout-minutes:\s*\d+/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
});

test("CI pins third-party actions to immutable commit SHAs", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);

  assert.ok(uses.length >= 2, "expected checkout and setup-node actions");
  for (const action of uses) {
    assert.match(action, /@[0-9a-f]{40}$/i, `${action} is not pinned to a full commit SHA`);
  }
});

test("CI uses the reproducible install and release gates exactly once", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.equal(workflow.match(/npm run release:check:local/g)?.length, 1);
  assert.doesNotMatch(workflow, /npm run check(?:\s|$)/, "release:check already owns the full check");
  assert.doesNotMatch(workflow, /npm pack --dry-run/, "release:check owns package validation");
});

test("publish uses the single non-recursive release gate", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const releaseCheck = await readFile("scripts/release-check.mjs", "utf8");

  assert.equal(packageJson.scripts.prepublishOnly, "npm run release:check:registry");
  assert.equal(packageJson.scripts["release:check"], "npm run release:check:local");
  assert.match(packageJson.scripts["release:check:registry"], /--mode=registry/);
  assert.equal(packageJson.scripts["pack:check"], "npm run validate:package-payload");
  const releaseCommands = [
    /args: \["run", "check"\]/g,
    /args: \["audit"\]/g,
    /args: \["run", "pack:check"\]/g,
    /args: \["run", "smoke:packed"\]/g,
  ];
  for (const command of releaseCommands) {
    assert.equal(releaseCheck.match(command)?.length, 1, `${command.source} must occur exactly once`);
  }
  assert.doesNotMatch(releaseCheck, /args: \["(?:publish|pack)"/);
});
