import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Api, Context, Model, SimpleStreamOptions, TextContent, ThinkingContent, ToolCall as PiToolCall } from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { healMessages } from "./repair.js";
import { scavengeToolSpecs } from "./scavenge.js";
import { shrinkOversizedToolCallArgsByTokens, shrinkOversizedToolResultsByTokens } from "./shrink.js";
import { StormBreaker, defaultIsMutating } from "./storm.js";
import { fetchWithRetry } from "./retry.js";
import { readDeepSeekStream } from "./sse.js";
import { stripHallucinatedToolMarkup } from "./thinking.js";
import {
  buildRequestBody,
  buildUsage,
  convertMessages,
  convertTools,
  finalizeDeepSeekToolCalls,
  makeDoneMessage,
  makeErrorMessage,
  sanitizeTextOnlyMessages,
  zeroUsage,
} from "./format.js";
import {
  appendTextDelta,
  appendThinkingDelta,
  appendToolDelta,
  createDeepseekPartialState,
  finalizePartial,
  snapshotPartial,
  type DeepseekPartialState,
} from "./partial.js";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";
const USER_AGENT = "pikit-deepseek/1.0";
const MAX_TOOL_RESULT_TOKENS = 40_000;
const DEFAULT_MAX_TOKENS = 64_000;

function pushStreamError(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  model: Model<Api>,
  message: string,
): void {
  stream.push({ type: "error", reason: "error", error: makeErrorMessage(model, message) });
}

export const deepseekStreamSimple: NonNullable<ProviderConfig["streamSimple"]> = (
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions = {},
) => {
  const stream = createAssistantMessageEventStream();
  const abortSignal = options.signal;
  const stormBreaker = new StormBreaker(6, 3, defaultIsMutating);
  const partialState = createDeepseekPartialState(model);

  stream.push({ type: "start", partial: snapshotPartial(partialState) });

  runStream(stream, model, context, options, abortSignal, stormBreaker, partialState).catch(
    (err) => {
      if (!abortSignal?.aborted) {
        pushStreamError(stream, model, err instanceof Error ? err.message : String(err));
      }
    },
  );

  return stream;
};

async function runStream(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  abortSignal: AbortSignal | undefined,
  stormBreaker: StormBreaker,
  partialState: DeepseekPartialState,
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
      dsMessages,
      model.id,
    );
    // Shrink oversized tool results
    const shrunk = shrinkOversizedToolResultsByTokens(
      healedMessages,
      MAX_TOOL_RESULT_TOKENS,
    );
    // Shrink oversized tool call args
    shrinkOversizedToolCallArgsByTokens(shrunk.messages, DEFAULT_MAX_TOKENS);
    // Scavenge tool schemas
    if (dsToolDefs.length > 0) {
      const { tools: scavenged } = scavengeToolSpecs(dsToolDefs);
      dsToolDefs = scavenged;
    }

    // ── 2. Resolve API Key ──
    const envKey = process.env[DEEPSEEK_API_KEY_ENV];
    // options.apiKey may contain the env var name rather than the resolved value.
    // Always prefer the env var; only use options.apiKey if it looks like a real key.
    const apiKey =
      envKey || (options.apiKey?.includes("_") ? "" : (options.apiKey ?? ""));
    if (!apiKey) {
      pushStreamError(stream, model, "DeepSeek API key not found. Set DEEPSEEK_API_KEY.");
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
      pushStreamError(stream, model, `DeepSeek API error ${response.status}: ${errorBody.slice(0, 500)}`);
      return;
    }

    // ── 4. Stream Parse ──
    let hadText = false;
    let hadThinking = false;
    let hadToolCalls = false;

    const acc = await readDeepSeekStream(response, (sseEvent) => {
      switch (sseEvent.type) {
        case "delta": {
          const update = appendTextDelta(partialState, sseEvent.content);
          if (update.started) stream.push({ type: "text_start", contentIndex: update.contentIndex, partial: update.startPartial! });
          stream.push({ type: "text_delta", contentIndex: update.contentIndex, delta: sseEvent.content, partial: update.partial });
          hadText = true;
          break;
        }
        case "reasoning": {
          const update = appendThinkingDelta(partialState, sseEvent.content);
          if (update.started) stream.push({ type: "thinking_start", contentIndex: update.contentIndex, partial: update.startPartial! });
          stream.push({ type: "thinking_delta", contentIndex: update.contentIndex, delta: sseEvent.content, partial: update.partial });
          hadThinking = true;
          break;
        }
        case "tool_call_delta": {
          const update = appendToolDelta(partialState, sseEvent.index, sseEvent.id, sseEvent.name);
          if (update.started) stream.push({ type: "toolcall_start", contentIndex: update.contentIndex, partial: update.startPartial! });
          stream.push({ type: "toolcall_delta", contentIndex: update.contentIndex, delta: sseEvent.arguments ?? "", partial: update.partial });
          hadToolCalls = true;
          break;
        }
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
      pushStreamError(stream, model, `Tool call finalization errors:\n${toolErrors.join("\n")}`);
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

    const usage = buildUsage(acc, model);

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

    const hasToolUse =
      validToolCalls.length > 0 && suppressedCalls.length < rawToolCalls.length;
    const displayReason: "stop" | "toolUse" = hasToolUse ? "toolUse" : "stop";
    const message = makeDoneMessage(model, contentParts, displayReason, usage);
    const finalPartial = finalizePartial(partialState, message);
    const textIndex = contentParts.findIndex((part) => part.type === "text");
    const thinkingIndex = contentParts.findIndex((part) => part.type === "thinking");

    if (hadText) {
      stream.push({
        type: "text_end",
        contentIndex: textIndex >= 0 ? textIndex : partialState.textIndex ?? 0,
        content: cleanedContent,
        partial: finalPartial,
      });
    }
    if (hadThinking) {
      stream.push({
        type: "thinking_end",
        contentIndex: thinkingIndex >= 0 ? thinkingIndex : partialState.thinkingIndex ?? 0,
        content: acc.reasoningContent,
        partial: finalPartial,
      });
    }
    if (hadToolCalls) {
      for (const tc of validToolCalls) {
        const contentIndex = contentParts.findIndex((part) => part.type === "toolCall" && part.id === tc.id);
        stream.push({
          type: "toolcall_end",
          contentIndex: contentIndex >= 0 ? contentIndex : 0,
          toolCall: {
            type: "toolCall" as const,
            id: tc.id,
            name: tc.name,
            arguments: tc.args as Record<string, unknown>,
          },
          partial: finalPartial,
        });
      }
    }

    stream.push({ type: "done", reason: displayReason, message });
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
      pushStreamError(stream, model, err instanceof Error ? err.message : String(err));
    }
  }
}

