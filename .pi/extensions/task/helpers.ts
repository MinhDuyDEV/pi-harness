/**
 * Task Extension — Pure helper functions.
 *
 * No side effects, no ExtensionAPI dependency. All functions here are
 * unit-testable with node:assert/strict.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  thinking?: string;
  disallowedTools?: string[];
  body: string;
  source: "project" | "user";
  path: string;
}

export interface ParsedResult {
  status: string;
  summary: string;
  findings: string;
  evidence: string;
  confidence: string;
  raw: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const TASK_BACKGROUND_DEFAULT = true;

export const TASK_RESULT_XML_INSTRUCTIONS = `<status>success|failure|blocked|partial</status>
<summary>One sentence: what was accomplished</summary>
<findings>Key findings with file:line references</findings>
<evidence>Verification evidence, commands run, output snippets</evidence>
<confidence>high|medium|low (optional — how certain the findings are)</confidence>
<files>Comma-separated absolute paths of files read/created (optional)</files>`;

export const OUTPUT_FORMAT_GUIDE = TASK_RESULT_XML_INSTRUCTIONS;

export const TASK_TOOL_DESCRIPTION = `Launch a new agent to handle complex, multistep tasks autonomously.

Include relevant context from your current work in the prompt parameter —
this becomes the subagent's instructions. The subagent knows nothing about what you've been doing except what you put in the prompt.

When NOT to use:
- To read a specific file path, use Read or Grep instead
- To search for a class definition like 'class Foo', use Grep instead
- To search code within 2-3 files, use Read instead
- If no available agent fits the task, use other tools directly

Usage notes:
1. Provide complete context in the prompt — the subagent starts with a fresh context
2. Launch multiple agents concurrently when possible (use a single message with multiple tool calls)
3. Once you delegate work, do NOT duplicate it. Continue with non-overlapping tasks, or wait for the result
4. Background is the default. Use background:false only when you need the caller to wait inline for the tmux task result
5. Do not trust delegated output blindly. Read changed files, review the diff, verify scope, and run the relevant checks before claiming completion
6. Clearly tell the agent whether to write code or just research, since it doesn't know the user's intent
7. The result returned by the agent is not visible to the user. Send a concise summary back to the user
8. Pass task_id to resume a previous subagent session (continues with its prior context)

Background mode (background: true):
- Launches the subagent asynchronously and returns immediately
- You will be notified automatically when it finishes
- DO NOT sleep, poll, ask the task for status, or duplicate its work while it runs in background
- Avoid working with the same files or topics the background task is using
- Work on non-overlapping tasks, or briefly tell the user what you launched and end your response`;

// All built-in tool names
export const ALL_TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls"];

// Cached regex patterns for XML result parsing
const STATUS_RE = /<status>([\s\S]*?)<\/status>/i;
const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i;
const FINDINGS_RE = /<findings>([\s\S]*?)<\/findings>/i;
const EVIDENCE_RE = /<evidence>([\s\S]*?)<\/evidence>/i;
const CONFIDENCE_RE = /<confidence>([\s\S]*?)<\/confidence>/i;

// ─── Result Parsing ──────────────────────────────────────────────────────────

export function extractTag(raw: string, re: RegExp): string {
  const m = raw.match(re);
  return m ? m[1].trim() : "";
}

export function parseResultXml(raw: string): ParsedResult {
  const status = extractTag(raw, STATUS_RE);

  if (
    !status &&
    !extractTag(raw, SUMMARY_RE) &&
    !extractTag(raw, FINDINGS_RE) &&
    !extractTag(raw, EVIDENCE_RE)
  ) {
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

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatMs(ms: number): string {
  if (ms >= 60_000)
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

export function parseIdTimestamp(id: string): number {
  try {
    const ts36 = id.split("-")[0];
    if (ts36) return parseInt(ts36, 36);
  } catch {
    /* fall through */
  }
  return Date.now();
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildTmuxSendKeysArgs(paneId: string, command: string): string[] {
  return ["send-keys", "-t", paneId, command, "Enter"];
}

export interface BackgroundReceiptInput {
  taskId: string;
  agentType: string;
  tmuxSession: string;
  artifactDir: string;
}

export function formatBackgroundReceipt(input: BackgroundReceiptInput): string {
  return [
    `Started task ${input.taskId} with ${input.agentType}.`,
    `Tmux session: ${input.tmuxSession}.`,
    `Artifact directory: ${input.artifactDir}.`,
    "A completion notification will arrive automatically; do not poll or duplicate this work.",
  ].join("\n");
}

// ─── Agent Discovery ─────────────────────────────────────────────────────────

export function findPiDir(cwd: string): string | null {
  let current = resolve(cwd);
  while (true) {
    if (basename(current) === ".pi") {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
      continue;
    }
    if (existsSync(join(current, ".pi"))) return join(current, ".pi");
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function getGlobalAgentDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".pi", "agent", "agents");
}

export function loadAgentsFromDir(
  dir: string,
  source: "project" | "user",
): AgentConfig[] {
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

    const { frontmatter, body } =
      parseFrontmatter<Record<string, string>>(content);
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
      path: filePath,
    });
  }
  return agents;
}

export function discoverAgents(cwd: string): {
  agents: AgentConfig[];
  piDir: string;
} {
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

export function formatAgentList(agents: AgentConfig[]): string {
  if (agents.length === 0) return "none available";
  return agents
    .map((a) => `${a.name} (${a.source}): ${a.description}`)
    .join("\n");
}

// ─── Sub-agent CLI args ─────────────────────────────────────────────────────

/**
 * Build pi CLI arguments for spawning or resuming a sub-agent session.
 *
 * - Fresh spawn: omit `resume` or pass falsy — `--session` is not included.
 * - Resume: pass `resume=true` — `--session <name>` is included so pi
 *   continues the existing session file in --session-dir.
 */
export function buildPiArgs(
  agent: AgentConfig,
  sessionName: string,
  sessionDir: string,
  promptContent: string,
  resume?: boolean,
): string[] {
  const args: string[] = [];

  if (agent.model) args.push("--model", agent.model);

  const disallowed = agent.disallowedTools;
  const allowedTools = disallowed?.length
    ? ALL_TOOL_NAMES.filter((t) => !disallowed.includes(t))
    : undefined;
  if (allowedTools?.length) args.push("--tools", allowedTools.join(","));

  args.push("--name", sessionName);
  args.push("--session-dir", sessionDir);
  if (resume) {
    args.push("--session", sessionName);
  }
  args.push("--append-system-prompt", agent.body);
  args.push(promptContent);

  return args;
}

// ─── JSONL Session Helpers ───────────────────────────────────────────────────

/** Count tool uses and turns from pi JSONL session files. */
export function countToolUses(sessionDir: string): {
  toolUses: number;
  turns: number;
} {
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
