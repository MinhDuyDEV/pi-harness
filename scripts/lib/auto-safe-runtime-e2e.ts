import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type LifecycleHandler = (event: unknown, context: RuntimeContext) => unknown | Promise<unknown>;

interface RuntimeContext {
  cwd: string;
  hasUI: boolean;
  isProjectTrusted(): boolean;
  ui: {
    confirm: () => Promise<boolean>;
    input: () => Promise<string | undefined>;
    notify: () => void;
  };
}

export interface PackedRuntime {
  root: string;
  events: ReturnType<typeof createEventBus>;
  dispatch(name: string, event?: unknown): Promise<unknown[]>;
  taskTool?: { execute: (...args: unknown[]) => Promise<unknown> };
  upstreamPrompts: string[];
}

export async function loadPackageModule(
  consumerPath: string,
  relativePath: string,
): Promise<Record<string, unknown>> {
  const modulePath = join(consumerPath, "node_modules", relativePath);
  return await import(pathToFileURL(modulePath).href) as Record<string, unknown>;
}

export async function createPackedRuntime(input: {
  consumerPath: string;
  root: string;
  trusted: boolean;
  settings: unknown;
  installCoordinator: (api: unknown) => void;
}): Promise<PackedRuntime> {
  mkdirSync(join(input.root, ".pi"), { recursive: true });
  writeFileSync(join(input.root, ".pi", "settings.json"), JSON.stringify(input.settings));
  const events = createEventBus();
  const handlers = new Map<string, LifecycleHandler[]>();
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
  const upstreamPrompts: string[] = [];
  const pi = {
    events,
    on(name: string, handler: LifecycleHandler): void {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(): void {},
    registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }): void {
      tools.set(tool.name, tool);
    },
    sendMessage(): void {},
  };
  input.installCoordinator(pi);
  const learningModule = await loadPackageModule(
    input.consumerPath,
    "@minhduydev/pi-learning/dist/index.js",
  );
  (learningModule.default as (api: unknown) => void)(pi);
  await installPackedTaskRuntime(input.consumerPath, pi, upstreamPrompts);
  const context: RuntimeContext = {
    cwd: input.root,
    hasUI: false,
    isProjectTrusted: () => input.trusted,
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
  return { root: input.root, events, dispatch, taskTool: tools.get("task"), upstreamPrompts };
}

async function installPackedTaskRuntime(
  consumerPath: string,
  pi: unknown,
  upstreamPrompts: string[],
): Promise<void> {
  const taskRuntimeModule = await loadPackageModule(
    consumerPath,
    "@minhduydev/pi-subagents/dist/orchestration/runtime.js",
  ) as { createTaskRuntime: (upstream: (api: unknown) => void) => (api: unknown) => void };
  taskRuntimeModule.createTaskRuntime((api: unknown) => {
    (api as { registerTool: (tool: unknown) => void }).registerTool({
      name: "task",
      label: "Task",
      description: "Packed upstream task",
      parameters: Type.Object({
        agent_type: Type.String(),
        prompt: Type.String(),
        description: Type.String(),
        background: Type.Optional(Type.Boolean()),
      }),
      async execute(_id: string, params: { prompt: string }) {
        upstreamPrompts.push(params.prompt);
        return {
          content: [{ type: "text", text: "Started packed task." }],
          details: {
            taskId: "packed-runtime-task",
            phase: "running",
            reported_status: "unknown",
            session: "/synthetic/packed-runtime-task.jsonl",
          },
        };
      },
    });
  })(pi);
}

export async function exercisePackedTaskReuse(input: {
  runtime: PackedRuntime;
  consumerPath: string;
  description: string;
  learningIntents: unknown[];
}): Promise<void> {
  assert.ok(input.runtime.taskTool, "packed pi-subagents must register the wrapped task tool");
  await input.runtime.taskTool.execute(
    "packed-runtime-reuse",
    {
      agent_type: "general",
      prompt: "Apply the matching project learning",
      description: "focused alpha verification",
      background: true,
      orchestration: {
        context: {
          goal: "Apply matching project learning",
          authorization: "read-only",
          learning_claims: input.learningIntents,
          next_step: "Report the verified result",
        },
      },
    },
    new AbortController().signal,
    undefined,
    { cwd: input.runtime.root, ui: { notify() {} } },
  );
  assert.ok(
    input.runtime.upstreamPrompts.some((prompt) => prompt.includes(input.description)),
    "the real packed task runtime must inject matching learning into its Context Pack",
  );
  const pathsModule = await loadPackageModule(
    input.consumerPath,
    "@minhduydev/pi-subagents/dist/orchestration/paths.js",
  ) as { getOrchestrationPaths: (project: string) => { runStore: string } };
  const runsModule = await loadPackageModule(
    input.consumerPath,
    "@minhduydev/pi-subagents/dist/orchestration/run-store.js",
  ) as {
    listDurableRuns: (store: string) => Promise<Array<{
      learningBinding?: unknown;
      usageBindings?: unknown[];
    }>>;
  };
  const durableRuns = await runsModule.listDurableRuns(
    pathsModule.getOrchestrationPaths(input.runtime.root).runStore,
  );
  assert.ok(
    durableRuns.some((run) => run.learningBinding && (run.usageBindings?.length ?? 0) > 0),
    "packed runtime must persist the learning binding and usage receipt",
  );
}

export async function injectedContext(
  runtime: PackedRuntime,
  prompt: string,
): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const results = await runtime.dispatch("before_agent_start", { prompt });
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const message = (result as { message?: unknown }).message;
      if (
        message && typeof message === "object" &&
        (message as { customType?: unknown }).customType === "pi-learning-context"
      ) return message as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return undefined;
}

export async function recordPackedUsageAndOutcome(
  runtime: PackedRuntime,
  root: string,
): Promise<void> {
  const activeLearning = learningRecords(root).find((event) => event.type === "activated");
  assert.ok(activeLearning?.recordId, "the active learning id must survive restart replay");
  runtime.events.emit("pi-learning:usage:v1", {
    learningId: activeLearning.recordId,
    sessionId: "packed-runtime-session",
    timestamp: Date.now(),
    taskId: "packed-runtime-task",
    matchedQuery: "focused alpha verification",
  });
  runtime.events.emit("pi-learning:outcome:v1", {
    learningId: activeLearning.recordId,
    outcome: "positive",
    sessionId: "packed-runtime-session",
    timestamp: Date.now(),
    detail: "packed production reuse completed",
  });
  await waitFor(() => {
    const types = learningRecords(root).map((event) => event.type);
    return types.includes("usage_recorded") && types.includes("outcome_recorded");
  }, "usage and outcome persistence");
}

function learningRecords(root: string): Array<Record<string, unknown>> {
  const path = join(root, ".pi", "artifacts", "learning", "v1", "events.jsonl");
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}
