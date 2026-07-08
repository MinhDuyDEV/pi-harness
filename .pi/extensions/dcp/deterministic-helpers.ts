/**
 * DCP Extension — Deterministic Helpers
 *
 * Pure helper functions for deterministic compaction.
 * No dependencies beyond standard JS.
 */

export function contentToText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          const obj = c as Record<string, unknown>;
          return obj.text ?? obj.content ?? "";
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (typeof content === "object") {
    return (content as Record<string, unknown>).text as string ?? "";
  }
  return String(content);
}

export function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  } catch {
    return String(value);
  }
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat;
}

export function quote(text: string): string {
  return text ? `"${text}"` : "";
}
