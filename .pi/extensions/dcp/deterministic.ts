import type { CompressionBlock, PersistentSessionSummary } from "./compress";

export type CompactionReason = "manual" | "threshold" | "overflow" | "unknown";

export interface DeterministicSummaryOptions {
  messages: readonly unknown[];
  serializedConversation?: string;
  previousSummary?: string;
  persistentSummary?: PersistentSessionSummary;
  blocks?: readonly CompressionBlock[];
  maxTranscriptLines?: number;
  maxSectionItems?: number;
  compactionReason?: CompactionReason;
  willRetry?: boolean;
  customInstructions?: string;
}

export interface DeterministicSummaryResult {
  summary: string;
  estimatedTokensAfter: number;
  lineCount: number;
}

const DEFAULT_MAX_TRANSCRIPT_LINES = 140;
const DEFAULT_MAX_SECTION_ITEMS = 24;

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function buildDeterministicSummary(
  options: DeterministicSummaryOptions,
): DeterministicSummaryResult {
  const maxTranscriptLines =
    options.maxTranscriptLines ?? DEFAULT_MAX_TRANSCRIPT_LINES;
  const maxSectionItems = options.maxSectionItems ?? DEFAULT_MAX_SECTION_ITEMS;
  const messages = options.serializedConversation
    ? [{ role: "conversation", content: options.serializedConversation }]
    : (options.messages ?? []);
  const persistent = options.persistentSummary;
  const blocks = options.blocks ?? [];

  const goals = uniqueStrings([
    ...extractGoals(messages),
    ...(blocks.length > 0
      ? [
          `Continue from ${blocks.length} durable DCP compression block${blocks.length === 1 ? "" : "s"}.`,
        ]
      : []),
  ]).slice(0, maxSectionItems);

  const filesRead = uniqueStrings([
    ...(persistent?.files_read ?? []),
    ...blocks.flatMap((block) => blockFields(block).files_read),
    ...extractPaths(messages, "read"),
  ]).slice(-maxSectionItems);
  const filesModified = uniqueStrings([
    ...(persistent?.files_modified ?? []),
    ...blocks.flatMap((block) => blockFields(block).files_modified),
    ...extractPaths(messages, "modified"),
  ]).slice(-maxSectionItems);
  const decisions = uniqueStrings([
    ...(persistent?.decisions ?? []).map((decision) => decision.text),
    ...blocks.flatMap((block) => blockFields(block).decisions),
    ...extractDecisionLines(messages),
  ]).slice(-maxSectionItems);
  const nextSteps = uniqueStrings([
    ...(persistent?.next_steps ?? []).map((step) => step.text),
    ...blocks.flatMap((block) => blockFields(block).next_steps),
    ...extractOutstanding(messages),
  ]).slice(-maxSectionItems);

  const transcript = buildBriefTranscript(messages, maxTranscriptLines);
  const compactionContext = buildCompactionContext(options);
  const sections: string[] = [];
  sections.push(
    "## Goal",
    goals.length
      ? goals.map((item) => `- ${item}`).join("\n")
      : "Continue the current task.",
    "",
    "## How To Use This Summary",
    "- Treat this as compacted observations, not a full transcript; use the live tail for the freshest intent.",
    "- If this summary conflicts with current messages or files on disk, trust current messages and disk first.",
    "- Before guessing about missing prior context, use DCP recall/expanded blocks when available.",
    "- Preserve the distinction between observations (what happened) and decisions (why it happened).",
    "",
  );
  sections.push(
    "## Progress",
    "### Done",
    "- [x] Preserved older context through deterministic DCP compaction.",
    "",
    "### In Progress",
  );
  pushBullets(
    sections,
    nextSteps.length ? nextSteps : ["Continue from the kept recent messages."],
    "- [ ] ",
  );
  sections.push("", "### Blocked", ...extractBlocked(nextSteps), "");
  sections.push("## Key Decisions");
  pushBullets(
    sections,
    decisions.length
      ? decisions
      : [
          "Use deterministic DCP compaction as the primary context-preservation path.",
        ],
    "- ",
  );
  sections.push("", "## Critical Context");
  if (compactionContext.length > 0) {
    sections.push("Compaction metadata:");
    pushBullets(sections, compactionContext, "- ");
    sections.push("");
  }
  if (options.previousSummary)
    sections.push(
      "Previous compaction summary:",
      oneLine(options.previousSummary, 1200),
      "",
    );
  pushBullets(
    sections,
    blocks
      .slice(-maxSectionItems)
      .map((block) => `${block.topic}: ${oneLine(block.summary, 180)}`),
    "- ",
  );
  sections.push(
    "",
    "<read-files>",
    ...filesRead,
    "</read-files>",
    "",
    "<modified-files>",
    ...filesModified,
    "</modified-files>",
    "",
  );
  if (transcript.length > 0) {
    sections.push("## Brief Transcript", ...transcript);
  }

  const summary = sections.join("\n").trim();
  return {
    summary,
    estimatedTokensAfter: estimateTextTokens(summary),
    lineCount: summary.split("\n").length,
  };
}

function blockFields(block: CompressionBlock): {
  files_read: string[];
  files_modified: string[];
  decisions: string[];
  next_steps: string[];
} {
  const meta = block.metadata as Record<string, unknown> | undefined;
  return {
    files_read: parseStringArray(meta?.files_read),
    files_modified: parseStringArray(meta?.files_modified),
    decisions: parseStringArray(meta?.decisions),
    next_steps: parseStringArray(meta?.next_steps),
  };
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

function pushBullets(out: string[], items: string[], prefix: string): void {
  for (const item of items.filter(Boolean)) out.push(`${prefix}${item}`);
}

function buildCompactionContext(
  options: DeterministicSummaryOptions,
): string[] {
  const context: string[] = [];
  if (options.compactionReason) {
    context.push(`Reason: ${options.compactionReason}`);
  }
  if (typeof options.willRetry === "boolean") {
    context.push(
      options.willRetry
        ? "Pi will retry the interrupted turn after compaction. Preserve the latest user intent and recovery context."
        : "Pi will not retry an interrupted turn after this compaction.",
    );
  }
  if (options.compactionReason === "overflow") {
    context.push(
      "Overflow recovery: be conservative and keep split-turn/tool context needed for retry.",
    );
  }
  if (options.customInstructions?.trim()) {
    context.push(
      `Manual compact instructions: ${oneLine(options.customInstructions, 240)}`,
    );
  }
  return context;
}

function extractBlocked(nextSteps: string[]): string[] {
  const blocked = nextSteps.filter((item) =>
    /\b(blocked|failing|failed|error)\b/i.test(item),
  );
  return blocked.length
    ? blocked.map((item) => `- ${item}`)
    : ["- None known."];
}

function buildBriefTranscript(
  messages: readonly unknown[],
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let toolRef = 1;
  for (const message of messages) {
    const role = getRole(message);
    if (role === "system") continue;
    const text = getMessageText(message);
    const toolName = getToolName(message);
    if (toolName) {
      lines.push(
        `* ${toolName} ${quote(oneLine(text || getToolInput(message), 160))} (#${toolRef++})`,
      );
      continue;
    }
    if (!text.trim()) continue;
    lines.push(`[${role || "message"}]`);
    lines.push(oneLine(text, 500));
  }
  if (lines.length <= maxLines) return lines;
  const omitted = lines.length - maxLines;
  return [
    `...(${omitted} earlier transcript lines omitted)`,
    ...lines.slice(-maxLines),
  ];
}

function extractGoals(messages: readonly unknown[]): string[] {
  const userTexts = messages
    .filter((message) => getRole(message) === "user")
    .map(getMessageText)
    .filter(Boolean);
  const goals: string[] = [];
  if (userTexts[0]) goals.push(oneLine(userTexts[0], 220));
  for (const text of userTexts.slice(1)) {
    if (
      /\b(also|actually|instead|new plan|scope|change|please|can you|i want)\b/i.test(
        text,
      )
    ) {
      goals.push(`[Scope change] ${oneLine(text, 220)}`);
    }
  }
  return goals;
}

function extractDecisionLines(messages: readonly unknown[]): string[] {
  const decisions: string[] = [];
  const re =
    /\b(decided|decision|because|therefore|so we|we should|use .* instead|chosen|chose)\b/i;
  for (const message of messages) {
    const text = getMessageText(message);
    for (const sentence of splitSentences(text)) {
      if (re.test(sentence)) decisions.push(oneLine(sentence, 220));
    }
  }
  return decisions;
}

function extractOutstanding(messages: readonly unknown[]): string[] {
  const items: string[] = [];
  const re =
    /\b(todo|next|remaining|still|failing|failed|error|blocked|pending|follow up|not yet)\b/i;
  for (const message of messages) {
    const text = getMessageText(message);
    for (const sentence of splitSentences(text)) {
      if (re.test(sentence)) items.push(oneLine(sentence, 220));
    }
  }
  return items;
}

function extractPaths(
  messages: readonly unknown[],
  mode: "read" | "modified",
): string[] {
  const paths: string[] = [];
  const writeRe =
    /\b(?:modified|created|updated|edited|wrote|deleted|write|edit)\b/i;
  const pathRe =
    /(?:^|[\s"'`])((?:\.\.?\/)?[\w@.-][\w@./-]*\.[A-Za-z0-9]{1,8})(?=$|[\s"'`,:;)])/g;
  for (const message of messages) {
    const text = `${getToolName(message)} ${getToolInput(message)} ${getMessageText(message)}`;
    const role = getRole(message);
    const isModified =
      writeRe.test(text) ||
      /^(write|edit|strreplace|delete)$/i.test(getToolName(message));
    if (mode === "modified" && !isModified) continue;
    if (
      mode === "read" &&
      role !== "tool" &&
      !/\b(read|grep|find|ls|glob|cat|sed)\b/i.test(text)
    )
      continue;
    let match: RegExpExecArray | null;
    while ((match = pathRe.exec(text)) !== null) paths.push(match[1]);
  }
  return paths;
}

function getRole(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const obj = message as Record<string, unknown>;
  return String(obj.role ?? obj.type ?? "").toLowerCase();
}

function getToolName(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const obj = message as Record<string, unknown>;
  const direct = obj.toolName ?? obj.tool_name ?? obj.name;
  if (typeof direct === "string") return direct;
  const call = obj.toolCall ?? obj.tool_call;
  if (call && typeof call === "object") {
    const callObj = call as Record<string, unknown>;
    return String(callObj.name ?? callObj.toolName ?? "");
  }
  return "";
}

function getToolInput(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const obj = message as Record<string, unknown>;
  const input = obj.input ?? obj.args ?? obj.arguments ?? obj.parameters;
  if (typeof input === "string") return input;
  if (input && typeof input === "object") return stableStringify(input);
  return "";
}

function getMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return String(message ?? "");
  const obj = message as Record<string, unknown>;
  const content =
    obj.content ?? obj.message ?? obj.text ?? obj.output ?? obj.result;
  return contentToText(content);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          return contentToText(
            obj.text ??
              obj.content ??
              obj.input ??
              obj.output ??
              obj.result ??
              "",
          );
        }
        return String(item ?? "");
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") return stableStringify(content);
  return String(content);
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      Object.keys(value as Record<string, unknown>).sort(),
    );
  } catch {
    return String(value);
  }
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat;
}

function quote(text: string): string {
  return text ? `"${text}"` : "";
}
