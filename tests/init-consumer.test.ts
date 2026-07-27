import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

function makeSpacedTargetDir(): string {
  return mkdtempSync(join(tmpdir(), "init consumer space "));
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
  assert.equal(parsed["pi-harness"]?.profile, "standard");
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
    assert.ok(!existsSync(join(target, ".pi", "agents")));
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

    const expectedAgents = readdirSync(join(REPO_ROOT, ".pi", "agents"))
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .sort();
    const actualAgents = readdirSync(join(target, ".pi", "agents")).sort();
    assert.deepEqual(actualAgents, expectedAgents, "all canonical profiles are discoverable by pi-subagents");
    for (const name of expectedAgents) {
      assert.equal(
        readFileSync(join(target, ".pi", "agents", name), "utf8"),
        readFileSync(join(REPO_ROOT, ".pi", "agents", name), "utf8"),
      );
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("deep-merges missing portable settings without overwriting consumer values", () => {
  const target = makeTargetDir();
  try {
    const settingsPath = join(target, ".pi", "settings.json");
    mkdirSync(join(target, ".pi"), { recursive: true });
    const existing = JSON.stringify(
      {
        theme: "custom",
        packages: ["npm:consumer-owned@1.0.0"],
        "pi-harness": { profile: "minimal" },
      },
      null,
      2,
    );
    writeFileSync(settingsPath, existing, "utf8");

    const output = runInit([target]);
    assert.match(output, /Merged missing portable settings/);
    assert.match(output, /packages \(appended missing values\)/);
    const merged = JSON.parse(readFileSync(settingsPath, "utf8"));
    const template = JSON.parse(readFileSync(TEMPLATE, "utf8"));
    assert.equal(merged.theme, "custom", "consumer-only settings survive");
    assert.equal(merged["pi-harness"].profile, "minimal", "consumer values win");
    assert.deepEqual(
      merged.packages,
      ["npm:consumer-owned@1.0.0", ...template.packages],
      "missing suite pins append without replacing consumer packages",
    );
    assert.deepEqual(merged.compaction, template.compaction, "missing nested template objects merge");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("keeps a consumer package pin when the template has a different version", () => {
  const target = makeTargetDir();
  try {
    const settingsPath = join(target, ".pi", "settings.json");
    mkdirSync(join(target, ".pi"), { recursive: true });
    const template = JSON.parse(readFileSync(TEMPLATE, "utf8"));
    const templatePin = template.packages[0] as string;
    const consumerPin = templatePin.replace(/@[^@]+$/u, "@9.9.9");
    writeFileSync(
      settingsPath,
      JSON.stringify({ packages: [consumerPin] }, null, 2),
      "utf8",
    );

    const output = runInit([target]);
    const merged = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(merged.packages.filter((entry: string) =>
      entry.startsWith("npm:@minhduydev/pi-core@")).length, 1);
    assert.equal(merged.packages[0], consumerPin);
    assert.match(output, /packages\[npm:@minhduydev\/pi-core\]/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("bootstrap is idempotent and handles target paths containing spaces", () => {
  const target = makeSpacedTargetDir();
  try {
    runInit([target]);
    const settingsPath = join(target, ".pi", "settings.json");
    const before = readFileSync(settingsPath, "utf8");
    const output = runInit([target]);
    assert.match(output, /already contains every portable setting/);
    assert.equal(readFileSync(settingsPath, "utf8"), before);
    assert.ok(existsSync(join(target, ".pi", "agents", "general.md")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("dry-run reports an existing settings merge without changing bytes", () => {
  const target = makeTargetDir();
  try {
    const settingsPath = join(target, ".pi", "settings.json");
    mkdirSync(join(target, ".pi"), { recursive: true });
    const existing = '{\n  "theme": "custom"\n}\n';
    writeFileSync(settingsPath, existing, "utf8");
    const output = runInit([target, "--dry-run"]);
    assert.match(output, /would merge missing portable settings/);
    assert.equal(readFileSync(settingsPath, "utf8"), existing);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("consumer-owned incompatible setting shapes are retained and reported", () => {
  const target = makeTargetDir();
  try {
    const settingsPath = join(target, ".pi", "settings.json");
    mkdirSync(join(target, ".pi"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ packages: "consumer-loader", "pi-harness": false }),
      "utf8",
    );
    const output = runInit([target]);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(settings.packages, "consumer-loader");
    assert.equal(settings["pi-harness"], false);
    assert.match(output, /incompatible paths retained: packages, pi-harness/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("does not overwrite an existing agent profile", () => {
  const target = makeTargetDir();
  try {
    const agentDir = join(target, ".pi", "agents");
    mkdirSync(agentDir, { recursive: true });
    const custom = "---\ndescription: consumer-owned\n---\n# General\n";
    writeFileSync(join(agentDir, "general.md"), custom, "utf8");
    const output = runInit([target]);
    assert.match(output, /general\.md/);
    assert.match(output, /not overwriting/);
    assert.equal(readFileSync(join(agentDir, "general.md"), "utf8"), custom);
    assert.ok(existsSync(join(agentDir, "reviewer.md")), "other missing profiles are still installed");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("--no-agents leaves a consumer-owned roster absent", () => {
  const target = makeTargetDir();
  try {
    runInit([target, "--no-agents"]);
    assert.ok(existsSync(join(target, ".pi", "settings.json")));
    assert.ok(!existsSync(join(target, ".pi", "agents")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
