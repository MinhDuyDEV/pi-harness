import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Type, Optional } from "@sinclair/typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { getDcpSessionId } from "./compress-state.js";
import {
  listDurableSessionStates,
  loadDurableSessionState,
  loadDurableSessionStateFromPath,
} from "./storage.js";

interface RecallEntry {
  index: number;
  source: "dcp" | "jsonl";
  sessionKey?: string;
  role?: string;
  title: string;
  text: string;
  timestamp?: number;
  path?: string;
}

interface RecallOptions {
  sessionId: string;
  sessionFile?: string;
  query?: string;
  expand?: number[];
  page?: number;
  scope?: "active" | "all";
  limit?: number;
}

export interface RecallResult {
  entries: RecallEntry[];
  rendered: string;
  total: number;
}

const PAGE_SIZE = 5;
const RAW_SESSION_DIR = join(homedir(), ".pi", "agent", "sessions");

export function registerRecallTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "dcp_recall",
    label: "DCP Recall",
    description:
      "Search durable DCP blocks and persisted Pi session JSONL history. Supports regex queries, pagination, expand, and scope:'all'.",
    promptSnippet:
      "Search exact durable DCP history when compacted context may have omitted details.",
    promptGuidelines: [
      "Use dcp_recall before guessing about old compacted context.",
      "Search first, then call expand with result indices when you need exact full content.",
      "Use scope:'all' only when current-lineage results are insufficient.",
    ],
    parameters: Type.Object({
      query: Optional(
        Type.String({
          description:
            "Search query. Regex is supported; multi-word queries are OR-ranked.",
        }),
      ),
      expand: Optional(
        Type.Array(Type.Number(), {
          description: "Recall indices to expand with full content.",
        }),
      ),
      page: Optional(
        Type.Number({ description: "1-based page number for search results." }),
      ),
      scope: Optional(
        Type.Union([Type.Literal("active"), Type.Literal("all")], {
          description:
            "active searches current DCP state first; all searches all durable/session logs.",
        }),
      ),
      limit: Optional(
        Type.Number({
          description: "Maximum entries to return before pagination.",
        }),
      ),
    }),
    renderCall: (_args, theme) =>
      new Text(theme.fg("toolTitle", theme.bold("⚙ dcp_recall")), 0, 0),
    async execute(
      _toolCallId: string,
      params: {
        query?: string;
        expand?: number[];
        page?: number;
        scope?: "active" | "all";
        limit?: number;
      },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const result = searchDcpRecall({
        sessionId: getDcpSessionId(ctx),
        sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
        ...params,
      });
      return {
        content: [{ type: "text", text: result.rendered }],
        details: { total: result.total, entries: result.entries },
      };
    },
  });
}

export function searchDcpRecall(options: RecallOptions): RecallResult {
  const entries = buildRecallEntries(
    options.sessionId,
    options.scope ?? "active",
    options.sessionFile,
  );
  const expanded = options.expand?.length
    ? entries.filter((entry) => options.expand?.includes(entry.index))
    : undefined;
  if (expanded) {
    return {
      entries: expanded,
      total: expanded.length,
      rendered: renderExpanded(expanded),
    };
  }

  const hasQuery = Boolean(options.query?.trim());
  const queried = hasQuery
    ? rankAndFilter(entries, options.query?.trim() ?? "")
    : entries
        .filter(isBrowseEntry)
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const limited = queried.slice(0, options.limit ?? 200);
  const page = Math.max(1, options.page ?? 1);
  const start = (page - 1) * PAGE_SIZE;
  const pageEntries = limited.slice(start, start + PAGE_SIZE);
  return {
    entries: pageEntries,
    total: queried.length,
    rendered: renderSearch(pageEntries, queried.length, page, options.query),
  };
}

function buildRecallEntries(
  sessionId: string,
  scope: "active" | "all",
  sessionFile?: string,
): RecallEntry[] {
  const entries: RecallEntry[] = [];
  let index = 1;
  const durableStates =
    scope === "all"
      ? listDurableSessionStates()
          .map((info) => loadDurableSessionStateFromPath(info.path))
          .filter(Boolean)
      : [loadDurableSessionState(sessionId)].filter(Boolean);

  for (const state of durableStates) {
    for (const block of state?.blocks ?? []) {
      entries.push({
        index: index++,
        source: "dcp",
        sessionKey: state?.sessionKey,
        title: `[dcp:b${block.id}] ${block.topic}`,
        text: [
          block.summary,
          block.filesRead.length
            ? `Files read: ${block.filesRead.join(", ")}`
            : "",
          block.filesModified.length
            ? `Files modified: ${block.filesModified.join(", ")}`
            : "",
          block.decisions.length
            ? `Decisions: ${block.decisions.join("; ")}`
            : "",
          block.nextSteps.length
            ? `Next steps: ${block.nextSteps.join("; ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        timestamp: block.createdAt,
      });
    }
  }

  for (const path of listRawSessionFiles(scope, sessionFile)) {
    const stat = safeStat(path);
    const sessionKey = rawSessionKey(path);
    if (scope === "active" && sessionFile && path !== sessionFile) continue;
    for (const raw of readJsonlLines(path)) {
      if (!shouldIncludeJsonlEntry(raw)) continue;
      const text = jsonlText(raw);
      if (!text.trim()) continue;
      const role = jsonlRole(raw);
      entries.push({
        index: index++,
        source: "jsonl",
        sessionKey,
        role,
        title: `[jsonl:${role || "entry"}]`,
        text,
        path,
        timestamp: jsonlTimestamp(raw) ?? Number(stat?.mtimeMs ?? 0),
      });
    }
  }
  return entries;
}

function listRawSessionFiles(
  scope: "active" | "all",
  sessionFile?: string,
): string[] {
  if (scope === "active" && sessionFile && existsSync(sessionFile))
    return [sessionFile];
  if (scope === "active") return [];
  if (!existsSync(RAW_SESSION_DIR)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = safeStat(path);
      if (!stat) continue;
      if (stat.isDirectory()) walk(path);
      if (stat.isFile() && /\.jsonl?$/.test(name)) files.push(path);
    }
  };
  walk(RAW_SESSION_DIR);
  files.sort(
    (a, b) =>
      Number(safeStat(b)?.mtimeMs ?? 0) - Number(safeStat(a)?.mtimeMs ?? 0),
  );
  return scope === "all" ? files.slice(0, 200) : files.slice(0, 20);
}

function readJsonlLines(path: string): unknown[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return line;
        }
      });
  } catch {
    return [];
  }
}

function isBrowseEntry(entry: RecallEntry): boolean {
  if (entry.source === "dcp") return true;
  if (isBrowseDiagnostic(entry.text)) return false;
  if (isLowSignalAcknowledgement(entry.text)) return false;
  const role = entry.role?.toLowerCase() ?? "";
  if (role === "user") return true;
  if (role === "assistant") return !/^tool call:/i.test(entry.text.trim());
  return false;
}

function rankAndFilter(entries: RecallEntry[], query: string): RecallEntry[] {
  const regex = safeRegex(query);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .map((entry) => {
      const haystack = `${entry.title}\n${entry.text}`;
      const lower = haystack.toLowerCase();
      let matchScore = 0;
      if (regex?.test(haystack)) matchScore += 12;
      for (const term of terms) {
        const count = lower.split(term).length - 1;
        matchScore += Math.min(count, 3) * Math.max(1, 8 - term.length / 4);
      }
      if (matchScore <= 0) return { entry, score: 0 };
      const score =
        matchScore +
        recallRoleBoost(entry) -
        recallLengthPenalty(entry.text) -
        recallEchoPenalty(entry.text);
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.entry.timestamp ?? 0) - (a.entry.timestamp ?? 0),
    )
    .map((item) => item.entry);
}

function recallRoleBoost(entry: RecallEntry): number {
  if (entry.source === "dcp") return 80;
  const role = entry.role?.toLowerCase() ?? "";
  if (role === "user") return 45;
  if (role === "assistant")
    return /^tool call:/i.test(entry.text.trim()) ? -30 : 35;
  if (role === "toolresult" || role === "tool_result" || role === "tool")
    return -25;
  return 0;
}

function recallLengthPenalty(text: string): number {
  return Math.min(20, Math.floor(text.length / 2_000));
}

function recallEchoPenalty(text: string): number {
  return isRecallEcho(text) ? 55 : 0;
}

function isBrowseDiagnostic(text: string): boolean {
  return isRecallEcho(text) || isBenchmarkDiagnostic(text);
}

function isRecallEcho(text: string): boolean {
  const markers = [
    /DCP recall (?:for|browse):/i,
    /\/d[ceo]p-recall/i,
    /output\s+["']?\/d[ceo]p-recall/i,
    /new output .*\/d[ceo]p-recall/i,
    /#\d+\s+\[jsonl:/i,
    /Expand with \/d[ceo]p-recall/i,
    /Brutal review:.*(?:recall|browse-mode|query mode)/is,
    /This is \*\*clean\*\*.*too sparse/is,
    /Browse mode no longer shows:/i,
    /Browse mode .*?(?:tool spam|raw JSON|recall-debug loop|low-signal|too sparse)/is,
  ];
  return markers.some((marker) => marker.test(text));
}

function isBenchmarkDiagnostic(text: string): boolean {
  const markers = [
    /DCP deterministic compaction benchmark:/i,
    /DCP compaction diagnostic benchmark:/i,
    /\/dcp-ben(?:ch)?mark/i,
    /Use this output beside pi-vcc metrics/i,
    /Diagnostic only\. Normal workflow: \/compact and \/dcp-recall/i,
    /benchmark formatting is fixed/i,
    /That benchmark is .*?(?:excellent|very good)/is,
    /Before:\s*[\d,]+.*After:\s*[\d,]+.*Reduction:/is,
  ];
  return markers.some((marker) => marker.test(text));
}

function isLowSignalAcknowledgement(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[.!?"'`*_~()[\]{}:;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return true;
  if (normalized.length > 80) return false;
  const patterns = [
    /^(ok|okay|sure|yes|yep|yeah|fine|good|great|sounds good|nice|thanks|thank you)$/,
    /^(ok|okay) (sure|sounds good|thanks|thank you)$/,
    /^(ok|okay|sure|yes|yep|yeah|fine|sounds good) (go ahead|continue|please continue|do it|proceed)$/,
    /^(ok|okay|sure|yes|yep|yeah|fine) (go ahead )?continue( next work)?$/,
    /^please continue$/,
    /^go ahead$/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function renderSearch(
  entries: RecallEntry[],
  total: number,
  page: number,
  query?: string,
): string {
  const normalizedQuery = query?.trim();
  const lines = [
    `DCP recall${normalizedQuery ? ` for "${normalizedQuery}"` : " browse"}: ${total} result${total === 1 ? "" : "s"} (page ${page})`,
  ];
  if (entries.length === 0) {
    lines.push("No results. Try a broader query or scope:'all'.");
    return lines.join("\n");
  }
  for (const entry of entries) {
    const displayText = normalizeRecallDisplayText(entry.text);
    const snippet = oneLine(displayText, normalizedQuery ? 300 : 180);
    if (normalizedQuery) {
      lines.push("", `#${entry.index} ${entry.title}`, snippet);
    } else {
      lines.push(`#${entry.index} ${entry.title} — ${snippet}`);
    }
  }
  lines.push("", "Expand with /dcp-recall expand:<index>.");
  return lines.join("\n");
}

function renderExpanded(entries: RecallEntry[]): string {
  if (entries.length === 0) return "No matching recall indices.";
  return entries
    .map((entry) =>
      [
        `#${entry.index} ${entry.title}`,
        normalizeRecallDisplayText(entry.text),
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

function normalizeRecallDisplayText(text: string): string {
  return text
    .replace(/\bde[pp]_recall\b/gi, "dcp_recall")
    .replace(/\bdop_recall\b/gi, "dcp_recall")
    .replace(/\bde[pp]-recall\b/gi, "dcp-recall")
    .replace(/\bdop-recall\b/gi, "dcp-recall")
    .replace(/\/de[pp]-recall\b/gi, "/dcp-recall")
    .replace(/\/dop-recall\b/gi, "/dcp-recall")
    .replace(/\bde[pp]_state\b/gi, "dcp_state")
    .replace(/\bdop_state\b/gi, "dcp_state")
    .replace(/\bde[pp]\/(index\.ts|[\w.-]+\.ts)\b/gi, "dcp/$1")
    .replace(/\bdop\/(index\.ts|[\w.-]+\.ts)\b/gi, "dcp/$1")
    .replace(/\bde[pp]\/([\w./-]*dcp[\w./-]*)/gi, "dcp/$1")
    .replace(/\bdop\/([\w./-]*dcp[\w./-]*)/gi, "dcp/$1");
}

function shouldIncludeJsonlEntry(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  const customType = typeof obj.customType === "string" ? obj.customType : "";
  if (obj.type === "custom") return false;
  if (customType) return false;
  return true;
}

function jsonlPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (obj.type === "message" && obj.message && typeof obj.message === "object")
    return obj.message;
  if (obj.type === "custom" && obj.customType === "dcp_state") return obj.data;
  return value;
}

function jsonlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return String(value ?? "");
  const payload = jsonlPayload(value);
  if (!payload || typeof payload !== "object") return contentToText(payload);
  const obj = payload as Record<string, unknown>;
  if (obj.snapshot && typeof obj.snapshot === "object") {
    const snapshot = obj.snapshot as Record<string, unknown>;
    const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks.length : 0;
    return `DCP state snapshot (${blocks} block${blocks === 1 ? "" : "s"})`;
  }
  return contentToText(
    obj.content ??
      obj.message ??
      obj.text ??
      obj.output ??
      obj.result ??
      payload,
  );
}

function jsonlRole(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const payload = jsonlPayload(value);
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.role === "string") return obj.role;
  }
  const obj = value as Record<string, unknown>;
  return String(obj.customType ?? obj.type ?? "");
}

function jsonlTimestamp(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const raw = obj.timestamp ?? obj.createdAt ?? obj.created_at;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content))
    return content.map(contentToText).filter(Boolean).join("\n");
  if (typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (obj.type === "thinking" || typeof obj.thinking === "string") return "";
    if (obj.type === "toolCall")
      return `tool call: ${String(obj.name ?? obj.toolName ?? "unknown")}`;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string" || Array.isArray(obj.content))
      return contentToText(obj.content);
    if (obj.message) return contentToText(obj.message);
    if (obj.output) return contentToText(obj.output);
    if (obj.result) return contentToText(obj.result);
    if (obj.data) return contentToText(obj.data);
    return "";
  }
  return String(content);
}

function safeRegex(query: string): RegExp | undefined {
  try {
    return new RegExp(query, "i");
  } catch {
    return undefined;
  }
}

function safeStat(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function rawSessionKey(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.jsonl?$/, "") ?? path
  );
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat;
}
