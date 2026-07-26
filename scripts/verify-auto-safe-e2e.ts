import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createEventBus } from "@earendil-works/pi-coding-agent";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const LEARNING_OBSERVATION_EVENT = "pi-learning:observation:v1";
const SUBAGENT_CONTEXT_REQUEST_EVENT = "pi-subagents:v1:context-request";
const SUBAGENT_PROOF_EVENT = "pi-subagents:v1:proof-verified";
const DIGEST = "a".repeat(64);
const SETTINGS = {
  "pi-learning": {
    enabled: true,
    mode: "auto-safe",
    autoActivate: true,
    autoInject: true,
    autoActivation: {
      enabled: true,
      allowedKinds: ["pattern", "discovery"],
      minEvidenceTrust: "verified-command",
    },
    autoInjection: { enabled: true },
    retrieval: { mode: "explicit", maxItems: 3, maxItemChars: 400, maxTotalChars: 1200 },
  },
};

type LifecycleHandler = (event: unknown, context: RuntimeContext) => unknown | Promise<unknown>;

interface RuntimeContext {
  cwd: string;
  hasUI: boolean;
  isProjectTrusted: () => boolean;
  ui: {
    confirm: () => Promise<boolean>;
    input: () => Promise<string | undefined>;
    notify: () => void;
  };
}

interface Runtime {
  root: string;
  events: ReturnType<typeof createEventBus>;
  dispatch(name: string, event?: unknown): Promise<unknown[]>;
}

interface Consumer {
  path: string;
  installCoordinator: (api: unknown) => void;
}

interface LearningContext {
  version: 1;
  facts: Array<{ domain: string; summary: string; confidence: string; evidenceDigest?: string }>;
}

async function installConsumer(root: string): Promise<Consumer> {
  const consumer = join(root, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const packedName = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", root],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim().split("\n").at(-1);
  assert.ok(packedName, "npm pack must return the harness tarball name");
  const packages = [
    "@earendil-works/pi-coding-agent@0.81.1",
    "@earendil-works/pi-tui@0.81.1",
    "typebox@1.1.38",
    process.env.PI_LEARNING_SPEC ?? "@minhduydev/pi-learning@0.1.2",
    process.env.PI_SUBAGENTS_SPEC ?? "@minhduydev/pi-subagents@0.6.1",
    process.env.PI_TODO_SPEC ?? "github:MinhDuyDEV/pi-todo#b7dbf9c1650394df6a6388d803fd5109294ed5d3",
    join(root, packedName),
  ];
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", ...packages], {
    cwd: consumer,
    stdio: "inherit",
  });
  const coordinator = await loadPackageModule(
    consumer,
    "pi-harness/.pi/extensions/learning-coordinator/index.ts",
  );
  return {
    path: consumer,
    installCoordinator: coordinator.default as (api: unknown) => void,
  };
}

async function loadPackageModule(consumer: string, relativePath: string): Promise<Record<string, unknown>> {
  const modulePath = resolve(consumer, "node_modules", relativePath);
  return import(pathToFileURL(modulePath).href) as Promise<Record<string, unknown>>;
}

async function createRuntime(consumer: Consumer, root: string, trusted: boolean): Promise<Runtime> {
  mkdirSync(join(root, ".pi"), { recursive: true });
  writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify(SETTINGS));
  const events = createEventBus();
  const handlers = new Map<string, LifecycleHandler[]>();
  const pi = {
    events,
    on(name: string, handler: LifecycleHandler): void {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(): void {},
  };
  consumer.installCoordinator(pi);
  const learningModule = await loadPackageModule(consumer.path, "@minhduydev/pi-learning/dist/index.js");
  const installLearning = learningModule.default as (api: unknown) => void;
  installLearning(pi);
  const context: RuntimeContext = {
    cwd: root,
    hasUI: false,
    isProjectTrusted: () => trusted,
    ui: {
      confirm: async () => false,
      input: async () => undefined,
      notify: () => undefined,
    },
  };
  const dispatch = async (name: string, event: unknown = {}): Promise<unknown[]> => {
    const results: unknown[] = [];
    for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context));
    return results;
  };
  await dispatch("session_start");
  return { root, events, dispatch };
}

function request(id: string, description: string): Record<string, unknown> {
  return {
    protocolVersion: 1,
    taskId: `invocation-${id}`,
    correlationId: `correlation-${id}`,
    agentType: "reviewer",
    description,
  };
}

function proof(id: string, passed = true, evidenceDigests: string[] = [DIGEST]): Record<string, unknown> {
  return {
    protocolVersion: 1,
    taskId: `canonical-${id}`,
    correlationId: `correlation-${id}`,
    verificationPassed: passed,
    verificationIssues: passed ? [] : ["focused check failed"],
    evidenceDigests,
    timestamp: new Date().toISOString(),
  };
}

async function emitProof(runtime: Runtime, id: string, description: string, options?: {
  passed?: boolean;
  evidenceDigests?: string[];
}): Promise<void> {
  await runtime.events.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, request(id, description));
  await runtime.events.emit(
    SUBAGENT_PROOF_EVENT,
    proof(id, options?.passed ?? true, options?.evidenceDigests ?? [DIGEST]),
  );
}

async function injected(runtime: Runtime, query: string): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const results = await runtime.dispatch("before_agent_start", { prompt: query });
    const match = results.find((result) => {
      if (!result || typeof result !== "object") return false;
      const message = (result as { message?: unknown }).message;
      return !!message && typeof message === "object" && (message as { customType?: unknown }).customType === "pi-learning-context";
    });
    if (match) return match as Record<string, unknown>;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return undefined;
}

function learningEvents(root: string): string {
  const path = join(root, ".pi", "artifacts", "learning", "v1", "events.jsonl");
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

async function positiveAndContext(consumer: Consumer, root: string): Promise<void> {
  const runtime = await createRuntime(consumer, root, true);
  const observations: unknown[] = [];
  runtime.events.on(LEARNING_OBSERVATION_EVENT, (payload) => {
    observations.push(payload);
  });
  const description = "Run the focused alpha verification before the complete alpha suite";
  await emitProof(runtime, "positive", description);
  const result = await injected(runtime, "focused alpha verification");
  assert.ok(
    result,
    `verified proof should produce next-turn learning context; observations=${JSON.stringify(observations)} ledger=${learningEvents(root)}`,
  );
  const rendered = JSON.stringify(result);
  assert.match(rendered, /focused alpha verification/i);
  assert.match(rendered, new RegExp(DIGEST));

  const contextRequest = request("context", "Use project learning for alpha verification");
  runtime.events.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, contextRequest);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const response = contextRequest.response as LearningContext | undefined;
  assert.equal(response?.version, 1, `context response=${JSON.stringify(response)}`);
  assert.equal(response?.facts.length, 1);
  assert.equal(response?.facts[0]?.confidence, "high");
  assert.equal(response?.facts[0]?.evidenceDigest, DIGEST);

  const eventsModule = await loadPackageModule(consumer.path, "@minhduydev/pi-subagents/dist/events.js");
  const validate = eventsModule.validateLearningContext as (value: unknown) => LearningContext | undefined;
  assert.equal(validate(response)?.facts.length, 1, "real subagent validator must accept injected facts");
}

async function rejectedInputs(consumer: Consumer, root: string): Promise<void> {
  const runtime = await createRuntime(consumer, root, true);
  await emitProof(runtime, "failed", "Failed-only omega guidance", { passed: false });
  await emitProof(runtime, "missing", "Missing-evidence omega guidance", { evidenceDigests: [] });
  await emitProof(runtime, "invalid", "Invalid-evidence omega guidance", { evidenceDigests: ["not-a-digest"] });
  const syntheticSecret = `ghp_${"A".repeat(36)}`;
  await emitProof(runtime, "secret", `Use token ${syntheticSecret} for omega`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await injected(runtime, "omega guidance"), undefined);
  const ledger = learningEvents(root);
  assert.doesNotMatch(ledger, /ghp_/i);
  assert.doesNotMatch(ledger, /Failed-only|Missing-evidence|Invalid-evidence/);
}

async function untrustedProject(consumer: Consumer, root: string): Promise<void> {
  const runtime = await createRuntime(consumer, root, false);
  await emitProof(runtime, "untrusted", "Untrusted sigma verification guidance");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await injected(runtime, "sigma verification"), undefined);
  assert.equal(learningEvents(root), "");
}

async function idempotencyBoundsAndFailOpen(consumer: Consumer, root: string): Promise<void> {
  const runtime = await createRuntime(consumer, root, true);
  const unsubscribe = runtime.events.on(LEARNING_OBSERVATION_EVENT, () => {
    throw new Error("synthetic listener failure");
  });
  await emitProof(runtime, "fail-open", "Phi verification remains available after listener failure");
  const failOpenResult = await injected(runtime, "phi verification");
  assert.ok(failOpenResult, `throwing listeners must not block durable learning; ledger=${learningEvents(root)}`);
  unsubscribe();

  const descriptions = [
    "Theta alpha rule: run the focused parser check",
    "Theta beta rule: inspect the durable event receipt",
    "Theta gamma rule: verify the package payload list",
    "Theta delta rule: check the trusted project boundary",
    "Theta epsilon rule: keep the context response bounded",
  ];
  for (let index = 0; index < descriptions.length; index += 1) {
    await emitProof(runtime, `bounds-${index}`, descriptions[index]!);
    assert.ok(await injected(runtime, descriptions[index]!), `learning ${index} should activate before the next event`);
  }

  await emitProof(runtime, "duplicate", "Theta duplicate guidance remains idempotent");
  assert.ok(await injected(runtime, "theta duplicate guidance"));
  await emitProof(runtime, "duplicate", "Theta duplicate guidance remains idempotent");
  await new Promise((resolve) => setTimeout(resolve, 50));

  const result = await injected(runtime, "theta");
  assert.ok(result);
  const contextRequest = request("bounds-context", "Use theta project guidance");
  runtime.events.emit(SUBAGENT_CONTEXT_REQUEST_EVENT, contextRequest);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const response = contextRequest.response as LearningContext | undefined;
  assert.ok(response);
  assert.ok(response.facts.length <= 3);
  assert.ok(JSON.stringify(response).length <= 1_600);

  const ledger = learningEvents(root).trim().split("\n").filter(Boolean);
  const duplicateEvents = ledger.filter((line) => line.includes("Theta duplicate guidance remains idempotent"));
  assert.equal(duplicateEvents.length, 2, "duplicate delivery must not create another observation/candidate lifecycle");
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "pi-harness-auto-safe-e2e-"));
  try {
    const consumer = await installConsumer(root);
    await positiveAndContext(consumer, join(root, "positive"));
    await rejectedInputs(consumer, join(root, "rejected"));
    await untrustedProject(consumer, join(root, "untrusted"));
    await idempotencyBoundsAndFailOpen(consumer, join(root, "bounds"));
    console.log("Auto-safe E2E: PASS (positive, context, rejection, trust, idempotency, bounds, fail-open)");
  } finally {
    if (process.env.KEEP_AUTO_SAFE_E2E === "1") console.log(`Auto-safe E2E workspace: ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }
}

await main();
