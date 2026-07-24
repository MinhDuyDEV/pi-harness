import type { RecallEntry } from "./recall-types.js";

export function isBrowseEntry(entry: RecallEntry): boolean {
  if (entry.source === "dcp") return true;
  if (isBrowseDiagnostic(entry.text) || isLowSignalAcknowledgement(entry.text)) return false;
  const role = entry.role?.toLowerCase() ?? "";
  if (role === "user") return true;
  if (role === "assistant") return !/^tool call:/i.test(entry.text.trim());
  return false;
}

export function filterRecallEntries(entries: RecallEntry[], query?: string, source?: RecallEntry["source"]): RecallEntry[] {
  const normalized = query?.trim().toLowerCase();
  return entries.filter((entry) => {
    if (source && entry.source !== source) return false;
    if (!normalized) return true;
    return `${entry.title}\n${entry.text}`.toLowerCase().includes(normalized);
  });
}

export function rankRecallEntries(entries: RecallEntry[], query: string): RecallEntry[] {
  const regex = safeRegex(query);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .map((entry) => {
      const haystack = `${entry.title}\n${entry.text}`;
      const lower = haystack.toLowerCase();
      let matchScore = 0;
      if (regex?.test(haystack)) matchScore += 12;
      for (const term of terms) {
        const count = lower.split(term).length - 1;
        matchScore += Math.min(count, 3) * Math.max(1, 8 - term.length / 4);
      }
      if (matchScore <= 0) return { entry, score: 0 };
      const score = matchScore + recallRoleBoost(entry) - recallLengthPenalty(entry.text) - recallEchoPenalty(entry.text);
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || (right.entry.timestamp ?? 0) - (left.entry.timestamp ?? 0))
    .map((item) => item.entry);
}

export function browseRecallEntries(entries: RecallEntry[], page = 1, pageSize = 5, source?: RecallEntry["source"]): RecallEntry[] {
  const browsable = filterRecallEntries(entries, undefined, source).filter(isBrowseEntry);
  const newest = [...browsable].sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0));
  const start = Math.max(0, page - 1) * pageSize;
  return newest.slice(start, start + pageSize);
}

function recallRoleBoost(entry: RecallEntry): number {
  if (entry.source === "dcp") return 80;
  const role = entry.role?.toLowerCase() ?? "";
  if (role === "user") return 45;
  if (role === "assistant") return /^tool call:/i.test(entry.text.trim()) ? -30 : 35;
  if (["toolresult", "tool_result", "tool"].includes(role)) return -25;
  return 0;
}

function recallLengthPenalty(text: string): number {
  return Math.min(20, Math.floor(text.length / 2_000));
}

function recallEchoPenalty(text: string): number {
  return isRecallEcho(text) ? 55 : 0;
}

function isBrowseDiagnostic(text: string): boolean {
  return isRecallEcho(text) || isBenchmarkDiagnostic(text);
}

function isRecallEcho(text: string): boolean {
  const markers = [
    /DCP recall (?:for|browse):/i,
    /\/d[ceo]p-recall/i,
    /output\s+["']?\/d[ceo]p-recall/i,
    /new output .*\/d[ceo]p-recall/i,
    /#\d+\s+\[jsonl:/i,
    /Expand with \/d[ceo]p-recall/i,
    /Brutal review:.*(?:recall|browse-mode|query mode)/is,
    /This is \*\*clean\*\*.*too sparse/is,
    /Browse mode no longer shows:/i,
    /Browse mode .*?(?:tool spam|raw JSON|recall-debug loop|low-signal|too sparse)/is,
  ];
  return markers.some((marker) => marker.test(text));
}

function isBenchmarkDiagnostic(text: string): boolean {
  const markers = [
    /DCP deterministic compaction benchmark:/i,
    /DCP compaction diagnostic benchmark:/i,
    /\/dcp-ben(?:ch)?mark/i,
    /Use this output beside pi-vcc metrics/i,
    /Diagnostic only\. Normal workflow: \/compact and \/dcp-recall/i,
    /benchmark formatting is fixed/i,
    /That benchmark is .*?(?:excellent|very good)/is,
    /Before:\s*[\d,]+.*After:\s*[\d,]+.*Reduction:/is,
  ];
  return markers.some((marker) => marker.test(text));
}

function isLowSignalAcknowledgement(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[.!?"'`*_~()[\]{}:;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return true;
  if (normalized.length > 80) return false;
  const patterns = [
    /^(ok|okay|sure|yes|yep|yeah|fine|good|great|sounds good|nice|thanks|thank you)$/,
    /^(ok|okay) (sure|sounds good|thanks|thank you)$/,
    /^(ok|okay|sure|yes|yep|yeah|fine|sounds good) (go ahead|continue|please continue|do it|proceed)$/,
    /^(ok|okay|sure|yes|yep|yeah|fine) (go ahead )?continue( next work)?$/,
    /^please continue$/,
    /^go ahead$/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function safeRegex(query: string): RegExp | undefined {
  try {
    return new RegExp(query, "i");
  } catch {
    return undefined;
  }
}
