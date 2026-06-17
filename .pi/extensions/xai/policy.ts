/** Default xai_* tools kept active when pruning (empty = strip all). */
export const DEFAULT_XAI_SIDE_TOOL_ALLOWLIST: readonly string[] = [];

export const XAI_SIDE_TOOL_NAMES = [
  "xai_generate_text",
  "xai_multi_agent",
  "xai_web_search",
  "xai_x_search",
  "xai_code_execution",
  "xai_generate_image",
  "xai_critique",
  "xai_analyze_image",
  "xai_deep_research",
] as const;

export const XAI_SIDE_TOOL_DISALLOW_SUFFIX = XAI_SIDE_TOOL_NAMES.join(", ");

export function xaiSideToolsPruneDisabled(): boolean {
  const raw = (process.env.PI_XAI_SIDE_TOOLS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Append default xai_* disallow list to agent frontmatter (task / harness). */
export function mergeAgentDisallowedTools(disallowed?: string): string | undefined {
  if (xaiSideToolsPruneDisabled()) return disallowed;
  if (!disallowed?.trim()) return XAI_SIDE_TOOL_DISALLOW_SUFFIX;
  return `${disallowed.trim()}, ${XAI_SIDE_TOOL_DISALLOW_SUFFIX}`;
}

/** Parse merged `disallowed_tools` string into unique tool names. */
export function parseMergedDisallowedTools(disallowed?: string): string[] {
  const merged = mergeAgentDisallowedTools(disallowed);
  if (!merged?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of merged.split(",")) {
    const name = part.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function isXaiSideTool(name: string): boolean {
  return name.startsWith("xai_");
}

export function parseXaiSideToolAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("xai_"));
}

/** Remove xai_* from active list except names in allowlist. */
export function pruneXaiSideTools(active: string[], allowlist: readonly string[]): string[] {
  const allowed = new Set(allowlist);
  return active.filter((name) => !isXaiSideTool(name) || allowed.has(name));
}