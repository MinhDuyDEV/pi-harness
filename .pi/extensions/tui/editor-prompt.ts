import { hasNerdFonts } from "./helpers.js";

const NF_ICON_PROMPT = hasNerdFonts() ? "\ueab6 " : "> ";

export type EditorThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

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

export function editorBorderColorForThinkingLevel(thinkingLevel: string): string {
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
  }
}

export function editorPromptColorForThinkingLevel(thinkingLevel: string): string {
  return editorBorderColorForThinkingLevel(thinkingLevel);
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
      return ["∿", "≋", "∿"];
  }
}
