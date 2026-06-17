/**
 * Strip pi-xai-oauth side-channel `xai_*` tools from the active tool set.
 *
 * Cursor/Grok CLI shims (Read, Shell, …) are kept only for xAI models that need
 * them: grok-composer-2.5-fast, grok-build, and grok-4.3. Nested Grok API calls
 * via xai_* are redundant with the main turn + pi-search/webclaw.
 *
 * At execution time, a tool_call guard blocks disallowed xai side/shim tools
 * with a clear reason message. This catches cases where active-tool pruning
 * missed (tools re-added by another extension) or the model changed mid-session.
 *
 * Opt out: PI_XAI_SIDE_TOOLS=1 (or true/yes) keeps xai_* and compatibility shims registered active.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_XAI_SIDE_TOOL_ALLOWLIST,
  isDisallowedXaiToolForModel,
  parseXaiSideToolAllowlist,
  pruneXaiTools,
  xaiSideToolsPruneDisabled,
  xaiToolBlockReason,
} from "./policy.js";

function resolveAllowlist(): string[] {
  const fromEnv = parseXaiSideToolAllowlist(process.env.PI_XAI_SIDE_TOOL_ALLOWLIST);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_XAI_SIDE_TOOL_ALLOWLIST];
}

type ToolContext = {
  getActiveTools?: () => unknown;
  setActiveTools?: (tools: string[]) => void;
  model?: unknown;
};

type ModelEvent = {
  model?: unknown;
};

function eventModel(event: unknown): unknown {
  if (!event || typeof event !== "object") return undefined;
  return (event as ModelEvent).model;
}

function pruneActiveTools(ctx: ToolContext, model: unknown): void {
  if (typeof ctx.getActiveTools !== "function" || typeof ctx.setActiveTools !== "function") return;
  const active = ctx.getActiveTools();
  if (!Array.isArray(active)) return;

  const allowlist = resolveAllowlist();
  const next = pruneXaiTools(active as string[], allowlist, model);
  if (next.length !== active.length || next.some((name, i) => name !== active[i])) {
    ctx.setActiveTools(next);
  }
}

export default function xaiExtension(pi: ExtensionAPI): void {
  if (xaiSideToolsPruneDisabled()) return;

  if (typeof (pi as { on?: unknown }).on !== "function") return;

  let lastModel: unknown;

  const hook = (event: unknown, ctx: unknown) => {
    const toolCtx = ctx as ToolContext;
    const model = toolCtx.model ?? eventModel(event) ?? lastModel;
    if (model) lastModel = model;

    // Prune immediately and again after other extensions that may mutate active tools
    // (pi-xai-oauth can add/remove compatibility shims on model changes).
    pruneActiveTools(toolCtx, model);
    setTimeout(() => pruneActiveTools(toolCtx, model), 0);
    setTimeout(() => pruneActiveTools(toolCtx, model), 50);
  };

  pi.on("session_start", hook);
  pi.on("model_select", hook);
  pi.on("before_agent_start", hook);

  // tool_call guard: block disallowed xai side/shim tools at execution time.
  // This catches cases where active-tool pruning missed (e.g., tools re-added
  // by another extension) or the model changed mid-session.
  pi.on("tool_call", (event: unknown, _ctx?: unknown) => {
    const e = (event ?? {}) as Record<string, unknown>;
    const name = String(e.toolName ?? e.name ?? "").trim();
    if (!name) return;

    const model = lastModel;
    const allowlist = resolveAllowlist();
    if (!isDisallowedXaiToolForModel(name, allowlist, model)) return;

    const reason = xaiToolBlockReason(name, allowlist, model);
    return { block: true, reason };
  });
}
