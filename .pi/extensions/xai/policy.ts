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

export const XAI_COMPAT_SHIM_TOOL_NAMES = [
  "Read",
  "Write",
  "StrReplace",
  "Edit",
  "Delete",
  "LS",
  "Grep",
  "Glob",
  "Shell",
  "WebSearch",
] as const;

export const XAI_COMPAT_SHIM_MODEL_KEYS = [
  "xai-auth/grok-composer-2.5-fast",
  "xai-auth/grok-build",
  "xai-auth/grok-4.3",
] as const;

export const XAI_SIDE_TOOL_DISALLOW_SUFFIX = XAI_SIDE_TOOL_NAMES.join(", ");

type ModelLike = {
  id?: unknown;
  provider?: unknown;
};

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

export function isXaiCompatShimTool(name: string): boolean {
  return (XAI_COMPAT_SHIM_TOOL_NAMES as readonly string[]).includes(name);
}

export function modelKey(model: unknown): string | undefined {
  if (!model || typeof model !== "object") return undefined;
  const { provider, id } = model as ModelLike;
  if (typeof provider !== "string" || typeof id !== "string") return undefined;
  return `${provider}/${id}`;
}

export function shouldKeepXaiCompatShims(model: unknown): boolean {
  const key = modelKey(model);
  return !!key && (XAI_COMPAT_SHIM_MODEL_KEYS as readonly string[]).includes(key);
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

/** Remove Cursor/Grok CLI compatibility shims unless the selected model needs them. */
export function pruneXaiCompatShimTools(active: string[], model: unknown): string[] {
  if (shouldKeepXaiCompatShims(model)) return active;
  return active.filter((name) => !isXaiCompatShimTool(name));
}

/** True when a tool call should be blocked for the selected model. */
export function isDisallowedXaiToolForModel(
  name: string,
  allowlist: readonly string[],
  model: unknown,
): boolean {
  if (isXaiSideTool(name)) return !allowlist.includes(name);
  if (isXaiCompatShimTool(name)) return !shouldKeepXaiCompatShims(model);
  return false;
}

/** User-facing reason for a blocked xAI side/shim tool call. */
export function xaiToolBlockReason(
  name: string,
  allowlist: readonly string[],
  model: unknown,
): string | undefined {
  if (!isDisallowedXaiToolForModel(name, allowlist, model)) return undefined;

  if (isXaiSideTool(name)) {
    return `[xai] Blocked ${name}: nested xai_* side tools are disabled by default. Use the normal Pi tools instead, or allow it with PI_XAI_SIDE_TOOL_ALLOWLIST=${name} / PI_XAI_SIDE_TOOLS=1.`;
  }

  const key = modelKey(model) ?? "unknown model";
  return `[xai] Blocked ${name}: Cursor/Grok compatibility shims are only available for ${XAI_COMPAT_SHIM_MODEL_KEYS.join(", ")}; current model is ${key}. Use the native lowercase Pi tools instead.`;
}

/** Apply all xai hygiene pruning rules for active tools. */
export function pruneXaiTools(active: string[], allowlist: readonly string[], model: unknown): string[] {
  return pruneXaiCompatShimTools(pruneXaiSideTools(active, allowlist), model);
}
