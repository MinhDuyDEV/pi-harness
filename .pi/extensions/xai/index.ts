/**
 * Strip pi-xai-oauth side-channel `xai_*` tools from the active tool set.
 *
 * Cursor/Grok CLI shims (Read, Shell, …) are untouched — required for
 * grok-composer-2.5-fast / grok-build. Nested Grok API calls via xai_* are
 * redundant with the main turn + pi-search/webclaw.
 *
 * Opt out: PI_XAI_SIDE_TOOLS=1 (or true/yes) keeps all xai_* registered active.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_XAI_SIDE_TOOL_ALLOWLIST,
  parseXaiSideToolAllowlist,
  pruneXaiSideTools,
  xaiSideToolsPruneDisabled,
} from "./policy.js";

function resolveAllowlist(): string[] {
  const fromEnv = parseXaiSideToolAllowlist(process.env.PI_XAI_SIDE_TOOL_ALLOWLIST);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_XAI_SIDE_TOOL_ALLOWLIST];
}

function pruneActiveTools(ctx: { getActiveTools?: () => unknown; setActiveTools?: (tools: string[]) => void }): void {
  if (typeof ctx.getActiveTools !== "function" || typeof ctx.setActiveTools !== "function") return;
  const active = ctx.getActiveTools();
  if (!Array.isArray(active)) return;

  const allowlist = resolveAllowlist();
  const next = pruneXaiSideTools(active as string[], allowlist);
  if (next.length !== active.length || next.some((name, i) => name !== active[i])) {
    ctx.setActiveTools(next);
  }
}

export default function xaiExtension(pi: ExtensionAPI): void {
  if (xaiSideToolsPruneDisabled()) return;

  if (typeof (pi as { on?: unknown }).on !== "function") return;

  const hook = (_event: unknown, ctx: unknown) => {
    pruneActiveTools(ctx as Parameters<typeof pruneActiveTools>[0]);
  };

  pi.on("session_start", hook);
  pi.on("model_select", hook);
  pi.on("before_agent_start", hook);
}