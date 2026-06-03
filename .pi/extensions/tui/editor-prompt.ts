function hasNerdFonts(): boolean {
  if (process.env.POWERLINE_NERD_FONTS === "1") return true;
  if (process.env.POWERLINE_NERD_FONTS === "0") return false;
  return true;
}

const NF_ICON_PROMPT = hasNerdFonts() ? "\ueab6 " : "> ";

export interface EditorPromptState {
  isShell: boolean;
  streamingPrompt: string | null;
}

export function editorPromptForState(state: EditorPromptState): string {
  if (state.isShell) return "$ ";
  const streamingPrompt = state.streamingPrompt?.trim();
  return streamingPrompt ? `${streamingPrompt} ` : NF_ICON_PROMPT;
}
