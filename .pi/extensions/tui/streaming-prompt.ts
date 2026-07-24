import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AmpBoxEditor } from "./editor.js";
import type { FooterState } from "./footer.js";
import { streamingPromptFramesForThinkingLevel } from "./editor-prompt.js";

const DEFAULT_STREAMING_PROMPT_FRAMES = ["≈", "≋", "⋍", "≋"];
const STREAMING_PROMPT_INTERVAL_MS = 200;

export interface StreamingPromptAnimator {
  setPrompt(prompt: string | null): void;
  getPrompt(): string | null;
  start(ctx: ExtensionContext): void;
  stop(): void;
}

export function createStreamingPromptAnimator(
  footer: FooterState,
  getEditor: () => AmpBoxEditor | null,
  applyWorkingRowPadding: (ctx: ExtensionContext) => void,
): StreamingPromptAnimator {
  let prompt: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let frame = 0;

  const setPrompt = (value: string | null): void => {
    prompt = value;
    getEditor()?.setStreamingPrompt(value);
  };

  const start = (ctx: ExtensionContext): void => {
    const frames = streamingPromptFramesForThinkingLevel(footer.thinkingLevel);
    if (prompt === frames[0]) return;
    if (ctx.hasUI) {
      applyWorkingRowPadding(ctx);
      ctx.ui.setWorkingIndicator();
    }
    if (ctx.mode !== "tui") return;
    frame = 0;
    setPrompt(frames[0]);
    getEditor()?.setThinkingLevel(footer.thinkingLevel);
    if (timer) return;
    timer = setInterval(() => {
      if (!footer.isStreaming) return;
      const nextFrames = streamingPromptFramesForThinkingLevel(footer.thinkingLevel) ?? DEFAULT_STREAMING_PROMPT_FRAMES;
      frame = (frame + 1) % nextFrames.length;
      setPrompt(nextFrames[frame]);
    }, STREAMING_PROMPT_INTERVAL_MS);
    timer.unref?.();
  };

  const stop = (): void => {
    setPrompt(null);
    if (timer) clearInterval(timer);
    timer = null;
  };

  return { setPrompt, getPrompt: () => prompt, start, stop };
}
