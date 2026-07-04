import type { Api, Model } from "@earendil-works/pi-ai";
import { XAI_CURSOR_TOOL_NAMES, XAI_PROVIDER_ID } from "../../constants";
import { isGrokCliProxyModel } from "../../models";

function uniqueToolNames(toolNames: string[]): string[] {
  return [...new Set(toolNames)];
}

/** Enable Cursor/Grok CLI shims only for Grok CLI proxy models. */
export function syncCursorToolShimsForModel(ctx: any, model?: Model<Api>) {
  if (typeof ctx?.getActiveTools !== "function" || typeof ctx?.setActiveTools !== "function") return;

  const activeTools = Array.isArray(ctx.getActiveTools()) ? (ctx.getActiveTools() as string[]) : [];
  const withoutCursorShims = activeTools.filter((toolName) => !XAI_CURSOR_TOOL_NAMES.includes(toolName));
  const shouldEnableCursorShims = model?.provider === XAI_PROVIDER_ID && isGrokCliProxyModel(model.id);
  const nextTools = shouldEnableCursorShims ? uniqueToolNames([...withoutCursorShims, ...XAI_CURSOR_TOOL_NAMES]) : withoutCursorShims;

  if (nextTools.length !== activeTools.length || nextTools.some((toolName, index) => toolName !== activeTools[index])) {
    ctx.setActiveTools(nextTools);
  }
}