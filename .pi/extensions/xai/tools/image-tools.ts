import { Type, type Static } from "@earendil-works/pi-ai";
import { DEFAULT_XAI_IMAGE_MODEL, DEFAULT_XAI_MODEL, XAI_IMAGES_GENERATIONS_URL } from "../constants";
import { normalizeXaiImageInput } from "../images";
import { createXaiResponse, postXaiJson } from "../responses";
import { extractResponsesText, messageFromError, statusFromError } from "../text";
import type { XaiResponsesData } from "../types";
import { requireXaiAuthToken, xaiToolError } from "./common";
import { defineXaiTool } from "./define-tool";

// Port of pi-xai-oauth@1.2.6 / commit 167db38: xAI image API rejects
// unsupported `size`, and `n` must be opt-in (1-4) rather than defaulted.
const xaiGenerateImageParams = Type.Object({
  prompt: Type.String({ description: "Detailed description of the image to generate" }),
  model: Type.Optional(
    Type.String({ description: `Image model to use (default: ${DEFAULT_XAI_IMAGE_MODEL})` }),
  ),
  n: Type.Optional(
    Type.Number({ minimum: 1, maximum: 4, description: "Number of images to generate (1-4)" }),
  ),
});

export const xaiGenerateImageTool = defineXaiTool({
  name: "xai_generate_image",
  label: "xAI Image Generation",
  description: "Generate images using xAI's current image generation model.",
  parameters: xaiGenerateImageParams,
  execute: async ({ params, ctx }) => {
    // Keep `size` on the cast so legacy callers still fail locally instead of hitting the API.
    const p = params as {
      prompt: string;
      model?: string;
      size?: string;
      n?: number;
    };
    if (p.size !== undefined) {
      return xaiToolError(
        "Error: The xAI image API does not support the 'size' parameter. Omit it from the request.",
        { error: true, prompt: p.prompt },
      );
    }
    if (p.n !== undefined && (!Number.isInteger(p.n) || p.n < 1 || p.n > 4)) {
      return xaiToolError("Error: The 'n' parameter must be an integer from 1 to 4.", {
        error: true,
        prompt: p.prompt,
      });
    }
    const apiKeyOrError = await requireXaiAuthToken(ctx, { prompt: p.prompt, });
    if (typeof apiKeyOrError !== "string") {
      return apiKeyOrError;
    }
    const apiKey = apiKeyOrError;
    interface ImageApiResponse {
      data?: ReadonlyArray<{ url?: string }>;
    }
    const body: Record<string, unknown> = {
      model: p.model ?? DEFAULT_XAI_IMAGE_MODEL,
      prompt: p.prompt,
    };
    if (p.n !== undefined) {
      body.n = p.n;
    }
    let data: ImageApiResponse;
    try {
      data = (await postXaiJson(apiKey, XAI_IMAGES_GENERATIONS_URL, body)) as ImageApiResponse;
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

const xaiAnalyzeImageParams = Type.Object({
  image: Type.String({ description: "Image URL, local file path, or base64 data URL" }),
  question: Type.Optional(Type.String({ description: "Question to ask about the image (default: describe in detail)" })),
});
type XaiAnalyzeImageParams = Static<typeof xaiAnalyzeImageParams>;

export const xaiAnalyzeImageTool = defineXaiTool({
  name: "xai_analyze_image",
  label: "xAI Image Analysis",
  description: "Analyze images, describe visual content, answer questions about images, or extract information using Grok's vision capabilities.",
  parameters: xaiAnalyzeImageParams,
  execute: async ({ params, ctx }) => {
    const p = params as XaiAnalyzeImageParams;
    const apiKeyOrError = await requireXaiAuthToken(ctx, { image: p.image, });
    if (typeof apiKeyOrError !== "string") {
      return apiKeyOrError;
    }
    const apiKey = apiKeyOrError;
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
