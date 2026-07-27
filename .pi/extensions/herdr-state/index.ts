/**
 * herdr-state — report Pi agent state to the Herdr supervisor pane.
 *
 * Herdr multiplexes agent panes and needs each pane to self-report so the Root
 * supervisor can tell "waiting on a human" apart from "still working". This
 * extension speaks Herdr's pane protocol: newline-delimited JSON-RPC requests
 * over the unix socket at HERDR_SOCKET_PATH.
 *
 * Methods used (per the canonical Herdr integrations — the opencode plugin at
 * /tmp/pi-review/herdr-agent-state-reference.js and Herdr's own pi integration
 * v6 in ~/.pi/agent/extensions/herdr-agent-state.ts):
 *   - "pane.report_agent_session" { agent_session_path | agent_session_id,
 *     session_start_source? }
 *   - "pane.report_agent" { state: "working" | "blocked" | "idle", message? }
 * Every request carries pane_id, source, agent, and a monotonic seq.
 *
 * Activation: ONLY when HERDR_ENV === "1" AND HERDR_SOCKET_PATH AND
 * HERDR_PANE_ID are all set (read at factory time). Otherwise the factory
 * returns without registering anything — zero overhead, zero logging.
 *
 * Discipline (Lesson 18): reports are fire-and-forget through a serialized
 * queue, each socket attempt capped at 500ms, always fail-silent (never throw,
 * never block or break the session), no orchestration logic. seq is assigned
 * at enqueue time so ordering survives late/failed sends.
 *
 * Event mapping (only events that actually exist in the Pi extension SDK —
 * see node_modules/@earendil-works/pi-coding-agent/docs/extensions.md):
 *   - session_start            -> report session ref (+ reason as
 *                                 session_start_source), then current state
 *   - agent_start              -> working (+ refresh session ref)
 *   - tool_execution_start     -> working (tool execute implies activity)
 *   - agent_settled + isIdle() -> idle. agent_end is deliberately NOT mapped
 *                                 to idle: Pi may still auto-retry,
 *                                 auto-compact, or run queued follow-ups after
 *                                 agent_end ("done" != "idle").
 *   - events bus "herdr:blocked" { active, label? } -> blocked while any
 *                                 blocker is active, back to working/idle when
 *                                 all clear. This is the bus convention
 *                                 established by Herdr's pi integration v6:
 *                                 extensions that open a blocking prompt
 *                                 (permission gate, ask-user dialog) emit it.
 *
 * Known gaps (NOT invented around):
 *   - The Pi SDK has no built-in "permission_asked" / "question_asked" event.
 *     Blocked-state fidelity therefore depends on prompting extensions
 *     emitting "herdr:blocked" on pi.events. Pi core prompts that bypass the
 *     bus cannot be observed from an extension.
 *   - Pi subagents are separate headless pi processes (not in-process child
 *     sessions like opencode). Filtering is done by only reporting from the
 *     interactive root process: session_start requires ctx.hasUI === true.
 *     Headless children (print/JSON mode) never report, so they cannot
 *     clobber the pane state. A blocked subagent surfaces only if the
 *     parent-side task tooling emits "herdr:blocked" on the root bus; the
 *     resulting report carries the ROOT session ref, matching the reference
 *     semantics of "blocked without the child session id".
 *   - Session ref follows Herdr's pi integration v6: agent_session_path
 *     (absolute session file) preferred, agent_session_id as fallback. The
 *     opencode reference only has ids; pi panes are addressed by session file.
 */

import net from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SOURCE = "pi-harness:herdr-state";
const AGENT = "pi";
const REQUEST_TIMEOUT_MS = 500;

type AgentState = "working" | "blocked" | "idle";

interface HerdrConfig {
  socketEndpoint: string;
  paneId: string;
}

/** Env is read when the factory runs so tests (and /reload) see current values. */
function readConfig(): HerdrConfig | undefined {
  if (process.env.HERDR_ENV !== "1") return undefined;
  const socketPath = process.env.HERDR_SOCKET_PATH;
  const paneId = process.env.HERDR_PANE_ID;
  if (!socketPath || !paneId) return undefined;
  const socketEndpoint =
    process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  return { socketEndpoint, paneId };
}

/** Monotonic across the whole process, even across extension reloads. */
let reportSeq = Date.now() * 1000;

function nextReportSeq(): number {
  reportSeq += 1;
  return reportSeq;
}

/**
 * One newline-delimited JSON-RPC request over the unix socket. Single attempt,
 * hard 500ms cap, resolves no matter what happens (fail-silent by design).
 */
function sendRequest(config: HerdrConfig, request: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    let socket: net.Socket;
    try {
      socket = net.createConnection(config.socketEndpoint);
    } catch {
      resolve();
      return;
    }

    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      resolve();
    };

    socket.on("connect", () => {
      try {
        socket.write(`${JSON.stringify(request)}\n`);
      } catch {
        finish();
      }
    });
    socket.on("data", finish);
    socket.on("error", finish);
    socket.on("end", finish);
    socket.on("close", finish);
    timer = setTimeout(finish, REQUEST_TIMEOUT_MS);
    timer.unref?.();
  });
}

interface BlockedBusPayload {
  active?: boolean;
  label?: string;
}

function parseBlockedPayload(data: unknown): BlockedBusPayload {
  if (!data || typeof data !== "object") return {};
  const record = data as Record<string, unknown>;
  return {
    active: typeof record.active === "boolean" ? record.active : undefined,
    label: typeof record.label === "string" ? record.label : undefined,
  };
}

export default function herdrState(pi: ExtensionAPI): void {
  const maybeConfig = readConfig();
  if (!maybeConfig) {
    // Not running under a Herdr pane: register nothing, log nothing.
    return;
  }
  const config: HerdrConfig = maybeConfig;

  let sessionPath: string | undefined;
  let sessionId: string | undefined;

  function updateSessionRef(ctx: ExtensionContext): void {
    try {
      const file = ctx.sessionManager.getSessionFile?.();
      sessionPath = typeof file === "string" && file.startsWith("/") ? file : undefined;
    } catch {
      sessionPath = undefined;
    }
    try {
      const id = ctx.sessionManager.getSessionId?.();
      sessionId = typeof id === "string" && id.length > 0 ? id : undefined;
    } catch {
      sessionId = undefined;
    }
  }

  function sessionRef(): Record<string, unknown> | undefined {
    if (sessionPath) return { agent_session_path: sessionPath };
    if (sessionId) return { agent_session_id: sessionId };
    return undefined;
  }

  // Serialized fire-and-forget queue: handlers never await socket I/O, and seq
  // is assigned at enqueue time so ordering survives slow or failed sends.
  const sendQueue: Array<Record<string, unknown>> = [];
  let draining = false;

  function enqueue(method: string, params: Record<string, unknown>): void {
    const seq = nextReportSeq();
    sendQueue.push({
      id: `${SOURCE}:${seq}`,
      method,
      params: {
        pane_id: config.paneId,
        source: SOURCE,
        agent: AGENT,
        seq,
        ...params,
      },
    });
    if (!draining) void drain();
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (sendQueue.length > 0) {
        const request = sendQueue.shift()!;
        await sendRequest(config, request);
      }
    } finally {
      draining = false;
    }
  }

  let rootSession = false;
  let agentActive = false;
  let blockedCount = 0;
  let blockedLabel: string | undefined;
  let lastState: AgentState | undefined;
  let lastMessage: string | undefined;

  function desiredState(): { state: AgentState; message?: string } {
    if (blockedCount > 0) return { state: "blocked", message: blockedLabel };
    if (agentActive) return { state: "working" };
    return { state: "idle" };
  }

  function publishState(force = false): void {
    const next = desiredState();
    if (!force && next.state === lastState && next.message === lastMessage) return;
    lastState = next.state;
    lastMessage = next.message;
    const params: Record<string, unknown> = { state: next.state, ...sessionRef() };
    if (next.message !== undefined) params.message = next.message;
    enqueue("pane.report_agent", params);
  }

  function reportSession(sessionStartSource?: string): void {
    const ref = sessionRef();
    if (!ref) return;
    const params: Record<string, unknown> = { ...ref };
    if (sessionStartSource) params.session_start_source = sessionStartSource;
    enqueue("pane.report_agent_session", params);
  }

  pi.on("session_start", async (event, ctx) => {
    // Root filter: only the interactive pane process reports. Headless
    // subagent pi processes (print/JSON mode) have hasUI === false.
    if (ctx.hasUI !== true) return;
    rootSession = true;
    updateSessionRef(ctx);
    reportSession(event.reason);
    // A /reload can swap this extension mid-run without another agent_start.
    agentActive = ctx.isIdle() === false;
    publishState(true);
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (!rootSession) return;
    updateSessionRef(ctx);
    reportSession();
    agentActive = true;
    publishState();
  });

  pi.on("tool_execution_start", async (_event, _ctx) => {
    if (!rootSession) return;
    agentActive = true;
    publishState();
  });

  pi.on("agent_settled", async (_event, ctx) => {
    // agent_end is NOT idle: Pi may auto-retry/compact/continue afterwards.
    if (!rootSession || ctx.isIdle() !== true) return;
    agentActive = false;
    publishState();
  });

  // Blocking prompts (permission gates, ask-user dialogs) surface through the
  // shared extension bus — the convention Herdr's own pi integration defines.
  pi.events.on("herdr:blocked", (data: unknown) => {
    if (!rootSession) return;
    const payload = parseBlockedPayload(data);
    if (payload.active === true) {
      blockedCount += 1;
      blockedLabel = payload.label;
    } else {
      blockedCount = Math.max(0, blockedCount - 1);
      if (blockedCount === 0) blockedLabel = undefined;
    }
    publishState();
  });
}
