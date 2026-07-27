import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "init-consumer.mjs");
const TEMPLATE = join(REPO_ROOT, "templates", "consumer-settings.json");

function runInit(args: string[]): string {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function makeTargetDir(): string {
  return mkdtempSync(join(tmpdir(), "init-consumer-"));
}

test("consumer settings template parses and stays minimal", () => {
  const parsed = JSON.parse(readFileSync(TEMPLATE, "utf8"));

  assert.ok(Array.isArray(parsed.packages), "packages must be an array");
  assert.ok(
    parsed.packages.every((entry: string) => entry.includes("@minhduydev/")),
    "template pins only @minhduydev packages",
  );
  assert.equal(parsed.compaction?.enabled, true);
  assert.equal(parsed.retry?.enabled, true);
  assert.ok(parsed["pi-learning"], "pi-learning profile present");
  assert.ok(parsed["pi-todo"], "pi-todo profile present");
  for (const personalKey of ["theme", "powerline", "piTui", "editorPaddingX", "doubleEscapeAction"]) {
    assert.ok(!(personalKey in parsed), `personal key must not ship in template: ${personalKey}`);
  }
});

test("package exposes the consumer bootstrap as a CLI", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(pkg.bin?.["pi-harness-init"], "./scripts/init-consumer.mjs");
});

test("--dry-run writes no files", () => {
  const target = makeTargetDir();
  try {
    const output = runInit([target, "--dry-run"]);
    assert.match(output, /dry-run/);
    assert.ok(!existsSync(join(target, ".pi")), "dry-run must not create .pi/");
    assert.ok(!existsSync(join(target, ".pi", "settings.json")));
    assert.ok(!existsSync(join(target, ".pi", "artifacts", ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("real run creates settings and artifacts gitignore in a fresh repo", () => {
  const target = makeTargetDir();
  try {
    const output = runInit([target]);
    assert.match(output, /Wrote .*settings\.json/);

    const settingsPath = join(target, ".pi", "settings.json");
    assert.ok(existsSync(settingsPath), "settings.json created");
    assert.deepEqual(
      JSON.parse(readFileSync(settingsPath, "utf8")),
      JSON.parse(readFileSync(TEMPLATE, "utf8")),
      "written settings match the template",
    );

    const gitignorePath = join(target, ".pi", "artifacts", ".gitignore");
    assert.ok(existsSync(gitignorePath), "artifacts .gitignore created");
    assert.equal(readFileSync(gitignorePath, "utf8").trim(), "*");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("does not overwrite an existing settings file", () => {
  const target = makeTargetDir();
  try {
    const settingsPath = join(target, ".pi", "settings.json");
    mkdirSync(join(target, ".pi"), { recursive: true });
    const existing = JSON.stringify({ theme: "custom", packages: [] }, null, 2);
    writeFileSync(settingsPath, existing, "utf8");

    const output = runInit([target]);
    assert.match(output, /not overwriting/);
    assert.match(output, /Suggested additions/);
    assert.equal(readFileSync(settingsPath, "utf8"), existing, "existing settings untouched");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
