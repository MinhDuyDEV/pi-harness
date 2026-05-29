/**
 * DeepSeek Provider Extension for pikit
 *
 * A Pi custom provider that brings all Reasonix learnings:
 * - Thinking mode (reasoning_content) support for V4 Pro/Flash
 * - Cache-friendly message assembly and healing
 * - Tool-call repair pipeline (truncation, pairing, schema sanitization)
 * - DSML hallucination stripping
 * - Storm breaker (repeat-loop detection)
 * - Retry with exponential backoff and body draining
 * - Token-aware message shrinking
 *
 * Uses streamSimple registered via pi.registerProvider() — Pi internally
 * registers this as the handler for the "deepseek" API type.
 *
 * P0-P3 from the Reasonix audit, implemented as one extension.
 *
 * Usage:
 *   1. Place deepseek-provider.ts and deepseek/ directory in .pi/extensions/
 *   2. Set DEEPSEEK_API_KEY in environment
 *   3. Select any deepseek model via `/model` in Pi
 */

import type {
  ExtensionAPI,
  ProviderModelConfig,
  ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCall as PiToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
  StopReason,
  AssistantMessage,
} from "@earendil-works/pi-ai";

import {
  isThinkingModeModel,
  thinkingModeForModel,
  stripHallucinatedToolMarkup,
} from "./deepseek/thinking.js";
import {
  healMessages,
  repairTruncatedJson,
  stampMissingIds,
} from "./deepseek/repair.js";
import { scavengeToolSpecs, type ToolSpec } from "./deepseek/scavenge.js";
import { StormBreaker, defaultIsMutating } from "./deepseek/storm.js";
import {
  shrinkOversizedToolResultsByTokens,
  shrinkOversizedToolCallArgsByTokens,
  type ShrinkResult,
} from "./deepseek/shrink.js";
import { fetchWithRetry } from "./deepseek/retry.js";
import { readDeepSeekStream, type StreamAccumulator } from "./deepseek/sse.js";

// ─── Constants ──────────────────────────────────────────────

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";
const USER_AGENT = "pikit-deepseek/1.0";
const MAX_TOOL_RESULT_TOKENS = 40_000;
const DEFAULT_MAX_TOKENS = 64_000;

// ─── Model Definitions ──────────────────────────────────────

// Official pricing as of 2026-05-26: https://api-docs.deepseek.com/quick_start/pricing
//
// deepseek-v4-flash:
//   Input (cache miss): $0.14/1M tokens
//   Input (cache hit):  $0.0028/1M tokens
//   Output:             $0.28/1M tokens
//   Context: 1M, Max output: 384K
//
// deepseek-v4-pro (current promotional pricing, 75% off until 2026-05-31):
//   Input (cache miss): $0.435/1M tokens  (permanent after promo: 1/4 of $1.74 = $0.435)
//   Input (cache hit):  $0.003625/1M tokens (permanent after promo: 1/4 of $0.0145 = $0.003625)
//   Output:             $0.87/1M tokens   (permanent after promo: 1/4 of $3.48 = $0.87)
//   Context: 1M, Max output: 384K
//
// deepseek-v4-flash-nonthinking is V4 Flash with thinking disabled (~2-3x cheaper output,
// no reasoning trace). deepseek-v4-flash auto-detects thinking mode.

const CTX_1M = 1_048_576;
const MAX_OUT_384K = 393_216;

const PER_TOKEN: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  v4flash: {
    input: 0.14 / 1_000_000,
    output: 0.28 / 1_000_000,
    cacheRead: 0.0028 / 1_000_000,
    cacheWrite: 0.14 / 1_000_000,
  },
  v4pro: {
    input: 0.435 / 1_000_000,
    output: 0.87 / 1_000_000,
    cacheRead: 0.003625 / 1_000_000,
    cacheWrite: 0.435 / 1_000_000,
  },
} as const;

const DEEPSEEK_MODELS: ProviderModelConfig[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max",
    },
    input: ["text"] as const,
    cost: PER_TOKEN.v4flash,
    contextWindow: CTX_1M,
    maxTokens: MAX_OUT_384K,
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek V4 Flash (Non-Thinking)",
    reasoning: false,
    input: ["text"] as const,
    cost: PER_TOKEN.v4flash,
    contextWindow: CTX_1M,
    maxTokens: MAX_OUT_384K,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max",
    },
    input: ["text"] as const,
    cost: PER_TOKEN.v4pro,
    contextWindow: CTX_1M,
    maxTokens: MAX_OUT_384K,
  },
];

// ─── Extension Entry Point ──────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerProvider("deepseek", {
    name: "DeepSeek",
    baseUrl: DEEPSEEK_BASE_URL,
    apiKey: "$DEEPSEEK_API_KEY", // $ prefix tells Pi to resolve from env var DEEPSEEK_API_KEY
    api: "deepseek",
    models: DEEPSEEK_MODELS,
    authHeader: true,
    streamSimple: deepseekStreamSimple,
  });
}

// ─── Stream Handler ─────────────────────────────────────────

const deepseekStreamSimple: NonNullable<ProviderConfig["streamSimple"]> = (
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions = {},
) => {
  const stream = createAssistantMessageEventStream();
  const abortSignal = options.signal;
  const stormBreaker = new StormBreaker(6, 3, defaultIsMutating);

  stream.push({ type: "start", partial: createEmptyPartial(model) });

  // Run async — stream is returned immediately
  runStream(stream, model, context, options, abortSignal, stormBreaker).catch(
    (err) => {
      if (!abortSignal?.aborted) {
        stream.push({
          type: "error",
          reason: "error",
          error: makeErrorMessage(
            model,
            err instanceof Error ? err.message : String(err),
          ),
        });
      }
    },
  );

  return stream;
};

// ─── Async Pipeline ─────────────────────────────────────────

async function runStream(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  abortSignal: AbortSignal | undefined,
  stormBreaker: StormBreaker,
): Promise<void> {
  try {
    // ── 1. Pre-Process Messages ──
    const dsMessages = convertMessages(
      context.messages,
      model.id,
      context.systemPrompt,
    );
    let dsToolDefs = convertTools(context.tools);

    // Heal: fix tool call pairing, stamp reasoning_content
    const { messages: healedMessages } = healMessages(
      dsMessages as unknown as Array<Record<string, unknown>>,
      model.id,
    );
    // Shrink oversized tool results
    const shrunk = shrinkOversizedToolResultsByTokens(
      healedMessages,
      MAX_TOOL_RESULT_TOKENS,
    ) as unknown as ShrinkResult & { messages: DsMsg[] };
    // Shrink oversized tool call args
    shrinkOversizedToolCallArgsByTokens(shrunk.messages, DEFAULT_MAX_TOKENS);
    // Scavenge tool schemas
    if (dsToolDefs.length > 0) {
      const { tools: scavenged } = scavengeToolSpecs(
        dsToolDefs as unknown as ToolSpec[],
      );
      dsToolDefs = scavenged as unknown as DsToolDef[];
    }

    // ── 2. Resolve API Key ──
    const envKey = process.env[DEEPSEEK_API_KEY_ENV];
    // options.apiKey may contain the env var name rather than the resolved value.
    // Always prefer the env var; only use options.apiKey if it looks like a real key.
    const apiKey =
      envKey || (options.apiKey?.includes("_") ? "" : (options.apiKey ?? ""));
    if (!apiKey) {
      stream.push({
        type: "error",
        reason: "error",
        error: makeErrorMessage(
          model,
          "DeepSeek API key not found. Set DEEPSEEK_API_KEY.",
        ),
      });
      return;
    }

    // ── 3. Build & Send Request ──
    const body = buildRequestBody(
      model,
      sanitizeTextOnlyMessages(shrunk.messages),
      dsToolDefs,
      options,
    );
    const baseUrl = model.baseUrl || DEEPSEEK_BASE_URL;

    const response = await fetchWithRetry(
      fetch,
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": USER_AGENT,
          Accept: "text/event-stream",
          ...model.headers,
          ...options.headers,
        },
        body: JSON.stringify(body),
        signal: abortSignal,
      },
      { signal: abortSignal, maxAttempts: 3 },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown");
      stream.push({
        type: "error",
        reason: "error",
        error: makeErrorMessage(
          model,
          `DeepSeek API error ${response.status}: ${errorBody.slice(0, 500)}`,
        ),
      });
      return;
    }

    // ── 4. Stream Parse ──
    let hadText = false;
    let hadThinking = false;
    let hadToolCalls = false;

    const acc = await readDeepSeekStream(response, (sseEvent) => {
      switch (sseEvent.type) {
        case "delta":
          if (!hadText) {
            hadText = true;
            stream.push({
              type: "text_start",
              contentIndex: 0,
              partial: emptyPartial(model),
            });
          }
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: sseEvent.content,
            partial: emptyPartial(model),
          });
          break;
        case "reasoning":
          if (!hadThinking) {
            hadThinking = true;
            stream.push({
              type: "thinking_start",
              contentIndex: 0,
              partial: emptyPartial(model),
            });
          }
          stream.push({
            type: "thinking_delta",
            contentIndex: 0,
            delta: sseEvent.content,
            partial: emptyPartial(model),
          });
          break;
        case "tool_call_delta":
          // Tool calls are accumulated in sse.ts and finalized eagerly
          // when finish_reason arrives (see sse.ts eager finalization).
          if (!hadToolCalls) {
            hadToolCalls = true;
            stream.push({
              type: "toolcall_start",
              contentIndex: 0,
              partial: emptyPartial(model),
            });
          }
          stream.push({
            type: "toolcall_delta",
            contentIndex: 0,
            delta: sseEvent.arguments ?? "",
            partial: emptyPartial(model),
          });
          break;
        case "done":
          // done is handled below, but we track hasToolCalls for
          // finish reason mapping
          break;
      }
    });

    // ── 5. Post-Process ──
    const cleanedContent = stripHallucinatedToolMarkup(acc.content);
    const { calls: rawToolCalls, errors: toolErrors } = finalizeDeepSeekToolCalls(acc);
    const suppressedCalls: string[] = [];

    // Propagate tool call errors — OpenCode strict pattern
    if (toolErrors.length > 0) {
      stream.push({
        type: "error",
        reason: "error",
        error: makeErrorMessage(
          model,
          `Tool call finalization errors:\n${toolErrors.join("\n")}`,
        ),
      });
      return;
    }

    // Storm breaker
    for (const call of rawToolCalls) {
      const result = stormBreaker.inspect({
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      });
      if (result.suppress) suppressedCalls.push(call.name);
    }

    // Filter suppressed
    const validToolCalls = rawToolCalls.filter(
      (_, i) => !suppressedCalls.includes(rawToolCalls[i]!.name),
    );

    // Build usage
    const usage = buildUsage(acc, model);

    // Build content parts
    const contentParts: (TextContent | ThinkingContent | PiToolCall)[] = [];
    if (acc.reasoningContent)
      contentParts.push({ type: "thinking", thinking: acc.reasoningContent });
    if (cleanedContent)
      contentParts.push({ type: "text", text: cleanedContent });
    for (const tc of validToolCalls) {
      contentParts.push({
        type: "toolCall",
        id: tc.id,
        name: tc.name,
        arguments: tc.args as Record<string, unknown>,
      });
    }

    // If all suppressed, add warning text
    if (
      suppressedCalls.length > 0 &&
      suppressedCalls.length === rawToolCalls.length
    ) {
      contentParts.push({
        type: "text",
        text: `[Storm breaker suppressed ${suppressedCalls.length} repeated tool call(s): ${[...new Set(suppressedCalls)].join(", ")}. The model appears to be in a loop.]`,
      });
    }

    // ── 6. Emit End Events ──
    if (hadText)
      stream.push({
        type: "text_end",
        contentIndex: 0,
        content: cleanedContent,
        partial: emptyPartial(model),
      });
    if (hadThinking)
      stream.push({
        type: "thinking_end",
        contentIndex: 0,
        content: acc.reasoningContent,
        partial: emptyPartial(model),
      });
    if (hadToolCalls) {
      for (const tc of validToolCalls) {
        stream.push({
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: {
            type: "toolCall" as const,
            id: tc.id,
            name: tc.name,
            arguments: tc.args as Record<string, unknown>,
          },
          partial: emptyPartial(model),
        });
      }
    }

    // ── 7. Emit Done ──
    const hasToolUse =
      validToolCalls.length > 0 && suppressedCalls.length < rawToolCalls.length;
    // Map finish reason: if tool calls are present and finish_reason is "stop",
    // remap to "tool-calls" — this is the OpenCode pattern.
    const displayReason: "stop" | "toolUse" =
      hasToolUse ? "toolUse" : "stop";
    stream.push({
      type: "done",
      reason: displayReason,
      message: makeDoneMessage(
        model,
        contentParts,
        displayReason,
        usage,
      ),
    });
  } catch (err: unknown) {
    if (
      abortSignal?.aborted ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      stream.push({
        type: "done",
        reason: "stop",
        message: makeDoneMessage(model, [], "aborted", zeroUsage()),
      });
    } else {
      stream.push({
        type: "error",
        reason: "error",
        error: makeErrorMessage(
          model,
          err instanceof Error ? err.message : String(err),
        ),
      });
    }
  }
}

// ─── Message Conversion ─────────────────────────────────────

interface DsMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  reasoning_content?: string | null;
}

interface DsToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface PiContentPart {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

function textOnlyContent(content: Array<TextContent | ImageContent>): string {
  const text = content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const imageCount = content.filter(
    (part): part is ImageContent => part.type === "image",
  ).length;

  if (imageCount === 0) return text;
  return `${text}${text ? "\n\n" : ""}[${imageCount} image attachment(s) omitted: DeepSeek API is text-only.]`;
}

function sanitizeTextOnlyMessages(messages: DsMsg[]): DsMsg[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;

    const text = message.content
      .map((part) => {
        if (part?.type === "text" && typeof part.text === "string") {
          return part.text;
        }
        if (part?.type === "image_url") {
          return "[image omitted: DeepSeek API is text-only]";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");

    return { ...message, content: text };
  });
}

function convertMessages(
  msgs: Message[],
  model: string,
  systemPrompt?: string,
): DsMsg[] {
  const out: DsMsg[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const msg of msgs) {
    if (msg.role === "user") {
      const u = msg as UserMessage;
      if (typeof u.content === "string")
        out.push({ role: "user", content: u.content });
      else {
        const content = u.content as Array<TextContent | ImageContent>;
        out.push({ role: "user", content: textOnlyContent(content) });
      }
    } else if (msg.role === "assistant") {
      const a = msg as unknown as Record<string, unknown>;
      // Match Pi official openai-completions.js behavior:
      // - Default content to null (not ""), set only when there's actual text
      // - Skip messages with no content AND no tool_calls (DeepSeek rejects those)
      const ds: DsMsg = { role: "assistant", content: null };
      let rc = "";
      const tcs: NonNullable<DsMsg["tool_calls"]> = [];
      let hasText = false;
      const contentParts = (a.content as PiContentPart[] | undefined) ?? [];
      for (const part of contentParts) {
        if (part.type === "text") {
          const text = part.text ?? "";
          if (text) {
            ds.content = (ds.content ?? "") + text;
            hasText = true;
          }
        } else if (part.type === "thinking") rc += part.thinking ?? "";
        else if (part.type === "toolCall") {
          tcs.push({
            id: part.id,
            type: "function",
            function: {
              name: part.name!,
              arguments: JSON.stringify(part.arguments ?? {}),
            },
          });
        }
      }
      // Only set content to accumulated text if we found text parts
      if (!hasText) ds.content = null;
      if (rc || isThinkingModeModel(model)) ds.reasoning_content = rc || "";
      if (tcs.length > 0) {
        const stamped = stampMissingIds(
          tcs as Array<{ id?: string; [key: string]: unknown }>,
        );
        ds.tool_calls = stamped as unknown as NonNullable<DsMsg["tool_calls"]>;
      }

      // Skip messages that have no content and no tool calls.
      // DeepSeek requires at least one of them. This matches Pi's official
      // openai-completions.js behavior (line ~728): continue on empty.
      const content = ds.content;
      const hasContent =
        content !== null && content !== undefined && content.length > 0;
      if (!hasContent && (!ds.tool_calls || ds.tool_calls.length === 0)) {
        continue;
      }
      out.push(ds);
    } else if (msg.role === "toolResult") {
      const t = msg as ToolResultMessage;
      const content = t.content as Array<TextContent | ImageContent>;
      const text = textOnlyContent(content);
      const imageCount = content.filter(
        (part): part is ImageContent => part.type === "image",
      ).length;
      out.push({
        role: "tool",
        tool_call_id: t.toolCallId,
        content:
          imageCount > 0
            ? `${text}${text ? "\n\n" : ""}[${imageCount} image attachment(s) omitted: DeepSeek API is text-only.]`
            : text,
      });
    }
  }
  return out;
}

function convertTools(tools: Context["tools"]): DsToolDef[] {
  if (!tools) return [];
  return tools.map(
    (t: { name: string; description: string; parameters: unknown }) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: (t.parameters ?? {}) as Record<string, unknown>,
      },
    }),
  );
}

// ─── Request Builder ────────────────────────────────────────

function buildRequestBody(
  model: Model<Api>,
  messages: DsMsg[],
  tools: DsToolDef[],
  opts: SimpleStreamOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.id,
    messages,
    stream: true,
  };
  if (tools.length > 0) body.tools = tools;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  const thinking = thinkingModeForModel(model.id);
  if (thinking) {
    body.extra_body = { thinking: { type: thinking } };
  }

  // Map thinking level to DeepSeek reasoning_effort ("high" | "max")
  if (opts.reasoning && model.thinkingLevelMap) {
    const effort = model.thinkingLevelMap[opts.reasoning];
    if (effort) {
      body.reasoning_effort = effort;
    }
  }

  return body;
}

// ─── Tool Call Finalization ─────────────────────────────────
// Follows OpenCode's strict approach: missing id/name or malformed JSON
// is propagated as an error, not silently swallowed.
// See opencode-ai/opencode packages/llm/src/protocols/utils/tool-stream.ts

interface FinalizedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

function finalizeDeepSeekToolCalls(
  acc: StreamAccumulator,
): { calls: FinalizedToolCall[]; errors: string[] } {
  const calls: FinalizedToolCall[] = [];
  const errors: string[] = [];
  for (const [, tc] of acc.toolCalls) {
    // Strict: missing name → error (OpenCode pattern)
    if (!tc.name) {
      errors.push(`Tool call at index ${tc.index} missing name field`);
      continue;
    }
    // Strict: missing id → error (OpenCode pattern)
    if (!tc.id) {
      errors.push(`Tool call "${tc.name}" missing id field`);
      continue;
    }
    try {
      const args = JSON.parse(
        repairTruncatedJson(tc.arguments || "{}").repaired,
      ) as Record<string, unknown>;
      calls.push({ id: tc.id, name: tc.name, args });
    } catch (parseErr) {
      // Propagate parse error instead of falling back to {}
      errors.push(
        `Tool call "${tc.name}" has malformed JSON arguments: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
    }
  }
  return { calls, errors };
}

// ─── Usage ──────────────────────────────────────────────────

function buildUsage(acc: StreamAccumulator, model: Model<Api>): Usage {
  if (acc.usage) {
    const i = acc.usage.prompt_tokens ?? 0;
    const o = acc.usage.completion_tokens ?? 0;
    const cr = acc.usage.prompt_cache_hit_tokens ?? 0;
    const cw = acc.usage.prompt_cache_miss_tokens ?? 0;
    const t = acc.usage.total_tokens ?? i + o;
    return {
      input: i,
      output: o,
      cacheRead: cr,
      cacheWrite: cw,
      totalTokens: t,
      cost: {
        input: i * model.cost.input,
        output: o * model.cost.output,
        cacheRead: cr * (model.cost.cacheRead ?? 0),
        cacheWrite: cw * (model.cost.cacheWrite ?? 0),
        total: 0,
      },
    };
  }
  return zeroUsage();
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

// ─── Helpers ────────────────────────────────────────────────

function emptyPartial(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createEmptyPartial(model: Model<Api>) {
  return emptyPartial(model);
}

function makeErrorMessage(model: Model<Api>, text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: "error",
    timestamp: Date.now(),
  };
}

function makeDoneMessage(
  model: Model<Api>,
  contentParts: (TextContent | ThinkingContent | PiToolCall)[],
  reason: Extract<StopReason, "stop" | "length" | "toolUse" | "aborted">,
  usage: Usage,
): AssistantMessage {
  return {
    role: "assistant",
    content: contentParts,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: reason,
    timestamp: Date.now(),
  };
}
