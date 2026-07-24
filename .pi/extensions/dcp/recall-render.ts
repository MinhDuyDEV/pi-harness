import type { RecallEntry } from "./recall-types.js";

export function renderRecall(entries: RecallEntry[], total: number, page: number, query?: string): string {
  const normalized = query?.trim();
  const lines = [`DCP recall${normalized ? ` for "${normalized}"` : " browse"}: ${total} result${total === 1 ? "" : "s"} (page ${page})`];
  if (entries.length === 0) {
    lines.push("No results. Try a broader query or scope:'all'.");
    return lines.join("\n");
  }

  for (const entry of entries) {
    const snippet = oneLine(normalizeRecallDisplayText(entry.text), normalized ? 300 : 180);
    lines.push(normalized ? "" : `#${entry.index} ${entry.title} — ${snippet}`);
    if (normalized) lines.push(`#${entry.index} ${entry.title}`, snippet);
  }
  lines.push("", "Expand with /dcp-recall expand:<index>.");
  return lines.join("\n");
}

export function renderExpanded(entries: RecallEntry[]): string {
  if (entries.length === 0) return "No matching recall indices.";
  return entries
    .map((entry) => [`#${entry.index} ${entry.title}`, normalizeRecallDisplayText(entry.text)].join("\n"))
    .join("\n\n---\n\n");
}

export function normalizeRecallDisplayText(text: string): string {
  return text
    .replace(/\bde[pp]_recall\b/gi, "dcp_recall")
    .replace(/\bdop_recall\b/gi, "dcp_recall")
    .replace(/\bde[pp]-recall\b/gi, "dcp-recall")
    .replace(/\bdop-recall\b/gi, "dcp-recall")
    .replace(/\/de[pp]-recall\b/gi, "/dcp-recall")
    .replace(/\/dop-recall\b/gi, "/dcp-recall")
    .replace(/\bde[pp]_state\b/gi, "dcp_state")
    .replace(/\bdop_state\b/gi, "dcp_state")
    .replace(/\bde[pp]\/(index\.ts|[\w.-]+\.ts)\b/gi, "dcp/$1")
    .replace(/\bdop\/(index\.ts|[\w.-]+\.ts)\b/gi, "dcp/$1")
    .replace(/\bde[pp]\/([\w./-]*dcp[\w./-]*)/gi, "dcp/$1")
    .replace(/\bdop\/([\w./-]*dcp[\w./-]*)/gi, "dcp/$1");
}

function oneLine(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}
