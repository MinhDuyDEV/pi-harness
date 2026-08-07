import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "init-consumer.mjs");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  name: string;
  version: string;
  bin?: Record<string, string>;
};
const AGENTS = [
  "explore.md",
  "general.md",
  "implementer.md",
  "peer.md",
  "proof-auditor.md",
  "reviewer.md",
  "scout.md",
];
const START_POLICY = "<!-- pi-harness managed policy:start -->";
const END_POLICY = "<!-- pi-harness managed policy:end -->";
const START_IGNORE = "# pi-harness managed runtime state:start";
const END_IGNORE = "# pi-harness managed runtime state:end";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "pi-harness-init-"));
}

function runInit(target: string, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args, target], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function walk(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return files.sort();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function managedRegion(value: string, startMarker: string, endMarker: string): string {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return value.slice(start + startMarker.length, end).replace(/^\n|\n$/g, "");
}

function managedPolicy(value: string): string {
  return managedRegion(value, START_POLICY, END_POLICY);
}

test("consumer settings template is the source Full portable settings contract", () => {
  const source = readJson(join(ROOT, ".pi", "settings.json"));
  const template = readJson(join(ROOT, "templates", "consumer-settings.json"));
  assert.deepEqual(template, source);
  assert.equal(template["pi-harness"].profile, "full");
  assert.equal(template.defaultProvider, undefined);
  assert.equal(template.defaultModel, undefined);
  assert.equal(template.theme, undefined);
});

test("clean init materializes the complete self-contained Full harness", () => {
  const target = tempRepo();
  try {
    const result = runInit(target);
    assert.equal(result.status, 0, result.stderr);

    const piRoot = join(target, ".pi");
    assert.deepEqual(walk(join(piRoot, "templates")), walk(join(ROOT, ".pi", "templates")));
    assert.deepEqual(readdirSync(join(piRoot, "agents")).sort(), AGENTS);
    for (const file of AGENTS) {
      assert.equal(
        readFileSync(join(piRoot, "agents", file), "utf8"),
        readFileSync(join(ROOT, ".pi", "agents", file), "utf8"),
      );
    }
    for (const file of walk(join(ROOT, ".pi", "templates"))) {
      assert.equal(
        readFileSync(join(piRoot, "templates", file), "utf8"),
        readFileSync(join(ROOT, ".pi", "templates", file), "utf8"),
      );
    }
    assert.equal(
      readFileSync(join(piRoot, "ANTI_PATTERNS.md"), "utf8"),
      readFileSync(join(ROOT, ".pi", "ANTI_PATTERNS.md"), "utf8"),
    );
    assert.equal(
      managedPolicy(readFileSync(join(piRoot, "APPEND_SYSTEM.md"), "utf8")),
      readFileSync(join(ROOT, ".pi", "APPEND_SYSTEM.md"), "utf8").trimEnd(),
    );

    const settings = readJson(join(piRoot, "settings.json"));
    assert.deepEqual(settings["pi-harness"], readJson(join(ROOT, ".pi", "settings.json"))["pi-harness"]);
    assert.ok(settings.packages.includes(`npm:${PACKAGE.name}@${PACKAGE.version}`));
    for (const companion of ["pi-core", "pi-learning", "pi-subagents", "pi-todo"]) {
      assert.equal(
        settings.packages.filter((entry: string) =>
          entry.match(new RegExp(`^npm:@minhduydev/${companion}@\\d+\\.\\d+\\.\\d+$`)),
        ).length,
        1,
        `${companion} has one exact pin`,
      );
    }

    const ignore = readFileSync(join(target, ".gitignore"), "utf8");
    for (const runtimePath of [
      ".pi/artifacts/",
      ".pi/MEMORY.md",
      ".pi/npm/",
      ".pi/git/",
      ".pi/cache/",
      ".pi/checkpoints/",
      ".pi/dcp-state/",
      ".pi/sessions/",
      ".pi/tasks/",
      ".pi/memory/project/user.md",
      ".pi/herdr/",
      ".pi/task-session-history.json",
      ".pi/trust.json",
      ".pi/auth.json",
      ".pi/mcp.json",
    ]) {
      assert.match(ignore, new RegExp(runtimePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    for (const trackedPath of [
      "AGENTS.md",
      "PROJECT.md",
      ".pi/settings.json",
      ".pi/APPEND_SYSTEM.md",
      ".pi/ANTI_PATTERNS.md",
      ".pi/pi-harness.lock.json",
      ".pi/agents/",
      ".pi/templates/",
      ".pi/memory/project/tech-stack.md",
    ]) {
      assert.doesNotMatch(ignore, new RegExp(`^${trackedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    }

    const lock = readJson(join(piRoot, "pi-harness.lock.json"));
    assert.equal(lock.schemaVersion, 1);
    assert.deepEqual(lock.harness, { name: PACKAGE.name, version: PACKAGE.version });
    assert.deepEqual(lock.packages, settings.packages.slice(0, lock.packages.length));
    for (const consumerPath of [
      ".pi/ANTI_PATTERNS.md",
      ...AGENTS.map((file) => `.pi/agents/${file}`),
      ...walk(join(ROOT, ".pi", "templates")).map((file) => `.pi/templates/${file}`),
      ".pi/artifacts/.gitignore",
    ]) {
      assert.equal(
        lock.files[consumerPath].sha256,
        sha256(readFileSync(join(target, consumerPath), "utf8")),
        `${consumerPath} lock hash matches materialized content`,
      );
    }
    assert.equal(
      lock.files[".pi/APPEND_SYSTEM.md#managed-policy"].sha256,
      sha256(managedPolicy(readFileSync(join(piRoot, "APPEND_SYSTEM.md"), "utf8"))),
    );
    assert.equal(
      lock.files[".gitignore#pi-harness-runtime"].sha256,
      sha256(managedRegion(ignore, START_IGNORE, END_IGNORE)),
    );

    assert.deepEqual(readdirSync(join(piRoot, "artifacts")), [".gitignore"]);
    assert.equal(readFileSync(join(piRoot, "artifacts", ".gitignore"), "utf8"), "*\n");
    for (const forbidden of ["AGENTS.md", "PROJECT.md", ".pi/README.md", ".pi/DESIGN.md", ".pi/MEMORY.md"]) {
      assert.equal(statOrNull(join(target, forbidden)), null, `${forbidden} is not copied`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

function statOrNull(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

test("rerun is convergent and performs no unnecessary writes", async () => {
  const target = tempRepo();
  try {
    assert.equal(runInit(target).status, 0);
    const watched = [
      ".pi/settings.json",
      ".pi/APPEND_SYSTEM.md",
      ".pi/ANTI_PATTERNS.md",
      ".pi/agents/general.md",
      ".pi/templates/AGENTS.md",
      ".pi/pi-harness.lock.json",
      ".gitignore",
    ];
    const before = new Map(watched.map((file) => [file, statSync(join(target, file)).mtimeMs]));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    const rerun = runInit(target);
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.match(rerun.stdout, /already current/i);
    for (const file of watched) {
      assert.equal(statSync(join(target, file)).mtimeMs, before.get(file), `${file} was not rewritten`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("managed agents, templates, and catalogs update from baselines and reject consumer conflicts", () => {
  const target = tempRepo();
  try {
    assert.equal(runInit(target).status, 0);
    const lockPath = join(target, ".pi", "pi-harness.lock.json");
    const managed = [
      { consumerPath: ".pi/agents/general.md", sourcePath: ".pi/agents/general.md" },
      { consumerPath: ".pi/templates/AGENTS.md", sourcePath: ".pi/templates/AGENTS.md" },
      { consumerPath: ".pi/ANTI_PATTERNS.md", sourcePath: ".pi/ANTI_PATTERNS.md" },
    ];
    const lock = readJson(lockPath);

    for (const [index, file] of managed.entries()) {
      const oldManaged = `old harness-owned resource ${index}\n`;
      writeFileSync(join(target, file.consumerPath), oldManaged);
      lock.files[file.consumerPath].sha256 = sha256(oldManaged);
    }
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const upgrade = runInit(target);
    assert.equal(upgrade.status, 0, upgrade.stderr);
    for (const file of managed) {
      assert.equal(
        readFileSync(join(target, file.consumerPath), "utf8"),
        readFileSync(join(ROOT, file.sourcePath), "utf8"),
      );
    }

    for (const [index, file] of managed.entries()) {
      writeFileSync(join(target, file.consumerPath), `consumer customization ${index}\n`);
    }
    const conflict = runInit(target);
    assert.notEqual(conflict.status, 0);
    for (const [index, file] of managed.entries()) {
      assert.match(conflict.stderr, new RegExp(`conflict.*${file.consumerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
      assert.equal(readFileSync(join(target, file.consumerPath), "utf8"), `consumer customization ${index}\n`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("rejects unsafe stale paths from a tampered ownership lock without deleting consumer files", () => {
  const target = tempRepo();
  try {
    assert.equal(runInit(target).status, 0);
    const outside = join(target, "consumer-owned.txt");
    writeFileSync(outside, "keep me\n");
    const lockPath = join(target, ".pi", "pi-harness.lock.json");
    const lock = readJson(lockPath);
    lock.files[".pi/templates/../../consumer-owned.txt"] = {
      sha256: sha256("keep me\n"),
    };
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const result = runInit(target);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid managed path|conflict/i);
    assert.equal(readFileSync(outside, "utf8"), "keep me\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("managed policy upgrades preserve consumer prose outside the sentinels", () => {
  const target = tempRepo();
  try {
    writeFileSync(join(target, "placeholder"), "x");
    assert.equal(runInit(target).status, 0);
    const policyPath = join(target, ".pi", "APPEND_SYSTEM.md");
    const lockPath = join(target, ".pi", "pi-harness.lock.json");
    const oldBody = "# Old managed policy";
    writeFileSync(
      policyPath,
      `Consumer preface\n\n${START_POLICY}\n${oldBody}\n${END_POLICY}\n\nConsumer epilogue\n`,
    );
    const lock = readJson(lockPath);
    lock.files[".pi/APPEND_SYSTEM.md#managed-policy"].sha256 = sha256(oldBody);
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const result = runInit(target);
    assert.equal(result.status, 0, result.stderr);
    const updated = readFileSync(policyPath, "utf8");
    assert.match(updated, /^Consumer preface/m);
    assert.match(updated, /Consumer epilogue$/m);
    assert.equal(managedPolicy(updated), readFileSync(join(ROOT, ".pi/APPEND_SYSTEM.md"), "utf8").trimEnd());

    const customized = updated.replace(managedPolicy(updated), "consumer changed the managed policy");
    writeFileSync(policyPath, customized);
    const conflict = runInit(target);
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /conflict.*\.pi\/APPEND_SYSTEM\.md/i);
    assert.equal(readFileSync(policyPath, "utf8"), customized);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("settings migrate stale Full-owned values while preserving consumer packages and options", () => {
  const target = tempRepo();
  try {
    writeFileSync(
      join(target, ".gitignore"),
      "dist/\n",
    );
    const pi = join(target, ".pi");
    // init creates the directory; seed through a first run, then simulate a legacy settings file.
    assert.equal(runInit(target).status, 0);
    writeFileSync(
      join(pi, "settings.json"),
      JSON.stringify({
        packages: [
          "npm:@minhduydev/pi-harness@0.8.0",
          "git:github.com/MinhDuyDEV/pi-harness#legacy",
          "git:github.com/acme/minhduydev/pi-harness-tools#keep",
          "npm:@minhduydev/pi-subagents@0.9.0",
          "npm:consumer-owned-package@4.5.6",
        ],
        "pi-harness": {
          profile: "standard",
          extensions: { tui: false, diagnostics: false, deepseek: false },
        },
        "pi-learning": { profile: "manual", consumerOption: true },
        consumerSetting: { keep: true },
      }, null, 2),
    );

    const result = runInit(target);
    assert.equal(result.status, 0, result.stderr);
    const settings = readJson(join(pi, "settings.json"));
    assert.ok(settings.packages.includes(`npm:${PACKAGE.name}@${PACKAGE.version}`));
    assert.ok(settings.packages.includes("npm:consumer-owned-package@4.5.6"));
    assert.equal(settings.packages.some((entry: string) => entry.includes("pi-harness@0.8.0")), false);
    assert.equal(settings.packages.some((entry: string) => entry.includes("pi-harness#legacy")), false);
    assert.equal(
      settings.packages.includes("git:github.com/acme/minhduydev/pi-harness-tools#keep"),
      true,
    );
    assert.equal(settings.packages.some((entry: string) => entry.includes("pi-subagents@0.9.0")), false);
    assert.equal(settings["pi-harness"].profile, "full");
    for (const [key, value] of Object.entries(
      readJson(join(ROOT, ".pi", "settings.json"))["pi-harness"].extensions,
    )) {
      assert.equal(settings["pi-harness"].extensions[key], value, `${key} is forced to the Full value`);
    }
    for (const retired of ["deepseek", "mimo", "xai", "tui"]) {
      assert.equal(
        retired in settings["pi-harness"].extensions,
        false,
        `${retired} native capability must be pruned from stale consumer settings`,
      );
    }
    assert.equal(settings["pi-learning"].profile, "manual");
    assert.equal(settings["pi-learning"].consumerOption, true);
    assert.deepEqual(settings.consumerSetting, { keep: true });
    assert.match(readFileSync(join(target, ".gitignore"), "utf8"), /^dist\//);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("rejects a missing target directory instead of creating a typo path", () => {
  const parent = tempRepo();
  const target = join(parent, "missing-target");
  try {
    const result = runInit(target);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /target.*exist|directory/i);
    assert.equal(statOrNull(target), null);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("rejects symlinked managed ancestors without writing outside the target", () => {
  const target = tempRepo();
  const outside = tempRepo();
  try {
    symlinkSync(outside, join(target, ".pi"), "dir");
    const result = runInit(target);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symbolic link|symlink/i);
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("dry-run previews Full init without writes and --no-agents is rejected", () => {
  const target = tempRepo();
  try {
    const dryRun = runInit(target, ["--dry-run"]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /would create.*templates/i);
    assert.equal(statOrNull(join(target, ".pi")), null);

    const obsolete = runInit(target, ["--no-agents"]);
    assert.notEqual(obsolete.status, 0);
    assert.match(obsolete.stderr, /unknown option.*--no-agents/i);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
