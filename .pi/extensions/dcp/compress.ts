/**
 * DCP Extension — Compression Engine
 *
 * In-memory compression block management, compress tool registration,
 * and context-event message stripping (compress-strip, dedup, purge-errors).
 *
 * No SQLite. No external state. All state lives in a vanilla Map keyed by session ID.
 */

import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import type { DCPConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Custom message types (internal to DCP extension)
// ---------------------------------------------------------------------------

/** Custom message type for DCP compressed summaries */
interface DCPCompressedSummaryMessage {
  role: "custom";
  customType: "dcp-compressed-summary";
  content: string;
  display: boolean;
  timestamp: number;
}

/** Internal Pi message type for bash execution results */
interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
}

/** Internal Pi message type for compaction summaries */
interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
}

/** Internal Pi message type for branch summaries */
interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
}

// ---------------------------------------------------------------------------
// In-memory block storage
// ---------------------------------------------------------------------------

export interface CompressionBlock {
  blockId: number;
  topic: string;
  summary: string;
  startLabel: string;
  endLabel: string;
  summaryTokens: number;
  createdAt: number; // timestamp
}

export interface SessionState {
  blocks: CompressionBlock[];
  nextBlockId: number;
  /** Cumulative tokens saved by compression stripping */
  totalStrippedTokens: number;
  /** Cumulative items pruned by dedup/purge */
  totalPrunedCount: number;
}

const sessions = new Map<string, SessionState>();

function getState(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { blocks: [], nextBlockId: 1, totalStrippedTokens: 0, totalPrunedCount: 0 };
    sessions.set(sessionId, s);
  }
  return s;
}

/** Clean up session state on shutdown */
export function cleanupSession(sessionId: string): void {
  sessions.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Block operations
// ---------------------------------------------------------------------------

export function addBlock(
  sessionId: string,
  topic: string,
  summary: string,
  startLabel: string,
  endLabel: string,
): CompressionBlock {
  const state = getState(sessionId);
  const block: CompressionBlock = {
    blockId: state.nextBlockId++,
    topic,
    summary,
    startLabel,
    endLabel,
    summaryTokens: Math.ceil(summary.length / 4),
    createdAt: Date.now(),
  };
  state.blocks.push(block);
  return block;
}

export function getBlocks(sessionId: string): readonly CompressionBlock[] {
  return getState(sessionId).blocks;
}

export function getStats(sessionId: string) {
  const s = getState(sessionId);
  return {
    blockCount: s.blocks.length,
    totalStrippedTokens: s.totalStrippedTokens,
    totalPrunedCount: s.totalPrunedCount,
    summaryTokens: s.blocks.reduce((sum, b) => sum + b.summaryTokens, 0),
  };
}

// ---------------------------------------------------------------------------
// Context message stripping
//
// Invoked on every `context` event (before every LLM request).
// Three strategies applied in order:
//   1. compress-strip — replace ranges covered by compress blocks with summaries
//   2. dedup — strip duplicate tool call arguments, keep latest result
//   3. purge-errors — strip large inputs from old errored tool calls
// ---------------------------------------------------------------------------

/**
 * Estimate token count for a message using chars/4 heuristic.
 */
function estimateTokens(msg: Message): number {
  let chars = 0;
  if (msg.role === "assistant") {
    const asst = msg as AssistantMessage;
    for (const part of asst.content) {
      if (part.type === "text") chars += (part as TextContent).text?.length ?? 0;
      else if (part.type === "thinking") chars += (part as ThinkingContent).thinking?.length ?? 0;
      else if (part.type === "toolCall") {
        const tc = part as ToolCall;
        chars += tc.name.length + JSON.stringify(tc.arguments).length;
      }
    }
  } else if (msg.role === "user") {
    const um = msg as UserMessage;
    if (typeof um.content === "string") chars = um.content.length;
    else if (Array.isArray(um.content))
      chars = um.content.reduce((s: number, c: TextContent | ImageContent) => s + (c.type === "text" ? c.text.length : 0), 0);
  } else if (msg.role === "toolResult") {
    const tr = msg as ToolResultMessage;
    chars = tr.content.reduce((s: number, c: TextContent | ImageContent) => s + (c.type === "text" ? c.text.length : 0), 0);
  } else if ((msg as BashExecutionMessage).role === "bashExecution") {
    const b = msg as BashExecutionMessage;
    chars = (b.command?.length ?? 0) + (b.output?.length ?? 0);
  } else if ((msg as CompactionSummaryMessage).role === "compactionSummary" || (msg as BranchSummaryMessage).role === "branchSummary") {
    chars = (msg as CompactionSummaryMessage | BranchSummaryMessage).summary?.length ?? 0;
  }
  return Math.ceil(chars / 4);
}

function estimateToolArgsTokens(args: unknown): number {
  return Math.ceil(JSON.stringify(args).length / 4);
}

/** Strip tool arguments from a tool call content block, replace with a marker */
function stripToolArgs(tc: ToolCall, marker: string): number {
  const before = estimateToolArgsTokens(tc.arguments);
  tc.arguments = { __dcp: marker };
  return before;
}

// ── Step 1: Compress-strip ──────────────────────────────────────────────

interface ToolOp {
  messageIndex: number;
  contentIndex: number;
  type: "call" | "result";
  toolName: string;
  toolCallId: string;
  isError: boolean;
}

function extractToolOps(messages: Message[]): ToolOp[] {
  const ops: ToolOp[] = [];
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg.role === "assistant") {
      const asst = msg as AssistantMessage;
      if (!Array.isArray(asst.content)) continue;
      for (let ci = 0; ci < asst.content.length; ci++) {
        const part = asst.content[ci];
        if (part.type === "toolCall") {
          const tc = part as ToolCall;
          ops.push({ messageIndex: mi, contentIndex: ci, type: "call", toolName: tc.name, toolCallId: tc.id, isError: false });
        }
      }
    } else if (msg.role === "toolResult") {
      const tr = msg as ToolResultMessage;
      ops.push({ messageIndex: mi, contentIndex: -1, type: "result", toolName: tr.toolName, toolCallId: tr.toolCallId, isError: tr.isError ?? false });
    }
  }
  return ops;
}

/**
 * Strategy 1: Compress-range stripping.
 *
 * Find compress tool results, identify the message range before each call,
 * and replace those messages with a compact summary message.
 */
function applyCompressStrip(
  messages: Message[],
  config: DCPConfig,
): { messages: Message[]; prunedTokens: number; prunedCount: number } {
  const ops = extractToolOps(messages);
  const compressResults: Array<{
    callIndex: number;
    resultIndex: number;
    summary: string;
    topic: string;
  }> = [];

  // Find compress tool calls and their results
  for (const op of ops) {
    if (op.type !== "result" || op.toolName !== "compress" || op.isError) continue;
    const callOp = ops.find((o) => o.type === "call" && o.toolCallId === op.toolCallId);
    if (!callOp) continue;

    // Extract summary from result
    const resultMsg = messages[op.messageIndex] as ToolResultMessage;
    let fullText = "";
    for (const part of resultMsg.content) {
      if (part.type === "text") fullText += (part as TextContent).text ?? "";
    }
    const marker = "The following is the authoritative summary of the compressed range:";
    const idx = fullText.indexOf(marker);
    const summary = idx >= 0 ? fullText.substring(idx + marker.length).trim() : fullText;

    // Extract topic from call
    const callMsg = messages[callOp.messageIndex] as AssistantMessage;
    const tc = callMsg.content[callOp.contentIndex] as ToolCall;
    const topic = (tc.arguments as Record<string, unknown>)?.topic ?? "compressed";

    compressResults.push({
      callIndex: callOp.messageIndex,
      resultIndex: op.messageIndex,
      summary,
      topic,
    });
  }

  if (compressResults.length === 0) return { messages, prunedTokens: 0, prunedCount: 0 };

  compressResults.sort((a, b) => a.callIndex - b.callIndex);

  const protectedSet = new Set(config.compress.protectedTools);
  const indicesToRemove = new Set<number>();
  const injections: Array<{ atIndex: number; summary: string; topic: string }> = [];
  let prunedTokens = 0;

  for (let i = 0; i < compressResults.length; i++) {
    const cr = compressResults[i];
    // Range start: beginning of session or after previous compress result
    const rangeStart = i === 0 ? 0 : compressResults[i - 1].resultIndex + 1;
    const rangeEnd = cr.callIndex;

    let strippedTokens = 0;
    const nestedSummaries: string[] = [];
    const protectedContent: string[] = [];

    for (let j = rangeStart; j < rangeEnd; j++) {
      if (indicesToRemove.has(j)) continue;
      strippedTokens += estimateTokens(messages[j]);
      indicesToRemove.add(j);

      const m = messages[j];
      // Nest previously compressed summaries
      if ((m as Record<string, unknown>)?.role === "custom" && (m as Record<string, unknown>)?.customType === "dcp-compressed-summary") {
        const content = (m as Record<string, unknown>)?.content;
        if (typeof content === "string" && content.trim()) nestedSummaries.push(content);
      }
      // Preserve protected tool outputs
      if (m.role === "toolResult") {
        const tr = m as ToolResultMessage;
        if (protectedSet.has(tr.toolName) && !tr.isError) {
          let text = "";
          for (const part of tr.content) {
            if (part.type === "text") text += (part as TextContent).text ?? "";
          }
          if (text.trim()) protectedContent.push(`[${tr.toolName}] ${text.trim()}`);
        }
      }
      // Preserve user messages
      if (config.compress.protectUserMessages && m.role === "user") {
        const um = m as UserMessage;
        let text = "";
        if (typeof um.content === "string") text = um.content;
        else if (Array.isArray(um.content)) text = um.content.reduce((s: string, c: TextContent | ImageContent) => s + (c.type === "text" ? c.text : ""), "");
        if (text.trim()) protectedContent.push(`[user] ${text.trim()}`);
      }
    }

    // Remove compress call + result
    indicesToRemove.add(cr.callIndex);
    strippedTokens += estimateTokens(messages[cr.callIndex]);
    indicesToRemove.add(cr.resultIndex);
    strippedTokens += estimateTokens(messages[cr.resultIndex]);

    // Build final summary with nesting and protected content
    let finalSummary = cr.summary;
    if (nestedSummaries.length > 0) {
      finalSummary = nestedSummaries.map((s) => `[Previously compressed]\n${s}`).join("\n\n")
        + `\n\n[Current compression]\n${cr.summary}`;
    }
    if (protectedContent.length > 0) {
      finalSummary += `\n\n## Preserved content\n${protectedContent.join("\n")}`;
    }

    injections.push({ atIndex: rangeStart, summary: finalSummary, topic: cr.topic });
    prunedTokens += strippedTokens;
  }

  // Rebuild message array
  const newMessages: Message[] = [];
  const injectionMap = new Map<number, typeof injections>();
  for (const inj of injections) {
    if (!injectionMap.has(inj.atIndex)) injectionMap.set(inj.atIndex, []);
    injectionMap.get(inj.atIndex)!.push(inj);
  }

  for (let i = 0; i < messages.length; i++) {
    const injects = injectionMap.get(i);
    if (injects) {
      for (const inj of injects) {
        newMessages.push({
          role: "custom",
          customType: "dcp-compressed-summary",
          content: inj.summary,
          display: false,
          timestamp: Date.now(),
        } as DCPCompressedSummaryMessage);
      }
    }
    if (indicesToRemove.has(i)) continue;
    newMessages.push(messages[i]);
  }

  return { messages: newMessages, prunedTokens, prunedCount: indicesToRemove.size };
}

// ── Step 2: Deduplication ───────────────────────────────────────────────

/**
 * Strategy 2: Deduplication.
 *
 * When the same tool is called with the same arguments multiple times,
 * strip the arguments from older calls and replace result content with a short marker.
 */
function applyDedup(
  messages: Message[],
  config: DCPConfig,
): { prunedTokens: number; prunedCount: number } {
  if (!config.dedup.enabled) return { prunedTokens: 0, prunedCount: 0 };

  const ops = extractToolOps(messages);
  const protectedSet = new Set(config.dedup.protectedTools);
  const groups = new Map<string, ToolOp[]>();

  for (const op of ops) {
    if (op.type !== "call" || !op.toolName || protectedSet.has(op.toolName)) continue;
    // Hash the arguments
    const asst = messages[op.messageIndex] as AssistantMessage;
    const tc = asst.content[op.contentIndex] as ToolCall;
    const hash = JSON.stringify(tc.arguments);
    const key = `${op.toolName}:${hash}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(op);
  }

  let prunedTokens = 0;
  let prunedCount = 0;

  for (const calls of groups.values()) {
    if (calls.length <= 1) continue;
    for (let i = 0; i < calls.length - 1; i++) {
      const oldCall = calls[i];
      // Strip call arguments
      const asst = messages[oldCall.messageIndex] as AssistantMessage;
      const tc = asst.content[oldCall.contentIndex] as ToolCall;
      prunedTokens += stripToolArgs(tc, "deduplicated");
      // Strip corresponding result
      for (const op of ops) {
        if (op.type === "result" && op.toolCallId === oldCall.toolCallId) {
          const rm = messages[op.messageIndex] as ToolResultMessage;
          const textPart = rm.content.find((c) => c.type === "text") as TextContent | undefined;
          const snippet = textPart?.text?.slice(0, 100).replace(/\n/g, " ").trim() ?? "";
          rm.content = [{ type: "text", text: `[duplicate: ${oldCall.toolName} — ${snippet}…]` }];
          prunedCount++;
        }
      }
    }
  }

  return { prunedTokens, prunedCount };
}

// ── Step 3: Purge errors ────────────────────────────────────────────────

/**
 * Strategy 3: Purge errors.
 *
 * Strip large input arguments from errored tool calls older than N turns.
 */
function applyPurgeErrors(
  messages: Message[],
  config: DCPConfig,
): { prunedTokens: number; prunedCount: number } {
  if (!config.purgeErrors.enabled) return { prunedTokens: 0, prunedCount: 0 };

  const ops = extractToolOps(messages);
  const erroredIds = new Set(
    ops.filter((o) => o.type === "result" && o.isError).map((o) => o.toolCallId),
  );
  if (erroredIds.size === 0) return { prunedTokens: 0, prunedCount: 0 };

  const protectedSet = new Set(config.purgeErrors.protectedTools);
  let prunedTokens = 0;
  let prunedCount = 0;

  for (const op of ops) {
    if (op.type !== "call" || !erroredIds.has(op.toolCallId)) continue;
    if (protectedSet.has(op.toolName)) continue;

    // Estimate age: use distance from end of messages as proxy
    const relativeAge = messages.length - op.messageIndex;
    const estimatedTurns = Math.max(1, Math.floor(relativeAge / 3));
    if (estimatedTurns < config.purgeErrors.turns) continue;

    const asst = messages[op.messageIndex] as AssistantMessage;
    const tc = asst.content[op.contentIndex] as ToolCall;
    const argsLen = JSON.stringify(tc.arguments).length;
    // Only strip substantial inputs (> ~50 tokens)
    if (argsLen < 200) continue;

    prunedTokens += stripToolArgs(tc, "error-purged");
    prunedCount++;
  }

  return { prunedTokens, prunedCount };
}

// ── Combined context processing ─────────────────────────────────────────

/**
 * Apply all DCP strategies to the messages array.
 * Called from the `context` event handler before every LLM request.
 *
 * Order matters: compress-strip first (changes array indices),
 * then dedup and purge-errors operate on the remaining messages.
 */
export function processContextMessages(
  messages: Message[],
  sessionId: string,
  config: DCPConfig,
): Message[] {
  const state = getState(sessionId);

  // 1. Compress-strip
  const { messages: afterStrip, prunedTokens: stripTokens, prunedCount: stripCount } =
    applyCompressStrip(messages, config);

  // 2. Dedup
  const { prunedTokens: dedupTokens, prunedCount: dedupCount } =
    applyDedup(afterStrip, config);

  // 3. Purge errors
  const { prunedTokens: purgeTokens, prunedCount: purgeCount } =
    applyPurgeErrors(afterStrip, config);

  state.totalStrippedTokens += stripTokens + dedupTokens + purgeTokens;
  state.totalPrunedCount += stripCount + dedupCount + purgeCount;

  return afterStrip;
}

// ---------------------------------------------------------------------------
// Compress tool registration
// ---------------------------------------------------------------------------

const COMPRESS_TOOL_DESCRIPTION = [
  "Collapse a range in the conversation into a detailed summary.",
  "",
  "COMPRESSION MODES",
  '- "range" (default): Select a conversation range by start/end boundaries → replace with summary.',
  '- "message" (experimental): Use when sessions are dense with no clear phase boundaries.',
  "",
  "THE SUMMARY",
  "Your summary must be EXHAUSTIVE. Capture file paths, function signatures, decisions made, constraints discovered, key findings — EVERYTHING that maintains context integrity. This is not a brief note — it is an authoritative record so faithful that the original conversation adds no value.",
  "",
  "Yet be LEAN. Strip away failed attempts, verbose tool outputs, back-and-forth exploration. What remains should be pure signal.",
  "",
  "WHEN TO USE",
  "- Research concluded and findings are clear",
  "- Implementation finished and verified",
  "- Exploration exhausted and patterns understood",
  "- A closed portion unlikely to be referenced immediately",
  "",
  "WHEN NOT TO USE",
  "- You may need exact code, error messages, or file contents in the immediate next steps",
  "- Work in that area is still active or likely to resume immediately",
].join("\n");

export function registerCompressTool(pi: ExtensionAPI, config: DCPConfig): void {
  if (config.compress.permission === "deny") return;

  pi.registerTool({
    name: "compress",
    label: "Compress Context",
    description: COMPRESS_TOOL_DESCRIPTION,
    promptSnippet: "Collapse a conversation range into a dense, exhaustive summary.",
    promptGuidelines: [
      "Compress completed research or implementation phases to free context space.",
      "Before compressing, verify the range is truly closed — never compress work you may need exact details from.",
      "Write exhaustive summaries that capture file paths, function signatures, decisions, and constraints.",
    ],
    parameters: Type.Object({
      topic: Type.String({ description: "Short label (3-5 words) — e.g., 'Auth System Exploration'" }),
      summary: Type.String({ description: "Complete technical summary of the compressed range. Must be exhaustive." }),
      startId: Type.Optional(Type.String({ description: "Start boundary description. Omit in batch mode." })),
      endId: Type.Optional(Type.String({ description: "End boundary description. Omit in batch mode." })),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("range"),
          Type.Literal("message"),
          Type.Literal("batch"),
        ], { description: 'Compression mode: "range" (default), "message" (experimental), or "batch" (auto-detect range).' }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { topic: string; summary: string; startId?: string; endId?: string; mode?: string },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      if (!params.topic?.trim()) throw new Error("topic is required");
      if (!params.summary?.trim()) throw new Error("summary is required");

      const mode = params.mode ?? config.compress.mode;
      const sessionId = ctx.cwd; // Use cwd as session key

      // Resolve start/end labels
      const startLabel = params.startId?.trim()
        ?? (() => {
          const blocks = getBlocks(sessionId);
          const last = blocks[blocks.length - 1];
          return last ? `after "${last.topic}" (b${last.blockId})` : "beginning of session";
        })();
      const endLabel = params.endId?.trim() ?? "current state";

      // Store the compression block
      const block = addBlock(sessionId, params.topic.trim(), params.summary.trim(), startLabel, endLabel);

      // Build response showing prior blocks for iterative reference
      const allBlocks = getBlocks(sessionId);
      const priorBlocks = allBlocks.filter((b) => b.blockId !== block.blockId);
      const stats = getStats(sessionId);

      const lines: string[] = [
        `[Compressed conversation section b${block.blockId}]`,
        `Topic: ${block.topic}`,
        `Mode: ${mode}`,
        `Range: ${startLabel} → ${endLabel}`,
        `Summary tokens: ~${block.summaryTokens}`,
        `Active compressions: ${allBlocks.length}`,
        `Total summary buffer: ~${stats.summaryTokens} tokens`,
        "",
        "The following is the authoritative summary of the compressed range:",
        "",
        params.summary,
      ];

      if (priorBlocks.length > 0) {
        lines.push("", "--- Prior compression summaries (build on these, don't repeat) ---");
        for (const prior of priorBlocks) {
          const truncated = prior.summary.length > 500
            ? prior.summary.slice(0, 500) + "... [truncated]"
            : prior.summary;
          lines.push(`[b${prior.blockId}: ${prior.topic}] (~${prior.summaryTokens} tokens)`);
          lines.push(truncated);
          lines.push("");
        }
        lines.push("Tip: Reference prior block findings by [bN] instead of repeating them.");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { blockId: block.blockId, topic: block.topic, mode, summaryTokens: block.summaryTokens },
      };
    },
  });
}
