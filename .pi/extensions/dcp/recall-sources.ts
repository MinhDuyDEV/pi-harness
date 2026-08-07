import { listDurableSessionStates, loadDurableSessionState, loadDurableSessionStateFromPath } from "./storage.js";
import { jsonlRole, jsonlText, jsonlTimestamp, listRawSessionFiles, rawSessionKey, readJsonlLines, safeStat, shouldIncludeJsonlEntry } from "./recall-jsonl.js";
import type { RecallEntry } from "./recall-types.js";

export function buildRecallEntries(
  sessionId: string,
  scope: "active" | "all",
  sessionFile?: string,
  taskEntries: Omit<RecallEntry, "index">[] = [],
): RecallEntry[] {
  const entries = [
    ...buildDurableEntries(sessionId, scope),
    ...buildJsonlEntries(scope, sessionFile),
    ...(scope === "all" ? taskEntries : []),
  ];
  return entries.map((entry, position) => ({ ...entry, index: position + 1 }));
}

function buildDurableEntries(sessionId: string, scope: "active" | "all"): Omit<RecallEntry, "index">[] {
  const states = scope === "all"
    ? listDurableSessionStates().map((info) => loadDurableSessionStateFromPath(info.path)).filter(Boolean)
    : [loadDurableSessionState(sessionId)].filter(Boolean);

  return states.flatMap((state) => (state?.blocks ?? []).map((block) => ({
    source: "dcp" as const,
    sessionKey: state?.sessionKey,
    title: `[dcp:b${block.id}] ${block.topic}`,
    text: [
      block.summary,
      block.filesRead.length ? `Files read: ${block.filesRead.join(", ")}` : "",
      block.filesModified.length ? `Files modified: ${block.filesModified.join(", ")}` : "",
      block.decisions.length ? `Decisions: ${block.decisions.join("; ")}` : "",
      block.nextSteps.length ? `Next steps: ${block.nextSteps.join("; ")}` : "",
    ].filter(Boolean).join("\n"),
    timestamp: block.createdAt,
  })));
}

function buildJsonlEntries(scope: "active" | "all", sessionFile?: string): Omit<RecallEntry, "index">[] {
  const entries: Omit<RecallEntry, "index">[] = [];
  for (const path of listRawSessionFiles(scope, sessionFile)) {
    if (scope === "active" && sessionFile && path !== sessionFile) continue;
    const stat = safeStat(path);
    const sessionKey = rawSessionKey(path);
    for (const raw of readJsonlLines(path)) {
      if (!shouldIncludeJsonlEntry(raw)) continue;
      const text = jsonlText(raw);
      if (!text.trim()) continue;
      const role = jsonlRole(raw);
      entries.push({
        source: "jsonl",
        sessionKey,
        role,
        title: `[jsonl:${role || "entry"}]`,
        text,
        path,
        timestamp: jsonlTimestamp(raw) ?? Number(stat?.mtimeMs ?? 0),
      });
    }
  }
  return entries;
}
