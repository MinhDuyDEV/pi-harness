/**
 * DCP Extension — Recall Render Helpers
 *
 * Display formatting for recall results.
 */

import type { RecallEntry } from "./recall-types.js";

export function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

export function safeStat(fn: () => number): number | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function rawSessionKey(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function oneLine(text: string, maxLen = 120): string {
  return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function renderRecallEntries(
  entries: RecallEntry[],
  total: number,
  page: number,
): string {
  const parts: string[] = [];

  parts.push(`\uF0CE DCP Recall: ${total} entries (page ${page})`);
  parts.push("");

  for (const entry of entries) {
    const label = entry.source === "dcp" ? "DCP" : "RAW";
    const key = entry.sessionKey ? ` [${entry.sessionKey}]` : "";
    parts.push(`\uF0A8 [#${entry.index}] ${label}${key} \u2014 ${entry.title}`);
    if (entry.timestamp) {
      parts.push(`  \u23F1 ${new Date(entry.timestamp).toISOString()}`);
    }
    if (entry.path) {
      parts.push(`  \uF15B ${entry.path}`);
    }
    if (entry.role) {
      parts.push(`  \uF0E7 Role: ${entry.role}`);
    }
    const wrapped = entry.text
      ? entry.text
          .split("\n")
          .slice(0, 8)
          .map((line) => `  ${line}`)
          .join("\n")
      : "  (empty)";
    parts.push(wrapped);
    parts.push("");
  }

  return parts.join("\n");
}
