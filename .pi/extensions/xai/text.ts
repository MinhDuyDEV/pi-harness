import type { XaiResponsesData } from "./types";

/** Extract display text from an xAI/OpenAI Responses API response. */
export function extractResponsesText(data: XaiResponsesData | undefined | null): string {
  if (typeof data?.output_text === "string" && data.output_text) return data.output_text;
  const chunks: string[] = [];
  for (const item of data?.output ?? []) {
    for (const part of item?.content ?? []) {
      const partObj = part as { type?: unknown; text?: unknown } | undefined;
      if (typeof partObj?.text === "string" && (partObj.type === "output_text" || partObj.text)) chunks.push(partObj.text);
    }
  }
  return chunks.join("") || JSON.stringify(data);
}

/** Extract text from Responses content parts. */
export function textFromResponsesContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as { type?: unknown; text?: unknown };
      const type = typeof item.type === "string" ? item.type : "";
      return ["text", "input_text", "output_text"].includes(type) && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Extract an HTTP-like status from thrown xAI request errors. */
export function statusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** Return a safe display message for thrown values. */
export function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
