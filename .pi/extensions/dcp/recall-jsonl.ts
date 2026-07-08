/**
 * DCP Extension — JSONL Recall Helpers
 *
 * JSONL reading and transformation utilities for recall.
 * No dependencies on recall ranking or rendering.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RecallEntry } from "./recall-types.js";
import { RAW_SESSION_DIR } from "./recall-types.js";

/**
 * Transform a JSONL payload into display text.
 */
export function jsonlPayload(entry: Record<string, unknown>): string {
  const data = entry.data && typeof entry.data === "object"
    ? (entry.data as Record<string, unknown>)
    : undefined;
  return entry.summary as string ?? data?.summary as string ?? entry.content as string ?? JSON.stringify(entry).slice(0, 200);
}

/**
 * Get the role (type) of a JSONL entry.
 */
export function jsonlRole(entry: Record<string, unknown>): string {
  const customType = entry.customType as string | undefined;
  if (customType && customType !== "dcp_state") return customType;
  return entry.type as string ?? entry.role as string ?? "entry";
}

/**
 * Get timestamp from a JSONL entry.
 */
export function jsonlTimestamp(entry: Record<string, unknown>): number | undefined {
  if (typeof entry.timestamp === "number") return entry.timestamp;
  if (typeof entry.t === "number") return entry.t;
  return undefined;
}

/**
 * Should this JSONL entry be included in recall results?
 */
export function shouldIncludeJsonlEntry(
  entry: Record<string, unknown>,
): boolean {
  if (entry.customType === "dcp_state") return false;
  const role = jsonlRole(entry);
  if (role === "system" || role === "compactionSummary" || role === "branchSummary") return false;
  return true;
}

export function normalizeRecallDisplayText(text: string): string {
  if (!text || text.length > 1000) return text?.slice(0, 1000) ?? "";
  return text;
}

export function contentToText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          const obj = c as Record<string, unknown>;
          return obj.text as string ?? "";
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return JSON.stringify(content).slice(0, 200);
}

/**
 * Read JSONL files from the sessions directory.
 */
export function* iterateJsonlEntries(
  sessionKey: string,
): Generator<{ index: number; entry: Record<string, unknown>; text: string }> {
  const sessionDir = join(RAW_SESSION_DIR, sessionKey);
  if (!existsSync(sessionDir)) return;

  const files = existsSync(sessionDir) ? [] : [];
  const entries: { file: string; data: Record<string, unknown>; mtime: number }[] = [];

  try {
    const dirFiles = readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of dirFiles) {
      try {
        const path = join(sessionDir, file);
        const raw = readFileSync(path, "utf-8");
        const lines = raw.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as Record<string, unknown>;
            const mtime = statSync(path).mtimeMs;
            entries.push({ file, data: entry, mtime });
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    return;
  }

  const typeOrder: Record<string, number> = {
    user: 0,
    assistant: 1,
    toolResult: 2,
    bashExecution: 3,
  };

  entries.sort((a, b) => {
    const typeDiff = (typeOrder[jsonlRole(a.data)] ?? 99) - (typeOrder[jsonlRole(b.data)] ?? 99);
    if (typeDiff !== 0) return typeDiff;
    return (jsonlTimestamp(a.data) ?? a.mtime) - (jsonlTimestamp(b.data) ?? b.mtime);
  });

  let index = 0;
  for (const { data: entry } of entries) {
    if (!shouldIncludeJsonlEntry(entry)) continue;
    const text = jsonlPayload(entry);
    yield { index: index++, entry, text };
  }
}
