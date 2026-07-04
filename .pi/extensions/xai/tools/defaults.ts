// Default xAI tool enablement + env-var override.
//
// 5 tools are unique-value (no built-in pi alternative) and stay on by
// default. 4 tools are either too general, redundant, or expensive and
// stay off until the user opts in.
//
// Override at runtime with:
//   PI_XAI_ENABLE_TOOLS=xai_multi_agent,xai_code_execution
//   PI_XAI_DISABLE_TOOLS=xai_generate_image
// Special value: "*" enables or disables everything (clear of all
// defaults for the matching direction).

export const XAI_DEFAULT_ENABLED_TOOLS = [
  "xai_web_search",
  "xai_x_search",
  "xai_analyze_image",
] as const;

export const XAI_DEFAULT_DISABLED_TOOLS = [
  "xai_generate_text",
  "xai_generate_image",
  "xai_critique",
  "xai_multi_agent",
  "xai_code_execution",
  "xai_deep_research",
] as const;

export const XAI_ALL_TOOL_NAMES = [
  ...XAI_DEFAULT_ENABLED_TOOLS,
  ...XAI_DEFAULT_DISABLED_TOOLS,
] as const;

export type XaiToolName = (typeof XAI_ALL_TOOL_NAMES)[number];

/** Read PI_XAI_ENABLE_TOOLS and PI_XAI_DISABLE_TOOLS, return the set of tools to register. */
export function resolveXaiToolConfig(): Set<string> {
  const enabled = new Set<string>(XAI_DEFAULT_ENABLED_TOOLS);
  const extraRaw = (process.env.PI_XAI_ENABLE_TOOLS ?? "").trim();
  if (extraRaw === "*") {
    for (const t of XAI_ALL_TOOL_NAMES) enabled.add(t);
  } else if (extraRaw) {
    for (const t of extraRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (XAI_ALL_TOOL_NAMES.includes(t as XaiToolName)) {
        enabled.add(t);
      } else {
        warnUnknownTool(t, "PI_XAI_ENABLE_TOOLS");
      }
    }
  }

  const disabledRaw = (process.env.PI_XAI_DISABLE_TOOLS ?? "").trim();
  if (disabledRaw === "*") {
    enabled.clear();
  } else if (disabledRaw) {
    for (const t of disabledRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (XAI_ALL_TOOL_NAMES.includes(t as XaiToolName)) {
        enabled.delete(t);
      } else {
        warnUnknownTool(t, "PI_XAI_DISABLE_TOOLS");
      }
    }
  }

  return enabled;
}

let warnedKeys: Set<string> | null = null;
function warnUnknownTool(name: string, source: string): void {
  // Warn at most once per (source, name) so a noisy env doesn't spam the log.
  if (!warnedKeys) warnedKeys = new Set();
  const key = `${source}:${name}`;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[xai] ignoring unknown tool "${name}" from ${source}; valid names: ${XAI_ALL_TOOL_NAMES.join(", ")}`,
  );
}
