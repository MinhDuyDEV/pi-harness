import { Type, type Static } from "@earendil-works/pi-ai";
import { DEFAULT_XAI_MODEL } from "../constants";
import { createXaiResponse } from "../responses";
import { extractResponsesText, messageFromError, statusFromError } from "../text";
import { requireXaiAuthToken, xaiTextInput, xaiToolError } from "./common";
import { defineXaiTool } from "./define-tool";

interface XaiResponsesData {
  output_text?: string;
  output?: ReadonlyArray<{
    type?: string;
    content?: ReadonlyArray<{ type?: string; text?: string }>;
  }>;
}


const xaiDeepResearchParams = Type.Object({
  topic: Type.String({ description: "Research topic or question" }),
  depth: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
});
type XaiDeepResearchParams = Static<typeof xaiDeepResearchParams>;

export const xaiDeepResearchTool = defineXaiTool({
  name: "xai_deep_research",
  label: "xAI Deep Research",
  description:
    "Conduct thorough multi-step research on a topic, synthesize information, cite sources, and provide comprehensive analysis with high reasoning effort.",
  parameters: xaiDeepResearchParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiDeepResearchParams;
    const apiKeyOrError = await requireXaiAuthToken(ctx, { topic: p.topic, });
    if (typeof apiKeyOrError !== "string") {
      return apiKeyOrError;
    }
    const apiKey = apiKeyOrError;
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
