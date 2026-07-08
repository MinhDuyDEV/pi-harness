/**
 * OpenAI-compatible SSE stream parser for DeepSeek API
 *
 * Parses the Server-Sent Events stream that DeepSeek returns.
 * DeepSeek's streaming API is OpenAI-compatible with one addition:
 * the `reasoning_content` field in the delta.
 *
 * Standard events:
 *   data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":"Hello"}}]}
 *   data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"reasoning_content":"thinking..."}}]}
 *   data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"...","function":{"name":"...","arguments":"..."}}]}}]}
 *   data: [DONE]
 *
 * Non-standard events DeepSeek may emit:
 *   data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"},"finish_reason":"stop"}]}
 *   data: {"id":"...","object":"chat.completion.chunk","usage": {...}}
 */

import { stripHallucinatedToolMarkup } from "./thinking.js";

export interface DeepSeekStreamDelta {
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
  role?: string;
}

export interface DeepSeekStreamChoice {
  delta: DeepSeekStreamDelta;
  finish_reason?: string | null;
  index?: number;
}

export interface DeepSeekStreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: DeepSeekStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

export interface ParsedToolCall {
  index: number;
  id?: string;
  name: string;
  arguments: string;
  ready: boolean;
}

export interface StreamAccumulator {
  content: string;
  reasoningContent: string;
  toolCalls: Map<number, ParsedToolCall>;
  usage: DeepSeekStreamChunk["usage"] | null;
  finishReason: string | null;
}

export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; arguments?: string }
  | { type: "tool_call_ready"; index: number }
  | { type: "usage"; usage: DeepSeekStreamChunk["usage"] }
  | { type: "done"; finishReason: string | null; hasToolCalls: boolean }
  | { type: "error"; error: string }
  | { type: "finalized_tool" };

/**
 * Parse an SSE text line and emit events.
 */
export function parseSSELine(
  line: string,
  acc: StreamAccumulator,
  emit: (event: StreamEvent) => void,
): void {
  // Skip empty lines and comments
  if (!line || line.startsWith(":")) return;

  // SSE format: "data: <content>"
  if (!line.startsWith("data: ")) return;

  const data = line.slice(6).trim();

  // Stream terminator
  if (data === "[DONE]") {
    const hasToolCalls = acc.toolCalls.size > 0 && [...acc.toolCalls.values()].some(tc => !!tc.name);
    emit({ type: "done", finishReason: acc.finishReason, hasToolCalls });
    return;
  }

  let chunk: DeepSeekStreamChunk;
  try {
    chunk = JSON.parse(data) as DeepSeekStreamChunk;
  } catch {
    // Malformed JSON — skip
    return;
  }

  // Usage info (may appear in non-standard chunks from DeepSeek)
  if (chunk.usage) {
    acc.usage = chunk.usage;
    emit({ type: "usage", usage: chunk.usage });
  }

  const choices = chunk.choices;
  if (!choices || choices.length === 0) return;

  for (const choice of choices) {
    const delta = choice.delta;

    // Finish reason — eagerly finalize: tool calls are considered ready
    // so JSON parse failures fail at the stream boundary, not at halt.
    if (choice.finish_reason) {
      acc.finishReason = choice.finish_reason;
      // Mark all pending tool calls as ready for eager finalization
      for (const [, tc] of acc.toolCalls) {
        if (!tc.ready && tc.name) {
          tc.ready = true;
          emit({ type: "tool_call_ready", index: tc.index });
        }
      }
    }

    // Reasoning content (DeepSeek-specific)
    if (delta.reasoning_content) {
      acc.reasoningContent += delta.reasoning_content;
      emit({ type: "reasoning", content: delta.reasoning_content });
    }

    // Content delta
    if (delta.content) {
      // Strip any hallucinated DSML from the content stream, but NEVER trim
      // streamed deltas. Trimming per-token chunks collapses spaces/newlines
      // and renders output as `Here'sthebreakdown`.
      const cleaned = stripHallucinatedToolMarkup(delta.content, { trim: false });
      if (cleaned) {
        acc.content += cleaned;
        emit({ type: "delta", content: cleaned });
      }
    }

    // Tool call deltas
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const index = tc.index;
        let cur = acc.toolCalls.get(index);

        if (!cur) {
          cur = { index, id: tc.id, name: "", arguments: "", ready: false };
          acc.toolCalls.set(index, cur);
        }

        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;

        emit({
          type: "tool_call_delta",
          index,
          id: cur.id,
          name: cur.name,
          arguments: cur.arguments,
        });
      }
    }
  }
}

/**
 * Read an entire SSE stream from a Response body and accumulate results.
 *
 * Returns the final accumulator with content, reasoning content, tool calls, and usage.
 * Calls `onEvent` for each parsed event during streaming.
 */
export async function readDeepSeekStream(
  response: Response,
  onEvent?: (event: StreamEvent) => void,
): Promise<StreamAccumulator> {
  const acc: StreamAccumulator = {
    content: "",
    reasoningContent: "",
    toolCalls: new Map(),
    usage: null,
    finishReason: null,
  };

  if (!response.body) {
    throw new Error("No response body from DeepSeek API");
  }

  const emit = onEvent ?? (() => {});

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // Keep the last partial line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        parseSSELine(line, acc, emit);
      }
    }

    if (buffer.trim()) {
      parseSSELine(buffer, acc, emit);
    }
  } finally {
    reader.releaseLock();
  }

  // Emit final done if not already emitted
  const hasToolCalls = acc.toolCalls.size > 0 && [...acc.toolCalls.values()].some(tc => !!tc.name);
  emit({ type: "done", finishReason: acc.finishReason, hasToolCalls });

  return acc;
}

/**
 * Finalize tool calls from the accumulator into a clean array.
 * Validates that each tool call has at minimum a name.
 * Sorted by index for deterministic ordering.
 */
export function finalizeToolCalls(
  acc: StreamAccumulator,
): Array<{ id?: string; type: string; function: { name: string; arguments: string } }> {
  const entries = [...acc.toolCalls.entries()]
    .filter(([, tc]) => !!tc.name)
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: tc.arguments || "{}",
      },
    }));

  return entries;
}
