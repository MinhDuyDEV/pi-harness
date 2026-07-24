import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { hasNerdFonts } from "./helpers.js";

const NF_ICON_PROMPT = hasNerdFonts() ? "\ueab6 " : "> ";

export type EditorThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface EditorPromptState {
  isShell: boolean;
  streamingPrompt: string | null;
  thinkingLevel: string;
}

export function normalizeThinkingLevel(level?: string | null): EditorThinkingLevel {
  switch (level) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return level;
    default:
      return "medium";
  }
}

function idlePromptForThinkingLevel(_thinkingLevel: string): string {
  // Keep the idle glyph stable; only its color changes with the thinking budget.
  return NF_ICON_PROMPT;
}

export function editorPromptForState(state: EditorPromptState): string {
  if (state.isShell) return "$ ";
  const streamingPrompt = state.streamingPrompt?.trim();
  return streamingPrompt
    ? `${streamingPrompt} `
    : idlePromptForThinkingLevel(state.thinkingLevel);
}

export function editorBorderColorForThinkingLevel(thinkingLevel: string): ThemeColor {
  switch (normalizeThinkingLevel(thinkingLevel)) {
    case "off":
    case "minimal":
      return "thinkingOff";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
  }
}


export function streamingPromptFramesForThinkingLevel(
  thinkingLevel: string,
): readonly string[] {
  switch (normalizeThinkingLevel(thinkingLevel)) {
    case "off":
    case "minimal":
      return ["·", "•", "·"];
    case "low":
      return ["-", "~", "-"];
    case "medium":
      return ["≈", "≋", "⋍", "≋"];
    case "high":
      return ["≈", "≋", "≈"];
    case "xhigh":
    case "max":
      return ["∿", "≋", "∿"];
  }
}
