/**
 * Task Tool — Delegate complex work to specialist agents.
 *
 * Spawns pi CLI in a tmux split pane (so you can watch it live) and
 * detects completion via RESULT.md polling. On completion, tool call
 * count and duration are reported as a notification.
 *
 * Three agent sources:
 *   - .pi/agents/*.md        project-local agents
 *   - ~/.pi/agent/agents/*.md user-global agents (fallback)
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

// ─── Constants ───────────────────────────────────────────────────────────────

const BACKGROUND_CHECK_MS = 10_000; // 10 sec

// All built-in tool names
const ALL_TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls"];

const OUTPUT_FORMAT_GUIDE = `<status>success|failure|blocked|partial</status>
<summary>One sentence: what was accomplished</summary>
<findings>Key findings with file:line references</findings>
<evidence>Verification evidence, commands run, output snippets</evidence>
<confidence>high|medium|low (optional — how certain the findings are)</confidence>
<files>Comma-separated absolute paths of files read/created (optional)</files>`;

// Cached regex patterns for XML result parsing
const STATUS_RE = /<status>([\s\S]*?)<\/status>/i;
const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i;
const FINDINGS_RE = /<findings>([\s\S]*?)<\/findings>/i;
const EVIDENCE_RE = /<evidence>([\s\S]*?)<\/evidence>/i;
const CONFIDENCE_RE = /<confidence>([\s\S]*?)<\/confidence>/i;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  thinking?: string;
  disallowedTools?: string[];
  body: string;
  source: "project" | "user";
}

interface ParsedResult {
  status: string;
  summary: string;
  findings: string;
  evidence: string;
  confidence: string;
  raw: string;
}

interface BackgroundTask {
  dir: string;
  agentType: string;
  sessionName: string;
  paneId: string;
  originalPane: string | null;
  description: string;
  startedAt: number;
  toolUses: number;
  turns: number;
}

/** Details attached to tool result for rendering. */
interface TaskDetails {
  task_id: string;
  agent_type: string;
  description: string;
  phase: "done" | "timeout" | "aborted" | "failed";
  // Completed phase
  status?: string;
  summary?: string;
  findings?: string;
  evidence?: string;
  confidence?: string;
  duration_ms?: number;
  turn_count?: number;
  tool_uses?: number;
  // Background
  background?: boolean;
  tmux_session?: string;
}

// ─── Agent Discovery ─────────────────────────────────────────────────────────

function findPiDir(cwd: string): string | null {
  let current = resolve(cwd);
  while (true) {
    // If current IS a .pi directory (e.g. cwd is inside a .pi folder),
    // go up one level first to avoid matching a nested .pi/.pi/ dir.
    if (basename(current) === ".pi") {
      const parent = dirname(current);
      if (parent === current) return current; // root — no parent
      current = parent;
      continue;
    }
    if (existsSync(join(current, ".pi"))) return join(current, ".pi");
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function getGlobalAgentDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".pi", "agent", "agents");
}

function loadAgentsFromDir(dir: string, source: "project" | "user"): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!existsSync(dir)) return agents;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = join(dir, entry.name);
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.description) continue;

    const name = basename(entry.name, ".md");
    const disallowedRaw = frontmatter.disallowed_tools;
    const disallowedTools = disallowedRaw
      ? disallowedRaw
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean)
      : undefined;

    agents.push({
      name,
      description: frontmatter.description,
      model: frontmatter.model,
      thinking: frontmatter.thinking,
      disallowedTools,
      body,
      source,
    });
  }
  return agents;
}

function discoverAgents(cwd: string): { agents: AgentConfig[]; piDir: string } {
  const piDir = findPiDir(cwd) || join(cwd, ".pi");
  const projectDir = join(piDir, "agents");
  const userDir = getGlobalAgentDir();

  const projectAgents = loadAgentsFromDir(projectDir, "project");
  const userAgents = loadAgentsFromDir(userDir, "user");

  // Project agents override user agents with the same name
  const agentMap = new Map<string, AgentConfig>();
  for (const a of userAgents) agentMap.set(a.name, a);
  for (const a of projectAgents) agentMap.set(a.name, a);

  return { agents: Array.from(agentMap.values()), piDir };
}

function formatAgentList(agents: AgentConfig[]): string {
  if (agents.length === 0) return "none available";
  return agents.map((a) => `${a.name} (${a.source}): ${a.description}`).join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseResultXml(raw: string): ParsedResult {
  const status = extractTag(raw, STATUS_RE);

  if (!status && !extractTag(raw, SUMMARY_RE) && !extractTag(raw, FINDINGS_RE) && !extractTag(raw, EVIDENCE_RE)) {
    return {
      status: "unknown",
      summary: raw.slice(0, 500),
      findings: "",
      evidence: "",
      confidence: "",
      raw,
    };
  }

  const confidence = extractTag(raw, CONFIDENCE_RE);

  return {
    status: status || "unknown",
    summary: extractTag(raw, SUMMARY_RE) || "",
    findings: extractTag(raw, FINDINGS_RE) || "",
    evidence: extractTag(raw, EVIDENCE_RE) || "",
    confidence: confidence || "",
    raw,
  };
}

function extractTag(raw: string, re: RegExp): string {
  const m = raw.match(re);
  return m ? m[1].trim() : "";
}

function formatMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(0)}m ${Math.floor((ms % 60_000) / 1_000)}s`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function parseIdTimestamp(id: string): number {
  try {
    const ts36 = id.split("-")[0];
    if (ts36) return parseInt(ts36, 36);
  } catch {
    /* fall through */
  }
  return Date.now();
}

// ─── JSONL Session Helpers ───────────────────────────────────────────────────

/** Count tool uses and turns from pi JSONL session files. */
function countToolUses(sessionDir: string): { toolUses: number; turns: number } {
  let toolUses = 0;
  let turns = 0;

  try {
    if (!existsSync(sessionDir)) return { toolUses, turns };

    const files = readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const content = readFileSync(join(sessionDir, file), "utf-8");
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;

        try {
          const entry = JSON.parse(line);
          if (
            entry.type === "message" &&
            entry.message?.role === "assistant" &&
            Array.isArray(entry.message.content)
          ) {
            turns++;
            for (const block of entry.message.content) {
              if (block.type === "toolCall") toolUses++;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Session dir might not exist or be inaccessible
  }

  return { toolUses, turns };
}

// ─── Tmux Helpers ────────────────────────────────────────────────────────────

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function tmuxCmd(args: string[]): string {
  return execFileSync("tmux", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function hasTmux(): boolean {
  try {
    execSync("tmux -V", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function paneExists(paneId: string): boolean {
  try {
    return tmuxCmd(["list-panes", "-a", "-F", "#{pane_id}"]).split("\n").includes(paneId);
  } catch {
    return false;
  }
}

function getCurrentPaneId(): string | null {
  try {
    return tmuxCmd(["display-message", "-p", "#{pane_id}"]);
  } catch {
    return null;
  }
}

function splitWindowPane(
  cwd: string,
  command: string,
): { paneId: string; originalPane: string | null } {
  const originalPane = getCurrentPaneId();
  const paneId = tmuxCmd([
    "split-window",
    "-h",
    "-P",
    "-F",
    "#{pane_id}",
    "-c",
    cwd,
  ]);
  // Send the command to the new pane (keys, not inline, to handle quoting cleanly)
  execSync(
    `tmux send-keys -t "${paneId}" "${command.replace(/"/g, '\\"')}" Enter`,
    { stdio: "ignore" },
  );
  return { paneId, originalPane };
}

function killAgentPane(paneId: string, originalPane: string | null): void {
  try {
    if (paneExists(paneId)) tmuxCmd(["kill-pane", "-t", paneId]);
  } catch {
    /* ignore */
  }
  try {
    if (originalPane && paneExists(originalPane)) tmuxCmd(["select-pane", "-t", originalPane]);
  } catch {
    /* ignore */
  }
}

// ─── Extension Entry Point ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Prevent recursive loading
  if (process.env.PI_TASK_TOOL_DISABLED === "1") {
    return;
  }

  // ── Background task tracker ────────────────────────────────────────────
  const backgroundTasks = new Map<string, BackgroundTask>();
  // Track the first ExtensionContext for widget updates
  let widgetCtx: ExtensionContext | null = null;

  /** Realtime widget component — updates elapsed time smoothly via 1s timer. */
  let widgetTimer: ReturnType<typeof setInterval> | null = null;
  function stopWidget() {
    if (widgetTimer) {
      clearInterval(widgetTimer);
      widgetTimer = null;
    }
  }
  /** Poll JSONL sessions every 3s to get live toolcall counts for running tasks. */
  const COUNT_POLL_MS = 3_000;
  const countInterval = setInterval(() => {
    for (const task of Array.from(backgroundTasks.values())) {
      const { toolUses, turns } = countToolUses(join(task.dir, "sessions"));
      task.toolUses = toolUses;
      task.turns = turns;
    }
  }, COUNT_POLL_MS);

  function renderWidget(width: number): string[] {
    const active = Array.from(backgroundTasks.entries());
    if (active.length === 0) return [];
    const now = Date.now();
    const lines: string[] = [];
    for (const [, task] of active) {
      const agentName = task.agentType.charAt(0).toUpperCase() + task.agentType.slice(1);
      const elapsed = formatMs(now - task.startedAt);
      const tc = task.toolUses > 0 ? `  ${task.turns || task.toolUses} toolcalls • ${elapsed}` : `  ${elapsed}`;
      lines.push(truncateToWidth(`${agentName}${task.description ? ` - ${task.description}` : ""}${tc}`, 120));
    }
    lines.push("");
    return lines;
  }

  const checkInterval = setInterval(async () => {
    // If no active tasks, clean up widget and skip processing
    if (backgroundTasks.size === 0) {
      if (widgetCtx) {
        stopWidget();
        widgetCtx.ui.setWidget("task", undefined);
        widgetCtx = null;
      }
      return;
    }

    // Snapshot at start — iterate over IDs, not entries, so we can delete safely
    const ids = Array.from(backgroundTasks.keys());
    for (const id of ids) {
      // Read + remove atomically: delete from map first, then process.
      // This prevents concurrent interval ticks from both processing the same task.
      const task = backgroundTasks.get(id);
      if (!task) continue; // Already claimed by a concurrent tick
      backgroundTasks.delete(id);

      const resultPath = join(task.dir, "RESULT.md");
      let content: string;
      try {
        content = await readFile(resultPath, "utf-8");
      } catch {
        // Not ready yet — put it back for next poll
        backgroundTasks.set(id, task);
        continue;
      }
      if (content.trim().length === 0) {
        backgroundTasks.set(id, task);
        continue;
      }

      // Kill the agent's tmux pane
      killAgentPane(task.paneId, task.originalPane);

      // Use in-memory toolcall counts (updated by 3s countInterval)
      const { toolUses, turns } = task;

      const parsed = parseResultXml(content);
      const durationMs = Date.now() - parseIdTimestamp(id);

      const durStr = durationMs >= 1000 ? formatMs(durationMs) : "";
      const useStr = toolUses > 0 ? `${turns || toolUses} toolcalls` : "";
      const statsStr = [useStr, durStr].filter(Boolean).join(" • ");

      // Notify once
      pi.sendMessage({
        customType: "task-complete",
        content: [
          `${task.agentType} - ${task.description}`,
          statsStr ? `${statsStr}` : "",
          "",
          parsed.summary || content.slice(0, 300),
        ]
          .filter(Boolean)
          .join("\n"),
        display: true,
        details: {
          task_id: id,
          agent_type: task.agentType,
          description: task.description,
          tmux_session: task.sessionName,
          status: parsed.status,
          summary: parsed.summary,
          findings: parsed.findings,
          evidence: parsed.evidence,
          confidence: parsed.confidence,
          result: content,
          duration_ms: durationMs,
          tool_uses: toolUses,
          turn_count: turns,
        },
      });
    }
  }, BACKGROUND_CHECK_MS);

  pi.on("session_shutdown", () => {
    clearInterval(checkInterval);
    clearInterval(countInterval);
    stopWidget();
    if (widgetCtx) {
      widgetCtx.ui.setWidget("task", undefined);
      widgetCtx = null;
    }
  });

  // ── Custom notification renderer for task completion ───────────────────
  pi.registerMessageRenderer?.("task-complete", (message, { expanded }, theme) => {
    const d = message.details as Record<string, unknown> | undefined;
    if (!d) return undefined;

    const agentType = (d.agent_type as string) || "";
    const desc = (d.description as string) || "";
    const status = (d.status as string) || "";
    const summary = (d.summary as string) || "";
    const findings = (d.findings as string) || "";
    const confidence = (d.confidence as string) || "";
    const durationMs = (d.duration_ms as number) || 0;
    const toolUses = (d.tool_uses as number) || 0;
    const turns = (d.turn_count as number) || 0;

    const isError = status === "failure" || status === "blocked" || status === "unknown";

    // ── Title line: "Agent - description"
    let line = theme.fg("accent", agentType);
    if (desc) line += theme.fg("dim", ` - ${desc}`);

    // ── Stats line: raw text "N toolcalls • duration"
    const useStr = toolUses > 0 ? `${turns || toolUses} toolcalls` : "";
    const durStr = durationMs >= 1000 ? formatMs(durationMs) : "";
    const statsParts = [useStr, durStr].filter(Boolean);
    if (statsParts.length) {
      line += "\n" + theme.fg("dim", `${statsParts.join(" • ")}`);
    }

    // ── Confidence line: shown when present
    const confStr = confidence ? `${confidence.toUpperCase()}` : "";
    if (confStr && (statsParts.length || expanded)) {
      const confColor = confidence === "high" ? "success" : confidence === "low" ? "error" : "accent";
      line += "\n" + theme.fg(confColor as any, `[${confStr}]`);
    }

    if (expanded) {
      if (summary) line += "\n" + theme.fg("muted", summary);
      if (findings) line += "\n" + theme.fg("dim", findings);
    }

    // Fall back to content text if we couldn't format anything
    if (!line.trim()) return undefined;

    return new Text(line, 0, 0);
  });

  // ── Task Tool Registration ─────────────────────────────────────────────
  pi.registerTool({
    name: "task",
    label: "Task",
    description: [
      "Delegate a complex, well-defined task to a specialist agent.",
      "Spawns pi CLI in a tmux split pane so you can watch it live.",
      "All tasks execute in background — you're notified on completion.",
      "",
      "When NOT to use:",
      "- Single file read → use read tool",
      "- Simple grep search → use grep tool",
      "- Small edit → do it yourself",
      "- No available agent fits → use other tools directly",
      "",
      "Guidelines:",
      "1. Provide complete context in the prompt — the subagent starts fresh",
      "2. Do NOT duplicate work while the task runs in background",
      "3. Launch multiple tasks concurrently in parallel",
      "4. Use the agent_type to route to the right specialist",
      "5. Specify whether the agent should write code or just research",
    ].join("\n"),
    promptSnippet: "Delegate work to a specialist agent via the task tool",
    promptGuidelines: [
      "Use task to delegate complex multi-step work to a specialist agent when the work benefits from isolated context",
      "Launch multiple tasks concurrently by making multiple tool calls in a single message",
      "Do NOT duplicate work you've delegated — wait for the result",
      "Use the agent_type parameter to route work to the right specialist (explore, scout, reviewer, planner, worker, vision)",
    ],
    parameters: Type.Object({
      agent_type: Type.String({
        description: "Which specialist agent to use for this task",
      }),
      prompt: Type.String({
        description: "The complete task for the agent to perform. Be detailed and self-contained.",
      }),
      description: Type.String({
        description: "Short (3-5 word) summary of the task",
      }),
      background: Type.Optional(
        Type.Boolean({
          description: "Run in background (async). You'll be notified when it completes.",
          default: false,
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      // ── Resolve agent ──────────────────────────────────────────
      const { agents, piDir } = discoverAgents(ctx.cwd);
      const agent = agents.find((a) => a.name === params.agent_type);

      if (!agent) {
        const list = formatAgentList(agents);
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown agent: "${params.agent_type}".\nAvailable agents:\n${list}`,
            },
          ],
          details: { phase: "failed" as const, error: `Unknown agent: ${params.agent_type}` },
          isError: true,
        };
      }

      const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
      const sessionName = `task-${id}`;
      const artifactDir = join(piDir, "artifacts", sessionName);
      await mkdir(artifactDir, { recursive: true });
      const resultPath = join(artifactDir, "RESULT.md");

      const descText = params.description || "";

      // ── Require tmux ───────────────────────────────────────────
      if (!hasTmux()) {
        return {
          content: [{ type: "text" as const, text: "tmux is required for background tasks." }],
          details: { phase: "failed" as const, error: "tmux not found" },
          isError: true,
        };
      }

      // Write system prompt and worker context
      await writeFile(join(artifactDir, "SYSTEM.md"), agent.body, "utf-8");

      const contextContent = [
        `# Task: ${descText}`,
        "",
        `## Agent`,
        `${agent.name} (${agent.source})`,
        "",
        `## Instructions`,
        params.prompt,
        "",
        `## Working Directory`,
        ctx.cwd,
        "",
        `## Output`,
        `Write your result to ${resultPath}`,
        "",
        "Use this format:",
        "",
        "```",
        OUTPUT_FORMAT_GUIDE,
        "```",
      ].join("\n");
      await writeFile(join(artifactDir, "WORKER-CONTEXT.md"), contextContent, "utf-8");

      const promptContent = [
        `Read ${join(artifactDir, "WORKER-CONTEXT.md")} for your task.`,
        `Write your findings/output to ${resultPath}`,
        "",
        "Format:",
        OUTPUT_FORMAT_GUIDE,
      ].join("\n");
      await writeFile(join(artifactDir, "USER-PROMPT.md"), promptContent, "utf-8");

      const modelFlag = agent.model ? `--model ${shellQuote(agent.model)}` : "";
      const disallowed = agent.disallowedTools;
      const allowedTools = disallowed?.length
        ? ALL_TOOL_NAMES.filter((t) => !disallowed.includes(t)).join(",")
        : "";
      const toolsFlag = allowedTools ? `--tools ${shellQuote(allowedTools)}` : "";
      const sessionDir = join(artifactDir, "sessions");
      await mkdir(sessionDir, { recursive: true });

      const piArgs = [
        "PI_TASK_TOOL_DISABLED=1",
        "pi",
        `--name ${shellQuote(sessionName)}`,
        modelFlag,
        toolsFlag,
        `--session-dir ${shellQuote(sessionDir)}`,
        `--append-system-prompt ${shellQuote(join(artifactDir, "SYSTEM.md"))}`,
        shellQuote(`@${join(artifactDir, "USER-PROMPT.md")}`),
      ]
        .filter(Boolean)
        .join(" ");
      const shellCommand = `cd ${shellQuote(ctx.cwd)} && ${piArgs}`;

      // ── Spawn pi in a tmux split pane ──────────────────────────
      let paneId: string;
      let originalPane: string | null;
      try {
        const splitResult = splitWindowPane(ctx.cwd, shellCommand);
        paneId = splitResult.paneId;
        originalPane = splitResult.originalPane;
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: "Failed to create tmux split pane for the agent.",
            },
          ],
          details: { phase: "failed" as const, error: "tmux split failed" },
          isError: true,
        };
      }

      const bgtask: BackgroundTask = {
        dir: artifactDir,
        agentType: agent.name,
        sessionName,
        paneId,
        originalPane,
        description: descText,
        startedAt: Date.now(),
        toolUses: 0,
        turns: 0,
      };
      backgroundTasks.set(id, bgtask);

      // Wire abort signal to kill the sub-agent pane
      if (signal) {
        signal.addEventListener("abort", () => {
        killAgentPane(paneId, originalPane);
        backgroundTasks.delete(id);
        if (backgroundTasks.size === 0) {
          stopWidget();
          if (widgetCtx) {
            widgetCtx.ui.setWidget("task", undefined);
            widgetCtx = null;
          }
        }
        }, { once: true });
      }

      // Show sticky widget above editor with smooth 1s refresh
      if (!widgetCtx) {
        widgetCtx = ctx;
        widgetCtx.ui.setWidget("task", (tui, _theme) => {
          widgetTimer = setInterval(() => tui.requestRender(), 1_000);
          return {
            render: (width: number) => renderWidget(width),
            invalidate: () => {},
            dispose: () => stopWidget(),
          };
        });
      }

      return {
        content: [],
        details: {
          task_id: id,
          agent_type: agent.name,
          description: descText,
          tmux_session: sessionName,
          background: true,
        },
      };
    },

    renderCall(args, theme, _context) {
      const agentName = ((args as Record<string, unknown>).agent_type as string) || "...";
      const desc = ((args as Record<string, unknown>).description as string) || "";

      let text = theme.fg("toolTitle", "");
      text += theme.fg("accent", agentName);
      if (desc) text += theme.fg("dim", ` - ${desc}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const d = result.details as TaskDetails | undefined;
      if (!d) return new Text("", 0, 0);

      const agentType = d.agent_type || "";
      const desc = d.description || "";

      // ── Background / running — hide result text (shown via widget above editor)
      // Must return a real component, not undefined. Returning undefined causes
      // ToolExecutionComponent to add undefined to the Box children, which throws
      // TypeError during rendering.
      if (d.background) {
        return new Text("", 0, 0);
      }

      // ── Error / timeout / aborted ──────────────────────────
      if (d.phase === "timeout" || d.phase === "aborted" || d.phase === "failed") {
        const line =
          theme.fg("error", "✗") +
          " " +
          theme.fg("accent", agentType) +
          " " +
          theme.fg("dim", `[${d.phase}]`);
        return new Text(line, 0, 0);
      }

      // ── Completed ───────────────────────────────────────────
      const isError = d.status === "failure" || d.status === "blocked" || d.status === "unknown";
      const status = d.status || "completed";
      const durationMs = d.duration_ms || 0;
      const toolUses = d.tool_uses || 0;
      const turns = d.turn_count || 0;

      const useStr = toolUses > 0 ? `${turns || toolUses} toolcalls` : "";
      const durStr = durationMs >= 1000 ? formatMs(durationMs) : "";
      const statsParts = [useStr, durStr].filter(Boolean);
      const statsStr = statsParts.length ? " " + theme.fg("dim", statsParts.join(" • ")) : "";

      const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
      let line = icon + " " + theme.fg("accent", agentType) + statsStr;

      if (expanded) {
        const s = d.summary || "";
        const f = d.findings || "";
        const e = d.evidence || "";
        if (s) line += "\n" + theme.fg("muted", s);
        if (f) line += "\n" + theme.fg("dim", f);
        if (e) line += "\n" + theme.fg("muted", "Evidence: ") + theme.fg("dim", e);
      } else {
        const preview = (d.summary || "").slice(0, 80);
        if (preview) line += "\n" + theme.fg("dim", `  ⎿  ${preview}`);
        else line += "\n" + theme.fg("dim", `  ⎿  ${isError ? status : "Done"}`);
      }

      return new Text(line, 0, 0);
    },
  });
}
