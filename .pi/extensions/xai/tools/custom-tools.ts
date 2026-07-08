import { Type, type Static } from "@earendil-works/pi-ai";
import { DEFAULT_XAI_MODEL } from "../constants";
import { normalizeXaiImageInput } from "../images";
import { grokSupportsReasoningEffort } from "../models";
import { createXaiResponse } from "../responses";
import { extractResponsesText, messageFromError, statusFromError } from "../text";
import { requireXaiAuthToken, xaiTextInput, xaiToolError } from "./common";
import { defineXaiTool } from "./define-tool";

/** Minimal shape of an xAI Responses API response we actually use. */
interface XaiResponsesData {
  id?: string;
  output_text?: string;
  output?: ReadonlyArray<{ content?: ReadonlyArray<{ text?: string }> }>;
  reasoning?: { content?: ReadonlyArray<{ text?: string }> };
}

/** Reasoning effort values supported by Grok's Responses API. */
type ReasoningEffort = "none" | "low" | "medium" | "high";

/**
 * The runtime tool shape accepted by pi's `pi.registerTool`. We type the
 * `execute` parameter with `unknown` to avoid a TypeScript module-resolution
 * clash with pi-coding-agent's internal `AgentToolUpdateCallback` type
 * (resolved through a nested `pi-agent-core` path that TypeScript treats
 * as a different module than our import). The actual params shape is
 * encoded in the `parameters` (TypeBox) schema and the call site uses
 * `unknown` casts inside `execute` — runtime is unchanged from the
 * upstream pi-xai-oauth.
 */

const xaiGenerateTextParams = Type.Object({
  prompt: Type.String({ description: "The prompt or question" }),
  model: Type.Optional(Type.String({ description: `Model to use (default: ${DEFAULT_XAI_MODEL})` })),
  reasoning_effort: Type.Optional(
    Type.Union([Type.Literal("none"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
  ),
  response_format: Type.Optional(Type.String({ description: "Set to 'json' for JSON output" })),
  previous_response_id: Type.Optional(Type.String({ description: "Continue conversation" })),
  image_url: Type.Optional(
    Type.String({ description: "Optional image URL for vision/multimodal input (supports image analysis)" }),
  ),
});
type XaiGenerateTextParams = Static<typeof xaiGenerateTextParams>;

export const xaiGenerateTextTool = defineXaiTool({
  name: "xai_generate_text",
  label: "xAI Generate Text",
  description: "Generate text using Grok with full reasoning, structured output, and stateful conversations.",
  parameters: xaiGenerateTextParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiGenerateTextParams;
    const apiKeyOrError = await requireXaiAuthToken(ctx, { reasoning: "", response_id: "", });
    if (typeof apiKeyOrError !== "string") {
      return apiKeyOrError;
    }
    const apiKey = apiKeyOrError;

    const model = p.model ?? DEFAULT_XAI_MODEL;
    const imageUrl = p.image_url ? normalizeXaiImageInput(p.image_url) : undefined;
    const input: unknown = imageUrl
      ? [
          {
            role: "user",
            content: [
              { type: "input_text", text: p.prompt || "Describe this image." },
              { type: "input_image", image_url: imageUrl, detail: "high" },
            ],
          },
        ]
      : p.prompt;

    const body: Record<string, unknown> = { model, input };
    const effort: ReasoningEffort = (p.reasoning_effort ?? "medium") as ReasoningEffort;
    if (grokSupportsReasoningEffort(model) && effort !== "none") {
      body.reasoning = { effort };
    }
    if (p.response_format === "json") {
      body.text = { format: { type: "json_object" } };
    }
    if (p.previous_response_id) {
      body.previous_response_id = p.previous_response_id;
    }

    let data: XaiResponsesData;
    try {
      data = (await createXaiResponse(apiKey, body)) as XaiResponsesData;
    } catch (error) {
      const status = statusFromError(error);
      return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
        error: true,
        status,
        reasoning: "",
        response_id: "",
      });
    }

    const text = extractResponsesText(data);
    return {
      content: [{ type: "text", text }],
      details: {
        reasoning: data.reasoning?.content?.[0]?.text ?? "",
        response_id: data.id,
      },
    };
  },
});

const xaiMultiAgentParams = Type.Object({
  query: Type.String({ description: "Research topic" }),
  num_agents: Type.Optional(Type.Union([Type.Literal(4), Type.Literal(16)])),
  reasoning_effort: Type.Optional(
    Type.String({
      description: "Override num_agents: medium uses 4 agents, high uses 16 agents",
    }),
  ),
});
type XaiMultiAgentParams = Static<typeof xaiMultiAgentParams>;

export const xaiMultiAgentTool = defineXaiTool({
  name: "xai_multi_agent",
  label: "xAI Multi-Agent Research",
  description: "Run deep multi-agent research using Grok.",
  parameters: xaiMultiAgentParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiMultiAgentParams;
    const apiKeyOrError = await requireXaiAuthToken(ctx, { agents_used: 0, response_id: "", });
    if (typeof apiKeyOrError !== "string") {
      return apiKeyOrError;
    }
    const apiKey = apiKeyOrError;

    const requestedAgents: 4 | 16 = p.num_agents === 16 ? 16 : 4;
    const effort: "medium" | "high" =
      (p.reasoning_effort as "medium" | "high" | undefined) ?? (requestedAgents === 16 ? "high" : "medium");
    const agentsUsed: 4 | 16 = effort === "high" ? 16 : 4;
    const prompt = `You are leading a team of ${agentsUsed} researchers. Research: ${p.query}`;

    let data: XaiResponsesData;
    try {
      data = (await createXaiResponse(apiKey, {
        model: "grok-4.20-multi-agent-0309",
        input: xaiTextInput(prompt),
        reasoning: { effort },
        tools: [{ type: "web_search" }, { type: "x_search" }],
      })) as XaiResponsesData;
    } catch (error) {
      const status = statusFromError(error);
      return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
        error: true,
        status,
        agents_used: 0,
        response_id: "",
      });
    }

    const text = extractResponsesText(data) || "Research completed";
    return {
      content: [{ type: "text", text }],
      details: { agents_used: agentsUsed, response_id: data.id },
    };
  },
});

const xaiWebSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
});

export const xaiWebSearchTool = defineXaiTool({
  name: "xai_web_search",
  label: "xAI Web Search",
  description: "Search the web using Grok's native web knowledge and search capabilities.",
  parameters: xaiWebSearchParams,
  execute: async ({ params, ctx }) => {
    const p = params as { query: string };
    const apiKeyOrError = await requireXaiAuthToken(ctx, { query: p.query, });
    if (typeof apiKeyOrError !== "string") {
      return apiKeyOrError;
    }
    const apiKey = apiKeyOrError;
    const prompt = `Search the web for: ${p.query}. Summarize the top results with sources, key facts, dates, and recent developments. Prioritize authoritative sources.`;

    let data: XaiResponsesData;
    try {
      data = (await createXaiResponse(apiKey, {
        model: DEFAULT_XAI_MODEL,
        input: xaiTextInput(prompt),
        reasoning: { effort: "medium" },
        tools: [{ type: "web_search", enable_image_understanding: true }],
      })) as XaiResponsesData;
    } catch (error) {
      const status = statusFromError(error);
      return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
        error: true,
        status,
        query: p.query,
      });
    }

    const text = extractResponsesText(data) || `No results for: ${p.query}`;
    return { content: [{ type: "text", text }], details: { query: p.query } };
  },
});

const xaiXSearchParams = Type.Object({
  query: Type.String({ description: "X search query" }),
  count: Type.Optional(Type.Number({ description: "Max number of posts to return (1-10)", default: 5 })),
  since: Type.Optional(Type.String({ description: "Only posts after this date (YYYY-MM-DD)" })),
  until: Type.Optional(Type.String({ description: "Only posts before this date (YYYY-MM-DD)" })),
});

export const xaiXSearchTool = defineXaiTool({
  name: "xai_x_search",
  label: "xAI X Search",
  description:
    "Search X (Twitter) using Grok's native real-time X search and knowledge. Supports advanced filters like count, since, until.",
  parameters: xaiXSearchParams,
  execute: async ({ params, ctx }) => {
    const p = params as { query: string; count?: number; since?: string; until?: string };
    const apiKeyOrError = await requireXaiAuthToken(ctx, { query: p.query, });
    if (typeof apiKeyOrError !== "string") {
      return apiKeyOrError;
    }
    const apiKey = apiKeyOrError;
    let prompt = `You have native real-time access to X (Twitter) posts and trends via Grok's built-in X search. Use it to find the most relevant recent posts about: ${p.query}.

Filters:`;
    if (p.count) prompt += ` Return up to ${p.count} posts.`;
    if (p.since) prompt += ` Only posts since ${p.since}.`;
    if (p.until) prompt += ` Only posts until ${p.until}.`;
    prompt += `

Summarize:
- Top posts with usernames, engagement (likes/reposts/views), and timestamps
- Key quotes or main points from influential tweets
- Overall sentiment and any emerging trends or threads
- Notable users or conversations

Be specific and cite examples where helpful.`;

    const xSearchTool: Record<string, unknown> = { type: "x_search", enable_image_understanding: true };
    if (p.since) xSearchTool.from_date = p.since;
    if (p.until) xSearchTool.to_date = p.until;

    let data: XaiResponsesData;
    try {
      data = (await createXaiResponse(apiKey, {
        model: DEFAULT_XAI_MODEL,
        input: xaiTextInput(prompt),
        reasoning: { effort: "medium" },
        tools: [xSearchTool],
      })) as XaiResponsesData;
    } catch (error) {
      const status = statusFromError(error);
      return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
        error: true,
        status,
        query: p.query,
      });
    }

    const text = extractResponsesText(data) || `No X results for: ${p.query}`;
    return { content: [{ type: "text", text }], details: { query: p.query } };
  },
});

const xaiCodeExecutionParams = Type.Object({
  code: Type.String({ description: "Python code to execute or analyze" }),
});

export const xaiCodeExecutionTool = defineXaiTool({
  name: "xai_code_execution",
  label: "xAI Code Execution",
  description: "Execute or analyze Python code using xAI's native code interpreter tool.",
  parameters: xaiCodeExecutionParams,
  execute: async ({ params, ctx }) => {
    const p = params as { code: string };
    const apiKeyOrError = await requireXaiAuthToken(ctx, { code: p.code, });
    if (typeof apiKeyOrError !== "string") {
      return apiKeyOrError;
    }
    const apiKey = apiKeyOrError;
    const prompt = `Execute this Python code and show the result or output:\n\n${p.code}`;

    let data: XaiResponsesData;
    try {
      data = (await createXaiResponse(apiKey, {
        model: DEFAULT_XAI_MODEL,
        input: xaiTextInput(prompt),
        reasoning: { effort: "low" },
        tools: [{ type: "code_interpreter" }],
      })) as XaiResponsesData;
    } catch (error) {
      const status = statusFromError(error);
      return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
        error: true,
        status,
        code: p.code,
      });
    }

    const text = extractResponsesText(data) || `Executed: ${String(p.code).substring(0, 100)}...`;
    return { content: [{ type: "text", text }], details: { code: p.code } };
  },
});

const xaiCritiqueParams = Type.Object({
  content: Type.String({ description: "The code, text, design, or idea to critique" }),
  aspect: Type.Optional(
    Type.String({ description: "Focus area: code, design, writing, logic, security, performance, etc." }),
  ),
  tone: Type.Optional(
    Type.Union([Type.Literal("constructive"), Type.Literal("strict"), Type.Literal("balanced")]),
  ),
});
type XaiCritiqueParams = Static<typeof xaiCritiqueParams>;

export const xaiCritiqueTool = defineXaiTool({
  name: "xai_critique",
  label: "xAI Critique",
  description: "Provide detailed, reasoned critique of code, designs, writing, ideas, or arguments with structured feedback.",
  parameters: xaiCritiqueParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiCritiqueParams;
    const apiKeyOrError = await requireXaiAuthToken(ctx, { content: p.content, });
    if (typeof apiKeyOrError !== "string") {
      return apiKeyOrError;
    }
    const apiKey = apiKeyOrError;
    const aspect = p.aspect ?? "overall quality and correctness";
    const tone = p.tone ?? "constructive";
    const prompt = `Provide a ${tone} critique focused on ${aspect}.\n\nContent to critique:\n${p.content}\n\nStructure your response with:\n- Strengths\n- Weaknesses / Issues\n- Specific suggestions for improvement\n- Overall assessment (score 1-10)\nUse step-by-step reasoning.`;

    let data: XaiResponsesData;
    try {
      data = (await createXaiResponse(apiKey, {
        model: DEFAULT_XAI_MODEL,
        input: xaiTextInput(prompt),
        reasoning: { effort: "high" },
      })) as XaiResponsesData;
    } catch (error) {
      const status = statusFromError(error);
      return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
        error: true,
        status,
      });
    }

    const text = extractResponsesText(data) || "Critique completed.";
    return { content: [{ type: "text", text }], details: { aspect, tone } };
  },
});
