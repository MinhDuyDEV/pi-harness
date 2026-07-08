/**
 * DCP Extension — Recall Module (Barrel)
 *
 * Re-exports all symbols and contains the main search/register logic.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadDurableSessionState } from "./storage.js";
import type { RecallEntry, RecallOptions, RecallResult } from "./recall-types.js";
import { PAGE_SIZE, RAW_SESSION_DIR } from "./recall-types.js";
import {
  iterateJsonlEntries,
  contentToText,
  jsonlRole,
  jsonlTimestamp,
  normalizeRecallDisplayText,
} from "./recall-jsonl.js";
import {
  safeRegex,
  oneLine,
  renderRecallEntries,
} from "./recall-render.js";

export type { RecallEntry, RecallOptions, RecallResult } from "./recall-types.js";

function searchDcpBlocks(
  sessionId: string,
  query: string,
): RecallEntry[] {
  const durable = loadDurableSessionState(sessionId);
  if (!durable) return [];

  const rx = safeRegex(query);
  const entries: RecallEntry[] = [];

  for (let i = 0; i < durable.blocks.length; i++) {
    const block = durable.blocks[i];
    const text = [
      block.topic,
      block.summary,
      ...(block.filesRead ?? []),
      ...(block.filesModified ?? []),
      ...(block.decisions ?? []),
      ...(block.nextSteps ?? []),
    ]
      .filter(Boolean)
      .join("\n");

    if (rx && !rx.test(text)) continue;

    entries.push({
      index: i + 1,
      source: "dcp",
      title: `b${i + 1}: ${block.topic}`,
      text: normalizeRecallDisplayText(block.summary),
      timestamp: block.createdAt,
      sessionKey: durable.sessionKey,
    });
  }

  return entries;
}

function searchRawSessions(
  sessionId: string,
  query: string,
): RecallEntry[] {
  const rx = safeRegex(query);
  const sessionKey = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const entries: RecallEntry[] = [];

  for (const { index, entry, text } of iterateJsonlEntries(sessionKey)) {
    if (rx && !rx.test(text) && !rx.test(JSON.stringify(entry))) continue;
    entries.push({
      index,
      source: "jsonl",
      sessionKey,
      role: jsonlRole(entry),
      title: contentToText(entry.summary ?? "").slice(0, 60) ||
        `[${jsonlRole(entry)}] ${oneLine(text, 60)}`,
      text: normalizeRecallDisplayText(text),
      timestamp: jsonlTimestamp(entry),
    });
  }

  return entries;
}

export function searchDcpRecall(options: RecallOptions): RecallResult {
  const { sessionId, query = "", page = 1, limit = PAGE_SIZE, scope = "active" } = options;

  let dcpEntries: RecallEntry[] = [];
  let jsonlEntries: RecallEntry[] = [];

  if (scope === "active" || scope === "all") {
    dcpEntries = query ? searchDcpBlocks(sessionId, query) : [];
  }

  jsonlEntries = query ? searchRawSessions(sessionId, query) : [];

  const all = [...dcpEntries, ...jsonlEntries];
  const total = all.length;
  const start = (page - 1) * limit;
  const pageEntries = all.slice(start, start + limit);

  const rendered = renderRecallEntries(pageEntries, total, page);

  return { entries: pageEntries, rendered, total };
}

export function buildRecallEntries(options: RecallOptions): RecallEntry[] {
  return searchDcpRecall(options).entries;
}

export function listRawSessionFiles(sessionId: string): string[] {
  const sessionKey = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const sessionDir = join(RAW_SESSION_DIR, sessionKey);
  if (!existsSync(sessionDir)) return [];
  try {
    return readdirSync(sessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(sessionDir, f));
  } catch {
    return [];
  }
}

let recallToolRegistered = false;

export function registerRecallTool(
  pi: ExtensionAPI,
  _config: Record<string, unknown>,
): void {
  if (recallToolRegistered) return;

  pi.registerTool(
    "dcp_recall",
    `Search DCP (Durable Compression Protocol) compressed session history.

     Args:
       query: Search pattern for matching blocks or JSONL entries
       expand: Array of entry indices to show full content
       page: Page number (1-indexed, default 1)
       scope: "active" for current session, "all" for full history
       limit: Results per page (default 5)`,
    async (params: Record<string, unknown>) => {
      const sessionId = pi.sessionManager.getSessionFile() ?? pi.cwd;
      const result = searchDcpRecall({
        sessionId,
        query: params.query as string,
        expand: params.expand as number[] | undefined,
        page: (params.page as number) ?? 1,
        scope: (params.scope as "active" | "all") ?? "active",
        limit: (params.limit as number) ?? PAGE_SIZE,
      });

      return {
        content: [
          { type: "text" as const, text: result.rendered },
        ],
        details: {
          total: result.total,
          entries: result.entries.length,
        },
      };
    },
  );

  recallToolRegistered = true;
}
