import type {
  Api,
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall as PiToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";
import { repairTruncatedJson, stampMissingIds } from "./repair.js";
import type { ToolSpec } from "./scavenge.js";
import type { StreamAccumulator } from "./sse.js";
import { isThinkingModeModel, thinkingModeForModel } from "./thinking.js";

export interface DsMsg {
  [key: string]: unknown;
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

export type DsToolDef = ToolSpec & { type: "function" };

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

export function sanitizeTextOnlyMessages(messages: DsMsg[]): DsMsg[] {
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

export function convertMessages(
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
      const a = msg as AssistantMessage;
      // Match Pi official openai-completions.js behavior:
      // - Default content to null (not ""), set only when there's actual text
      // - Skip messages with no content AND no tool_calls (DeepSeek rejects those)
      const ds: DsMsg = { role: "assistant", content: null };
      let rc = "";
      const tcs: NonNullable<DsMsg["tool_calls"]> = [];
      let hasText = false;
      const contentParts = a.content ?? [];
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
        const stamped = stampMissingIds(tcs);
        ds.tool_calls = stamped;
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

export function convertTools(tools: Context["tools"]): DsToolDef[] {
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

export function buildRequestBody(
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

interface FinalizedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export function finalizeDeepSeekToolCalls(
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
      const detail = parseErr instanceof Error ? parseErr.message : String(parseErr);
      errors.push(`Tool call "${tc.name}" has malformed JSON arguments: ${detail}`);
    }
  }
  return { calls, errors };
}

export function buildUsage(acc: StreamAccumulator, model: Model<Api>): Usage {
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

export function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function emptyPartial(model: Model<Api>): AssistantMessage {
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

export function makeErrorMessage(model: Model<Api>, text: string): AssistantMessage {
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

export function makeDoneMessage(
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
