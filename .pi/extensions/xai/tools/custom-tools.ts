import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";
import { resolveXaiAuthToken } from "../auth";
import { DEFAULT_XAI_IMAGE_MODEL, DEFAULT_XAI_MODEL, XAI_IMAGES_GENERATIONS_URL } from "../constants";
import { normalizeXaiImageInput } from "../images";
import { grokSupportsReasoningEffort } from "../models";
import { createXaiResponse, postXaiJson } from "../responses";
import { extractResponsesText, messageFromError, statusFromError } from "../text";
import { xaiTextInput, xaiToolError } from "./common";

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
type XaiToolExecute = (input: {
  toolCallId: string;
  params: unknown;
  signal: AbortSignal | undefined;
  onUpdate: unknown;
  ctx: unknown;
}) => Promise<unknown>;

interface XaiToolDef {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute: XaiToolExecute;
}

/** Build a typed tool definition. The runtime object is cast to `any` so
 *  pi's `registerTool` accepts it without a module-resolution error. */
function defineXaiTool<S extends TSchema>(def: {
  name: string;
  label: string;
  description: string;
  parameters: S;
  execute: (input: { toolCallId: string; params: Static<S>; signal: AbortSignal | undefined; onUpdate: unknown; ctx: unknown }) => Promise<unknown>;
}): XaiToolDef {
  return def as unknown as XaiToolDef;
}

// ──────────────────────────────────────────────────────────────────────
// Tool 1: xai_generate_text
// ──────────────────────────────────────────────────────────────────────

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

const xaiGenerateTextTool = defineXaiTool({
  name: "xai_generate_text",
  label: "xAI Generate Text",
  description: "Generate text using Grok with full reasoning, structured output, and stateful conversations.",
  parameters: xaiGenerateTextParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiGenerateTextParams;
    const apiKey = await resolveXaiAuthToken(ctx);
    if (!apiKey) {
      return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", {
        reasoning: "",
        response_id: "",
      });
    }

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

// ──────────────────────────────────────────────────────────────────────
// Tool 2: xai_multi_agent
// ──────────────────────────────────────────────────────────────────────

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

const xaiMultiAgentTool = defineXaiTool({
  name: "xai_multi_agent",
  label: "xAI Multi-Agent Research",
  description: "Run deep multi-agent research using Grok.",
  parameters: xaiMultiAgentParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiMultiAgentParams;
    const apiKey = await resolveXaiAuthToken(ctx);
    if (!apiKey) {
      return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", {
        agents_used: 0,
        response_id: "",
      });
    }

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

// ──────────────────────────────────────────────────────────────────────
// Tool 3: xai_web_search
// ──────────────────────────────────────────────────────────────────────

const xaiWebSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
});

const xaiWebSearchTool = defineXaiTool({
  name: "xai_web_search",
  label: "xAI Web Search",
  description: "Search the web using Grok's native web knowledge and search capabilities.",
  parameters: xaiWebSearchParams,
  execute: async ({ params, ctx }) => {
    const p = params as { query: string };
    const apiKey = await resolveXaiAuthToken(ctx);
    if (!apiKey) {
      return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", {
        query: p.query,
      });
    }
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

// ──────────────────────────────────────────────────────────────────────
// Tool 4: xai_x_search
// ──────────────────────────────────────────────────────────────────────

const xaiXSearchParams = Type.Object({
  query: Type.String({ description: "X search query" }),
  count: Type.Optional(Type.Number({ description: "Max number of posts to return (1-10)", default: 5 })),
  since: Type.Optional(Type.String({ description: "Only posts after this date (YYYY-MM-DD)" })),
  until: Type.Optional(Type.String({ description: "Only posts before this date (YYYY-MM-DD)" })),
});

const xaiXSearchTool = defineXaiTool({
  name: "xai_x_search",
  label: "xAI X Search",
  description:
    "Search X (Twitter) using Grok's native real-time X search and knowledge. Supports advanced filters like count, since, until.",
  parameters: xaiXSearchParams,
  execute: async ({ params, ctx }) => {
    const p = params as { query: string; count?: number; since?: string; until?: string };
    const apiKey = await resolveXaiAuthToken(ctx);
    if (!apiKey) {
      return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", {
        query: p.query,
      });
    }
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

// ──────────────────────────────────────────────────────────────────────
// Tool 5: xai_code_execution
// ──────────────────────────────────────────────────────────────────────

const xaiCodeExecutionParams = Type.Object({
  code: Type.String({ description: "Python code to execute or analyze" }),
});

const xaiCodeExecutionTool = defineXaiTool({
  name: "xai_code_execution",
  label: "xAI Code Execution",
  description: "Execute or analyze Python code using xAI's native code interpreter tool.",
  parameters: xaiCodeExecutionParams,
  execute: async ({ params, ctx }) => {
    const p = params as { code: string };
    const apiKey = await resolveXaiAuthToken(ctx);
    if (!apiKey) {
      return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", {
        code: p.code,
      });
    }
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

// ──────────────────────────────────────────────────────────────────────
// Tool 6: xai_generate_image
// ──────────────────────────────────────────────────────────────────────

const xaiGenerateImageParams = Type.Object({
  prompt: Type.String({ description: "Detailed description of the image to generate" }),
  model: Type.Optional(
    Type.String({ description: `Image model to use (default: ${DEFAULT_XAI_IMAGE_MODEL})` }),
  ),
  size: Type.Optional(Type.String({ description: "Image size (e.g. 1024x1024, 1792x1024)", default: "1024x1024" })),
  n: Type.Optional(Type.Number({ description: "Number of images to generate (1-4)", default: 1 })),
});

const xaiGenerateImageTool = defineXaiTool({
  name: "xai_generate_image",
  label: "xAI Image Generation",
  description: "Generate images using xAI's current image generation model.",
  parameters: xaiGenerateImageParams,
  execute: async ({ params, ctx }) => {
    const p = params as {
      prompt: string;
      model?: string;
      size?: string;
      n?: number;
    };
    const apiKey = await resolveXaiAuthToken(ctx);
    if (!apiKey) {
      return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", {
        prompt: p.prompt,
      });
    }
    interface ImageApiResponse {
      data?: ReadonlyArray<{ url?: string }>;
    }
    let data: ImageApiResponse;
    try {
      data = (await postXaiJson(apiKey, XAI_IMAGES_GENERATIONS_URL, {
        model: p.model ?? DEFAULT_XAI_IMAGE_MODEL,
        prompt: p.prompt,
        n: p.n ?? 1,
        size: p.size ?? "1024x1024",
      })) as ImageApiResponse;
    } catch (error) {
      const status = statusFromError(error);
      return xaiToolError(`xAI Image API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
        error: true,
        status,
        prompt: p.prompt,
      });
    }
    const images = data.data ?? [];
    const urls = images.map((img) => img.url).filter((u): u is string => Boolean(u));
    const text =
      urls.length > 0
        ? `Generated ${urls.length} image(s):\n${urls.map((u) => `- ${u}`).join("\n")}`
        : "Image generation completed but no URLs returned.";
    return { content: [{ type: "text", text }], details: { prompt: p.prompt, urls, count: urls.length } };
  },
});

// ──────────────────────────────────────────────────────────────────────
// Tool 7: xai_critique
// ──────────────────────────────────────────────────────────────────────

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

const xaiCritiqueTool = defineXaiTool({
  name: "xai_critique",
  label: "xAI Critique",
  description: "Provide detailed, reasoned critique of code, designs, writing, ideas, or arguments with structured feedback.",
  parameters: xaiCritiqueParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiCritiqueParams;
    const apiKey = await resolveXaiAuthToken(ctx);
    if (!apiKey) {
      return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", {
        content: p.content,
      });
    }
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

// ──────────────────────────────────────────────────────────────────────
// Tool 8: xai_analyze_image
// ──────────────────────────────────────────────────────────────────────

const xaiAnalyzeImageParams = Type.Object({
  image: Type.String({ description: "Image URL, local file path, or base64 data URL" }),
  question: Type.Optional(Type.String({ description: "Question to ask about the image (default: describe in detail)" })),
});
type XaiAnalyzeImageParams = Static<typeof xaiAnalyzeImageParams>;

const xaiAnalyzeImageTool = defineXaiTool({
  name: "xai_analyze_image",
  label: "xAI Image Analysis",
  description: "Analyze images, describe visual content, answer questions about images, or extract information using Grok's vision capabilities.",
  parameters: xaiAnalyzeImageParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiAnalyzeImageParams;
    const apiKey = await resolveXaiAuthToken(ctx);
    if (!apiKey) {
      return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", {
        image: p.image,
      });
    }
    const question = p.question ?? "Describe this image in detail, including objects, text, style, and any notable details.";
    const imageInput = (() => {
      try {
        return normalizeXaiImageInput(p.image) ?? p.image;
      } catch {
        return p.image;
      }
    })();
    const input = [
      {
        role: "user",
        content: [
          { type: "input_image", image_url: imageInput, detail: "high" },
          { type: "input_text", text: question },
        ],
      },
    ];

    let data: XaiResponsesData;
    try {
      data = (await createXaiResponse(apiKey, {
        model: DEFAULT_XAI_MODEL,
        input,
        reasoning: { effort: "medium" },
      })) as XaiResponsesData;
    } catch (error) {
      const status = statusFromError(error);
      return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
        error: true,
        status,
        image: p.image,
      });
    }

    const text = extractResponsesText(data) || "Image analysis completed.";
    return { content: [{ type: "text", text }], details: { image: p.image, question } };
  },
});

// ──────────────────────────────────────────────────────────────────────
// Tool 9: xai_deep_research
// ──────────────────────────────────────────────────────────────────────

const xaiDeepResearchParams = Type.Object({
  topic: Type.String({ description: "Research topic or question" }),
  depth: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
});
type XaiDeepResearchParams = Static<typeof xaiDeepResearchParams>;

const xaiDeepResearchTool = defineXaiTool({
  name: "xai_deep_research",
  label: "xAI Deep Research",
  description:
    "Conduct thorough multi-step research on a topic, synthesize information, cite sources, and provide comprehensive analysis with high reasoning effort.",
  parameters: xaiDeepResearchParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiDeepResearchParams;
    const apiKey = await resolveXaiAuthToken(ctx);
    if (!apiKey) {
      return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", {
        topic: p.topic,
      });
    }
    const depth = p.depth ?? "high";
    const prompt = `Conduct deep ${depth} research on: ${p.topic}.\n\nSteps:\n1. Gather key facts, recent developments, and authoritative sources.\n2. Analyze different perspectives and potential biases.\n3. Synthesize findings into clear conclusions.\n4. Provide actionable insights and open questions.\n\nUse step-by-step reasoning and cite sources where possible.`;

    let data: XaiResponsesData;
    try {
      data = (await createXaiResponse(apiKey, {
        model: DEFAULT_XAI_MODEL,
        input: xaiTextInput(prompt),
        reasoning: { effort: depth === "high" ? "high" : "medium" },
        tools: [{ type: "web_search" }, { type: "x_search" }],
      })) as XaiResponsesData;
    } catch (error) {
      const status = statusFromError(error);
      return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
        error: true,
        status,
      });
    }

    const text = extractResponsesText(data) || "Research completed.";
    return { content: [{ type: "text", text }], details: { topic: p.topic, depth } };
  },
});

// ──────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────

/** Map tool names to their pre-built tool definitions. */
const xaiToolRegistry = {
  xai_generate_text: xaiGenerateTextTool,
  xai_multi_agent: xaiMultiAgentTool,
  xai_web_search: xaiWebSearchTool,
  xai_x_search: xaiXSearchTool,
  xai_code_execution: xaiCodeExecutionTool,
  xai_generate_image: xaiGenerateImageTool,
  xai_critique: xaiCritiqueTool,
  xai_analyze_image: xaiAnalyzeImageTool,
  xai_deep_research: xaiDeepResearchTool,
} as const;

const xaiToolRegistrations = new WeakSet<object>();

/** Register the OAuth-backed custom xAI tools whose names are in `enabled`. */
export function registerCustomXaiTools(pi: ExtensionAPI, enabled: Set<string>): void {
  if (xaiToolRegistrations.has(pi as object)) return;
  xaiToolRegistrations.add(pi as object);

  for (const [name, tool] of Object.entries(xaiToolRegistry)) {
    if (enabled.has(name)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pi.registerTool(tool as any);
    }
  }
}
