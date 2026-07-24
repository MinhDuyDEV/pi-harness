import { Optional, Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getDcpSessionId } from "./compress-state.js";
import { buildRecallEntries } from "./recall-sources.js";
import { isBrowseEntry, rankRecallEntries } from "./recall-ranking.js";
import { renderExpanded, renderRecall } from "./recall-render.js";
import { PAGE_SIZE, type RecallOptions, type RecallResult } from "./recall-types.js";

// Re-export the public result types so external importers of `recall.js` keep
// access after the types were moved to recall-types.js.
export type { RecallOptions, RecallResult } from "./recall-types.js";

export function registerRecallTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "dcp_recall",
    label: "DCP Recall",
    description: "Search durable DCP blocks and persisted Pi session JSONL history. Supports regex queries, pagination, expand, and scope:'all'.",
    promptSnippet: "Search exact durable DCP history when compacted context may have omitted details.",
    promptGuidelines: [
      "Use dcp_recall before guessing about old compacted context.",
      "Search first, then call expand with result indices when you need exact full content.",
      "Use scope:'all' only when current-lineage results are insufficient.",
    ],
    parameters: Type.Object({
      query: Optional(Type.String({ description: "Search query. Regex is supported; multi-word queries are OR-ranked." })),
      expand: Optional(Type.Array(Type.Number({}), { description: "Recall indices to expand with full content." })),
      page: Optional(Type.Number({ description: "1-based page number for search results." })),
      scope: Optional(Type.Union([Type.Literal("active"), Type.Literal("all")], { description: "active searches current DCP state first; all searches all durable/session logs." })),
      limit: Optional(Type.Number({ description: "Maximum entries to return before pagination." })),
    }),
    renderCall: (_args, theme) => new Text(theme.fg("toolTitle", theme.bold("⚙ dcp_recall")), 0, 0),
    async execute(
      _toolCallId: string,
      params: Omit<RecallOptions, "sessionId" | "sessionFile">,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const result = searchDcpRecall({
        sessionId: getDcpSessionId(ctx),
        sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
        ...params,
      });
      return {
        content: [{ type: "text" as const, text: result.rendered }],
        details: { total: result.total, entries: result.entries },
      };
    },
  });
}

export function searchDcpRecall(options: RecallOptions): RecallResult {
  const entries = buildRecallEntries(options.sessionId, options.scope ?? "active", options.sessionFile);
  const expanded = options.expand?.length ? entries.filter((entry) => options.expand?.includes(entry.index)) : undefined;
  if (expanded) return { entries: expanded, total: expanded.length, rendered: renderExpanded(expanded) };

  const queried = options.query?.trim()
    ? rankRecallEntries(entries, options.query.trim())
    : entries.filter(isBrowseEntry).sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0));
  const limited = queried.slice(0, options.limit ?? 200);
  const page = Math.max(1, options.page ?? 1);
  const start = (page - 1) * PAGE_SIZE;
  const pageEntries = limited.slice(start, start + PAGE_SIZE);
  return {
    entries: pageEntries,
    total: queried.length,
    rendered: renderRecall(pageEntries, queried.length, page, options.query),
  };
}
