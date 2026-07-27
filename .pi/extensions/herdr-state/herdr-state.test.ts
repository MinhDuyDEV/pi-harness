/**
 * Tests for the herdr-state extension.
 *
 * Run: node --import tsx --test .pi/extensions/herdr-state/herdr-state.test.ts
 * (or: node scripts/run-extension-tests.mjs .pi/extensions/herdr-state)
 *
 * Uses a fake Herdr socket server (newline-delimited JSON over a unix socket
 * in a tmpdir) and a fake ExtensionAPI that captures registered handlers so
 * SDK events can be replayed by hand.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import herdrState from "./index.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type AnyHandler = (event: unknown, ctx: unknown) => unknown;

interface FakePi {
  api: ExtensionAPI;
  registeredEvents: string[];
  busChannels: string[];
  emit(event: string, payload: unknown, ctx: unknown): Promise<void>;
  emitBus(channel: string, data: unknown): void;
}

function createFakePi(): FakePi {
  const handlers = new Map<string, AnyHandler[]>();
  const busHandlers = new Map<string, Array<(data: unknown) => void>>();
  const registeredEvents: string[] = [];
  const busChannels: string[] = [];

  const api = {
    on(event: string, handler: AnyHandler) {
      registeredEvents.push(event);
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    events: {
      on(channel: string, handler: (data: unknown) => void) {
        busChannels.push(channel);
        busHandlers.set(channel, [...(busHandlers.get(channel) ?? []), handler]);
        return () => {};
      },
      emit(channel: string, data: unknown) {
        for (const handler of busHandlers.get(channel) ?? []) handler(data);
      },
    },
  } as unknown as ExtensionAPI;

  return {
    api,
    registeredEvents,
    busChannels,
    async emit(event, payload, ctx) {
      for (const handler of handlers.get(event) ?? []) {
        await handler(payload, ctx);
      }
    },
    emitBus(channel, data) {
      (api as unknown as { events: { emit(c: string, d: unknown): void } }).events.emit(
        channel,
        data,
      );
    },
  };
}

interface FakeCtxOptions {
  hasUI?: boolean;
  idle?: boolean;
  sessionFile?: string | undefined;
  sessionId?: string;
  model?: { provider?: string; id: string };
  usage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

function fakeCtx(options: FakeCtxOptions = {}): unknown {
  return {
    hasUI: options.hasUI ?? true,
    isIdle: () => options.idle ?? true,
    sessionManager: {
      getSessionFile: () => options.sessionFile,
      getSessionId: () => options.sessionId ?? "ses_test",
    },
    model: options.model,
    getContextUsage: () => options.usage,
  };
}

interface FakeServer {
  received: Array<{
    jsonrpc: "2.0";
    id: string;
    method: string;
    params: Record<string, unknown>;
  }>;
  connections: number;
  close(): Promise<void>;
}

type FakeResponder =
  | boolean
  | ((request: FakeServer["received"][number]) => Array<Record<string, unknown>>);

/** Line-delimited JSON server. respond=false simulates a hung Herdr daemon. */
function startFakeServer(socketPath: string, respond: FakeResponder): Promise<FakeServer> {
  const received: FakeServer["received"] = [];
  const state = { connections: 0 };
  const server = net.createServer((connection) => {
    state.connections += 1;
    let buffer = "";
    connection.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) continue;
        const request = JSON.parse(line) as FakeServer["received"][number];
        received.push(request);
        const responses = respond === true
          ? [{ jsonrpc: "2.0", id: request.id, result: { ok: true } }]
          : typeof respond === "function" ? respond(request) : [];
        for (const response of responses) {
          connection.write(`${JSON.stringify(response)}\n`);
        }
      }
    });
    connection.on("error", () => {});
  });

  return new Promise((resolve) => {
    server.listen(socketPath, () => {
      resolve({
        received,
        get connections() {
          return state.connections;
        },
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), `condition not met within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Env plumbing
// ---------------------------------------------------------------------------

const ENV_KEYS = ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID", "PI_HARNESS_SEAT_ROLE"] as const;
let savedEnv: Record<string, string | undefined> = {};
let workDir: string;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  workDir = mkdtempSync(join(tmpdir(), "herdr-state-"));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(workDir, { recursive: true, force: true });
});

function enableHerdrEnv(socketPath: string, paneId = "pane-42"): void {
  process.env.HERDR_ENV = "1";
  process.env.HERDR_SOCKET_PATH = socketPath;
  process.env.HERDR_PANE_ID = paneId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("herdr-state activation gate", () => {
  it("registers nothing when HERDR env vars are absent", () => {
    const fake = createFakePi();
    herdrState(fake.api);
    assert.equal(fake.registeredEvents.length, 0, "no SDK events should be registered");
    assert.equal(fake.busChannels.length, 0, "no bus channels should be registered");
  });

  it("registers nothing when HERDR_ENV is not '1'", () => {
    process.env.HERDR_ENV = "0";
    process.env.HERDR_SOCKET_PATH = join(workDir, "herdr.sock");
    process.env.HERDR_PANE_ID = "pane-42";
    const fake = createFakePi();
    herdrState(fake.api);
    assert.equal(fake.registeredEvents.length, 0);
    assert.equal(fake.busChannels.length, 0);
  });

  it("registers nothing when socket path or pane id is missing", () => {
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "pane-42";
    const fake = createFakePi();
    herdrState(fake.api);
    assert.equal(fake.registeredEvents.length, 0);
  });

  it("registers exactly the known SDK events and bus channel when enabled", () => {
    enableHerdrEnv(join(workDir, "herdr.sock"));
    const fake = createFakePi();
    herdrState(fake.api);
    assert.deepEqual(
      [...fake.registeredEvents].sort(),
      [
        "agent_settled",
        "agent_start",
        "session_before_compact",
        "session_shutdown",
        "session_start",
        "tool_execution_start",
      ].sort(),
    );
    assert.deepEqual(fake.busChannels, ["herdr:blocked"]);
  });
});

describe("herdr-state reporting", () => {
  it("reports session then state transitions with correct method/params and monotonic seq", async () => {
    const socketPath = join(workDir, "herdr.sock");
    const server = await startFakeServer(socketPath, true);
    enableHerdrEnv(socketPath, "pane-7");

    const fake = createFakePi();
    herdrState(fake.api);

    const sessionFile = join(workDir, "session.jsonl");
    const busyCtx = fakeCtx({
      idle: false,
      sessionFile,
      model: { provider: "openai", id: "gpt-test" },
      usage: { tokens: 1234, contextWindow: 8000, percent: 15.425 },
    });
    const idleCtx = fakeCtx({ idle: true, sessionFile });

    // Interactive root session starts mid-run (isIdle false -> working).
    await fake.emit("session_start", { reason: "startup" }, busyCtx);
    await waitFor(() => server.received.length >= 2);

    const [sessionReport, initialState] = server.received;
    assert.equal(sessionReport.jsonrpc, "2.0");
    assert.equal(sessionReport.method, "pane.report_agent_session");
    assert.equal(sessionReport.params.pane_id, "pane-7");
    assert.equal(sessionReport.params.source, "pi-harness:herdr-state");
    assert.equal(sessionReport.params.agent, "pi");
    assert.equal(sessionReport.params.session_start_source, "startup");
    assert.equal(sessionReport.params.agent_session_path, sessionFile);
    assert.equal(sessionReport.params.agent_session_id, undefined);
    assert.equal(sessionReport.params.role, "interactive-root");
    assert.equal(sessionReport.params.model, "openai/gpt-test");
    assert.equal(sessionReport.params.context_tokens, 1234);
    assert.equal(sessionReport.params.context_window, 8000);

    assert.equal(initialState.method, "pane.report_agent");
    assert.equal(initialState.params.state, "working");
    assert.equal(initialState.params.agent_session_path, sessionFile);

    // Agent settles -> idle.
    await fake.emit("agent_settled", {}, idleCtx);
    await waitFor(() => server.received.length >= 3);
    assert.equal(server.received[2].method, "pane.report_agent");
    assert.equal(server.received[2].params.state, "idle");

    // Tool execution while idle -> working (tool execute maps to working).
    await fake.emit("tool_execution_start", { toolName: "bash" }, busyCtx);
    await waitFor(() => server.received.length >= 4);
    assert.equal(server.received[3].method, "pane.report_agent");
    assert.equal(server.received[3].params.state, "working");

    await fake.emit("session_before_compact", {}, busyCtx);
    await waitFor(() => server.received.length >= 5);
    assert.equal(server.received[4].method, "pane.report_agent_session");
    assert.equal(server.received[4].params.session_start_source, "before-compact");

    // Duplicate working signal is deduplicated (no extra report).
    await fake.emit("tool_execution_start", { toolName: "read" }, busyCtx);
    await sleep(150);
    assert.equal(server.received.length, 5, "duplicate state must not re-report");

    // Blocking prompt (permission gate / ask-user) -> blocked with label.
    fake.emitBus("herdr:blocked", { active: true, label: "Permission required" });
    await waitFor(() => server.received.length >= 6);
    assert.equal(server.received[5].method, "pane.report_agent");
    assert.equal(server.received[5].params.state, "blocked");
    assert.equal(server.received[5].params.message, "Permission required");

    // Prompt answered -> back to working (agent still active).
    fake.emitBus("herdr:blocked", { active: false });
    await waitFor(() => server.received.length >= 7);
    assert.equal(server.received[6].method, "pane.report_agent");
    assert.equal(server.received[6].params.state, "working");

    // seq strictly increasing across every request, in order.
    const seqs = server.received.map((request) => request.params.seq as number);
    for (let index = 1; index < seqs.length; index += 1) {
      assert.ok(seqs[index] > seqs[index - 1], `seq must be monotonic: ${seqs.join(", ")}`);
    }

    await server.close();
  });

  it("agent_start refreshes the session ref and reports working", async () => {
    const socketPath = join(workDir, "herdr.sock");
    const server = await startFakeServer(socketPath, true);
    enableHerdrEnv(socketPath);

    const fake = createFakePi();
    herdrState(fake.api);

    const firstFile = join(workDir, "one.jsonl");
    const secondFile = join(workDir, "two.jsonl");

    await fake.emit("session_start", { reason: "new" }, fakeCtx({ idle: true, sessionFile: firstFile }));
    await waitFor(() => server.received.length >= 2); // session + idle

    await fake.emit("agent_start", {}, fakeCtx({ idle: false, sessionFile: secondFile }));
    await waitFor(() => server.received.length >= 4);

    const sessionUpdate = server.received[2];
    assert.equal(sessionUpdate.method, "pane.report_agent_session");
    assert.equal(sessionUpdate.params.agent_session_path, secondFile);
    assert.equal(sessionUpdate.params.session_start_source, undefined);

    const working = server.received[3];
    assert.equal(working.method, "pane.report_agent");
    assert.equal(working.params.state, "working");
    assert.equal(working.params.agent_session_path, secondFile);

    await server.close();
  });

  it("falls back to agent_session_id when no session file exists", async () => {
    const socketPath = join(workDir, "herdr.sock");
    const server = await startFakeServer(socketPath, true);
    enableHerdrEnv(socketPath);

    const fake = createFakePi();
    herdrState(fake.api);

    await fake.emit(
      "session_start",
      { reason: "startup" },
      fakeCtx({ idle: true, sessionFile: undefined, sessionId: "ses_ephemeral" }),
    );
    await waitFor(() => server.received.length >= 2);

    assert.equal(server.received[0].method, "pane.report_agent_session");
    assert.equal(server.received[0].params.agent_session_id, "ses_ephemeral");
    assert.equal(server.received[0].params.agent_session_path, undefined);

    await server.close();
  });

  it("never reports from headless (subagent) processes: hasUI false", async () => {
    const socketPath = join(workDir, "herdr.sock");
    const server = await startFakeServer(socketPath, true);
    enableHerdrEnv(socketPath);

    const fake = createFakePi();
    herdrState(fake.api);

    const headless = fakeCtx({ hasUI: false, idle: false, sessionFile: join(workDir, "s.jsonl") });
    await fake.emit("session_start", { reason: "startup" }, headless);
    await fake.emit("agent_start", {}, headless);
    await fake.emit("tool_execution_start", { toolName: "bash" }, headless);
    await fake.emit("agent_settled", {}, fakeCtx({ hasUI: false, idle: true }));
    fake.emitBus("herdr:blocked", { active: true, label: "nope" });

    await sleep(250);
    assert.equal(server.received.length, 0, "headless process must not report");
    assert.equal(server.connections, 0, "headless process must not even connect");

    await server.close();
  });

  it("reports an explicit interactive co-worker seat with its real role", async () => {
    const socketPath = join(workDir, "herdr.sock");
    const server = await startFakeServer(socketPath, true);
    enableHerdrEnv(socketPath);
    process.env.PI_HARNESS_SEAT_ROLE = "peer";
    const fake = createFakePi();
    herdrState(fake.api);

    await fake.emit("session_start", { reason: "startup" }, fakeCtx({
      hasUI: true,
      idle: true,
      sessionFile: join(workDir, "peer.jsonl"),
    }));
    await waitFor(() => server.received.length >= 2);
    assert.equal(server.received[0].params.role, "herdr-peer");
    await server.close();
  });

  it("deduplicates blockers by id and releases the seat only on process quit", async () => {
    const socketPath = join(workDir, "herdr.sock");
    const server = await startFakeServer(socketPath, true);
    enableHerdrEnv(socketPath);
    const fake = createFakePi();
    herdrState(fake.api);
    const ctx = fakeCtx({ idle: true, sessionFile: join(workDir, "root.jsonl") });
    await fake.emit("session_start", { reason: "startup" }, ctx);
    await waitFor(() => server.received.length >= 2);

    fake.emitBus("herdr:blocked", {});
    fake.emitBus("herdr:blocked", { active: "yes", blockerId: "bad" });
    fake.emitBus("herdr:blocked", { active: true, blockerId: "", label: "bad" });
    await sleep(100);
    assert.equal(server.received.length, 2, "malformed blocker events must be ignored");

    fake.emitBus("herdr:blocked", { active: true, blockerId: "decision-1", label: "Choose an option" });
    fake.emitBus("herdr:blocked", { active: true, blockerId: "decision-1", label: "Choose an option" });
    await waitFor(() => server.received.length >= 3);
    assert.equal(server.received[2].params.state, "blocked");
    fake.emitBus("herdr:blocked", { active: false, blockerId: "decision-1" });
    await waitFor(() => server.received.length >= 4);
    assert.equal(server.received[3].params.state, "idle");

    await fake.emit("session_shutdown", { reason: "resume" }, ctx);
    await sleep(100);
    assert.equal(server.received.some((request) => request.method === "pane.release_agent"), false);
    await fake.emit("session_shutdown", { reason: "quit" }, ctx);
    await waitFor(() => server.received.some((request) => request.method === "pane.release_agent"));
    await server.close();
  });
});

describe("herdr-state failure discipline", () => {
  it("fails silently when the socket does not exist", async () => {
    enableHerdrEnv(join(workDir, "missing.sock"));

    const fake = createFakePi();
    herdrState(fake.api);

    // Must not throw, must not hang.
    await fake.emit(
      "session_start",
      { reason: "startup" },
      fakeCtx({ idle: false, sessionFile: join(workDir, "s.jsonl") }),
    );
    fake.emitBus("herdr:blocked", { active: true });
    await fake.emit("agent_settled", {}, fakeCtx({ idle: true }));
    await sleep(150);
    assert.ok(true, "no crash on missing socket");
  });

  it("times out unresponsive server within ~500ms and keeps draining the queue", async () => {
    const socketPath = join(workDir, "herdr.sock");
    const server = await startFakeServer(socketPath, false); // never replies
    enableHerdrEnv(socketPath);

    const fake = createFakePi();
    herdrState(fake.api);

    const startedAt = Date.now();
    // session_start enqueues two requests (session + state); the second can
    // only be written after the first send times out at 500ms.
    await fake.emit(
      "session_start",
      { reason: "startup" },
      fakeCtx({ idle: false, sessionFile: join(workDir, "s.jsonl") }),
    );

    await waitFor(() => server.received.length >= 2, 2500);
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 400, `second send should wait for the 500ms timeout (took ${elapsed}ms)`);
    assert.ok(elapsed < 2000, `queue must not hang far beyond the timeout (took ${elapsed}ms)`);
    assert.equal(server.received[0].method, "pane.report_agent_session");
    assert.equal(server.received[1].method, "pane.report_agent");

    await server.close();
  });

  it("ignores malformed and wrong-id replies until a correlated JSON-RPC ACK arrives", async () => {
    const socketPath = join(workDir, "herdr.sock");
    const server = await startFakeServer(socketPath, (request) => [
      { ok: true },
      { jsonrpc: "2.0", id: `${request.id}-wrong`, result: { ok: true } },
      { jsonrpc: "2.0", id: request.id, result: { ok: true } },
    ]);
    enableHerdrEnv(socketPath);
    const fake = createFakePi();
    herdrState(fake.api);

    await fake.emit(
      "session_start",
      { reason: "startup" },
      fakeCtx({ idle: true, sessionFile: join(workDir, "s.jsonl") }),
    );
    await waitFor(() => server.received.length >= 2);
    assert.equal(server.received[0].jsonrpc, "2.0");
    assert.equal(server.received[1].jsonrpc, "2.0");
    await server.close();
  });
});
