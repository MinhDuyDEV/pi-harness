import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { randomUUID } from "crypto";
import { isGrokCliProxyModel, xaiBaseUrlForModel, xaiModelForRequest, xaiModelRequestHeaders, xaiResponsesUrlForModel } from "./models";
import { rewriteXaiResponsesPayload } from "./payload";

function streamErrorMessage(model: Model<Api>, error: unknown): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

/** POST a JSON body to an xAI endpoint with OAuth bearer auth. */
export async function postXaiJson(
  apiKey: string,
  url: string,
  body: Record<string, any>,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    const error: Error & { status?: number } = new Error(errorText);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/** Create a single xAI Responses API response with model-aware routing. */
export async function createXaiResponse(apiKey: string, body: Record<string, any>, signal?: AbortSignal): Promise<unknown> {
  const model = xaiModelForRequest(typeof body.model === "string" ? body.model : undefined);
  const payload = rewriteXaiResponsesPayload(body, model) as Record<string, any>;
  const usesGrokCliProxy = isGrokCliProxyModel(model.id);
  const grokCliSessionId = usesGrokCliProxy
    ? (typeof body.previous_response_id === "string" && body.previous_response_id) || randomUUID()
    : undefined;
  return postXaiJson(
    apiKey,
    xaiResponsesUrlForModel(model.id),
    payload,
    signal,
    xaiModelRequestHeaders(model.id, grokCliSessionId),
  );
}

/**
 * Stream pi's simple Responses flow through xAI with payload normalization.
 *
 * The transport is delegated to pi's OpenAI Responses helper with a temporary
 * `openai-responses` API tag so Pi 0.81.1 accepts the helper call, while xAI
 * routing headers, request URLs, and payload rewriting continue to use the
 * original xAI model metadata. Returned events are forwarded through an
 * assistant stream exposing async iteration and `result()`. Delegate load or
 * stream failures are converted into terminal error events with xAI provider
 * metadata instead of escaping as unstructured promise failures.
 *
 * @param model xAI provider model selected by pi.
 * @param context Conversation messages and tool context to stream.
 * @param options Simple stream options, including OAuth token, session ID, cancellation, and payload hooks.
 * @returns A forwarding assistant stream compatible with pi's async iterator and `result()` contract.
 */
export function streamSimpleXaiResponses(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
  const grokCliSessionId = options?.sessionId || (isGrokCliProxyModel(model.id) ? randomUUID() : undefined);
  const streamModel = {
    ...model,
    baseUrl: xaiBaseUrlForModel(model.id),
    headers: {
      ...(model as Model<Api> & { headers?: Record<string, string> }).headers,
      ...xaiModelRequestHeaders(model.id, grokCliSessionId),
    },
  };
  // Pi 0.81.1 API-guards the OpenAI Responses helper; keep the xAI
  // stream model for routing/payload rewriting, but delegate with the API
  // tag expected by the helper.
  const openAIResponsesModel = {
    ...streamModel,
    api: "openai-responses" as const,
  };
  const headers = { ...options?.headers };
  if (grokCliSessionId && !headers["x-grok-conv-id"]) headers["x-grok-conv-id"] = grokCliSessionId;

  const stream = createAssistantMessageEventStream();
  void (async () => {
    try {
      const { streamSimple } = await import("@earendil-works/pi-ai/compat");
      const inner = streamSimple(openAIResponsesModel as Model<"openai-responses">, context, {
        ...options,
        headers,
        async onPayload(payload) {
          const rewritten = rewriteXaiResponsesPayload(payload, streamModel, options);
          const userRewritten = await options?.onPayload?.(rewritten, streamModel);
          return userRewritten === undefined ? rewritten : userRewritten;
        },
      });
      for await (const event of inner) {
        stream.push(event);
      }
      stream.end();
    } catch (error) {
      const message = streamErrorMessage(model, error);
      stream.push({ type: "error", reason: "error", error: message });
      stream.end();
    }
  })();
  return stream;
}
