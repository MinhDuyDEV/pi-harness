/**
 * Re-read detection after compress (deduped, verify-friendly).
 */

import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";

/** Tools that count toward re-read metrics (excludes broad search tools). */
const REGRESSION_READ_TOOLS = new Set(["read", "hashline_read"]);

function isRegressionReadTool(name: string): boolean {
  return REGRESSION_READ_TOOLS.has(name);
}

function pathsFromReadArgs(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  if (typeof args.path === "string" && args.path.trim()) {
    paths.push(args.path.trim());
  }
  if (Array.isArray(args.paths)) {
    for (const p of args.paths) {
      if (typeof p === "string" && p.trim()) paths.push(p.trim());
    }
  }
  return paths.map((p) => p.replace(/^\.\//, "").replace(/\/+$/, ""));
}

export interface ReReadScanResult {
  newKeys: string[];
  paths: string[];
}

/**
 * Scan assistant tool calls for reads of compressed files; return dedupe keys
 * not yet in `seen`.
 */
export function scanNewReReads(
  messages: Message[],
  compressedFiles: Set<string>,
  seen: Set<string>,
): ReReadScanResult {
  const newKeys: string[] = [];
  const paths: string[] = [];

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const asst = msg as AssistantMessage;
    if (!Array.isArray(asst.content)) continue;
    for (const part of asst.content) {
      if (part.type !== "toolCall") continue;
      const tc = part as ToolCall;
      if (!isRegressionReadTool(tc.name)) continue;

      const extracted = pathsFromReadArgs(
        tc.arguments as Record<string, unknown>,
      );
      for (const p of extracted) {
        if (!compressedFiles.has(p)) continue;
        const key = `${tc.id ?? "no-id"}:${p}`;
        if (seen.has(key)) continue;
        seen.add(key);
        newKeys.push(key);
        paths.push(p);
      }
    }
  }

  return { newKeys, paths };
}

/** Skip noisy regression log rows for immediate post-compress verify (gap <= 1). */
export function shouldLogRegression(turnGap: number): boolean {
  return turnGap > 1;
}