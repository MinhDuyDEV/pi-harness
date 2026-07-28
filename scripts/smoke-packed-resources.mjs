#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { assertPackageResourcesLoad } from "./lib/resource-smoke.mjs";
import { readSuitePins, SUITE_PACKAGE_NAMES } from "./lib/suite-pins.mjs";

const repoRoot = process.cwd();
let consumerRoot;

function packLocalSibling(packageName, destination) {
  const directoryName = packageName.slice("@minhduydev/".length);
  const siblingRoot = resolve(repoRoot, "..", directoryName);
  assert.ok(
    existsSync(join(siblingRoot, "package.json")),
    `PI_E2E_SIBLINGS=local requires a ${directoryName} checkout next to this repo`,
  );
  execFileSync("npm", ["run", "build", "--if-present"], {
    cwd: siblingRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", destination],
    { cwd: siblingRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim().split("\n").at(-1);
  assert.ok(tarball, `npm pack must return a tarball name for ${directoryName}`);
  return join(destination, tarball);
}

function addHandler(store, name, handler) {
  const handlers = store.get(name) ?? [];
  handlers.push(handler);
  store.set(name, handlers);
  return () => {
    const current = store.get(name) ?? [];
    store.set(name, current.filter((candidate) => candidate !== handler));
  };
}

function createPackedRuntimeHarness() {
  const tools = new Map();
  const lifecycleHandlers = new Map();
  const eventHandlers = new Map();
  const api = {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    registerMessageRenderer() {},
    sendMessage() {},
    on(name, handler) {
      return addHandler(lifecycleHandlers, name, handler);
    },
    events: {
      on(name, handler) {
        return addHandler(eventHandlers, name, handler);
      },
      async emit(name, payload) {
        const results = [];
        for (const handler of eventHandlers.get(name) ?? []) {
          results.push(await handler(payload));
        }
        return results;
      },
    },
    ui: { notify() {} },
  };
  return { api, lifecycleHandlers, tools };
}

function createPackedUpstream(delegatedTaskId) {
  return (pi) => {
    pi.registerTool({
      name: "task",
      label: "Task",
      description: "Packed smoke upstream",
      parameters: {
        type: "object",
        required: ["agent_type", "prompt", "description"],
        properties: {
          agent_type: { type: "string" },
          prompt: { type: "string" },
          description: { type: "string" },
          background: { type: "boolean" },
          task_id: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute() {
        return {
          content: [{ type: "text", text: "Packed delegated task completed." }],
          details: {
            taskId: delegatedTaskId,
            execution_phase: "done",
            reported_status: "success",
          },
        };
      },
    });
  };
}

async function runPackedDelegationSmoke(consumerDirectory) {
  const subagentsRoot = join(
    consumerDirectory,
    "node_modules",
    "@minhduydev",
    "pi-subagents",
  );
  const runtime = await import(
    pathToFileURL(join(subagentsRoot, "dist", "orchestration", "runtime.js")).href
  );
  const delegatedTaskId = "packed-smoke-delegation";
  const { api, lifecycleHandlers, tools } = createPackedRuntimeHarness();
  runtime.createTaskRuntime(createPackedUpstream(delegatedTaskId))(api);
  const runtimeContext = {
    cwd: consumerDirectory,
    hasUI: false,
    ui: {
      notify() {},
      setStatus() {},
      setWidget() {},
    },
  };
  for (const handler of lifecycleHandlers.get("session_start") ?? []) {
    await handler({}, runtimeContext);
  }
  const task = tools.get("task");
  assert.ok(task, "installed pi-subagents must register the delegated task tool");
  const result = await task.execute(
    "packed-smoke-call",
    {
      agent_type: "general",
      prompt: "Return a minimal successful delegated result.",
      description: "Packed consumer delegation smoke",
      background: false,
    },
    new AbortController().signal,
    undefined,
    { cwd: consumerDirectory, ui: { notify() {} } },
  );
  assert.equal(result.isError, undefined, "minimal packed delegation must succeed");

  assert.equal(result.details?.taskId, delegatedTaskId);
  assert.match(result.content?.[0]?.text ?? "", /packed delegated task completed/i);

  for (const handler of lifecycleHandlers.get("session_shutdown") ?? []) {
    await handler();
  }
  return delegatedTaskId;
}

try {
  consumerRoot = mkdtempSync(join(tmpdir(), "pi-harness-packed-consumer-"));
  writeFileSync(
    join(consumerRoot, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
    "utf8",
  );

  const harnessTarball = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", consumerRoot],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim().split("\n").at(-1);
  assert.ok(harnessTarball, "npm pack must return the harness tarball name");

  const pins = readSuitePins(join(repoRoot, ".pi", "settings.json"));
  const suiteSpecs = process.env.PI_E2E_SIBLINGS === "local"
    ? SUITE_PACKAGE_NAMES.map((name) => packLocalSibling(name, consumerRoot))
    : SUITE_PACKAGE_NAMES.map((name) => pins[name].spec);
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      ...suiteSpecs,
      join(consumerRoot, harnessTarball),
    ],
    { cwd: consumerRoot, stdio: "inherit" },
  );

  const packageRoot = join(consumerRoot, "node_modules", "@minhduydev", "pi-harness");
  for (const leak of [".pi/artifacts", ".pi/MEMORY.md", ".pi/npm"]) {
    if (existsSync(join(packageRoot, leak))) {
      throw new Error(`local runtime path leaked into packed package: ${leak}`);
    }
  }

  // Package discovery cannot apply .pi/agents. The installed bootstrap must
  // create project-local profiles without reaching back to this checkout.
  execFileSync(process.execPath, [join(packageRoot, "scripts", "init-consumer.mjs"), consumerRoot], {
    cwd: consumerRoot,
    stdio: "inherit",
  });
  const agentDir = join(consumerRoot, ".pi", "agents");
  for (const profile of ["explore", "general", "implementer", "peer", "proof-auditor", "reviewer", "scout"]) {
    const consumerAgent = join(agentDir, `${profile}.md`);
    assert.equal(
      readFileSync(consumerAgent, "utf8"),
      readFileSync(join(packageRoot, ".pi", "agents", `${profile}.md`), "utf8"),
      `bootstrap must materialize the packed ${profile}.md profile`,
    );
  }
  for (const template of [
    "AGENTS.md",
    "adr.md",
    "agent-run-report.md",
    "prd.md",
    "skill-config.md",
    "skill-tooled.md",
    "sprint-design.md",
    "sprint-state.json",
  ]) {
    assert.equal(
      readFileSync(join(consumerRoot, ".pi", "templates", template), "utf8"),
      readFileSync(join(packageRoot, ".pi", "templates", template), "utf8"),
      `bootstrap must materialize the packed ${template} template`,
    );
  }
  assert.equal(
    readFileSync(join(consumerRoot, ".pi", "ANTI_PATTERNS.md"), "utf8"),
    readFileSync(join(packageRoot, ".pi", "ANTI_PATTERNS.md"), "utf8"),
    "bootstrap must materialize the packed anti-pattern catalog",
  );
  const packageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const consumerSettings = JSON.parse(readFileSync(join(consumerRoot, ".pi", "settings.json"), "utf8"));
  assert.ok(
    consumerSettings.packages.includes(`npm:${packageManifest.name}@${packageManifest.version}`),
    "bootstrap must pin the exact packed harness version in project settings",
  );
  assert.equal(consumerSettings["pi-harness"]?.profile, "full");
  const ownership = JSON.parse(readFileSync(join(consumerRoot, ".pi", "pi-harness.lock.json"), "utf8"));
  assert.deepEqual(ownership.harness, { name: packageManifest.name, version: packageManifest.version });
  assert.ok(ownership.files[".pi/APPEND_SYSTEM.md#managed-policy"]);
  assert.ok(ownership.files[".gitignore#pi-harness-runtime"]);

  // A packed clean-consumer rerun is a no-op rather than a rewrite.
  const lockBeforeRerun = readFileSync(join(consumerRoot, ".pi", "pi-harness.lock.json"), "utf8");
  execFileSync(process.execPath, [join(packageRoot, "scripts", "init-consumer.mjs"), consumerRoot], {
    cwd: consumerRoot,
    stdio: "inherit",
  });
  assert.equal(
    readFileSync(join(consumerRoot, ".pi", "pi-harness.lock.json"), "utf8"),
    lockBeforeRerun,
  );

  const helpersPath = join(
    consumerRoot,
    "node_modules",
    "@minhduydev",
    "pi-subagents",
    "dist",
    "helpers.js",
  );
  const helpers = await import(pathToFileURL(helpersPath).href);
  const discovered = helpers.discoverAgents(consumerRoot).agents;
  const preflight = helpers.resolveTaskAgentPreflight(discovered, "general");
  assert.equal(preflight.ok, true, "clean consumer task preflight resolves the scaffolded general agent");
  const delegatedTaskId = await runPackedDelegationSmoke(consumerRoot);

  const settings = SettingsManager.inMemory({ packages: [packageRoot] });
  settings.setProjectTrusted(true);
  const loader = new DefaultResourceLoader({
    cwd: consumerRoot,
    agentDir: join(consumerRoot, ".pi"),
    settingsManager: settings,
  });
  await loader.reload();

  const summary = assertPackageResourcesLoad(loader, { packageRoot });
  console.error(
    `✓ packed package smoke: ${JSON.stringify(summary)}; ${discovered.length} task agents discovered; delegated task ${delegatedTaskId} completed`,
  );
} finally {
  if (consumerRoot) rmSync(consumerRoot, { recursive: true, force: true });
}
