/**
 * AmpBoxEditor: background-filled editor with $ / $$ prompt.
 *
 * Layout:
 *     $ text here              $ = editor mode, $$ = shell mode (! prefix)
 */
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type {
  EditorTheme,
  TUI,
} from "@earendil-works/pi-tui";
import { editorPromptForState } from "./editor-prompt.ts";

function padRight(content: string, width: number): string {
  const vw = visibleWidth(content);
  if (vw > width) return truncateToWidth(content, width, "");
  return content + " ".repeat(Math.max(0, width - vw));
}

function firstCodePoint(text: string): string {
  const next = text[Symbol.iterator]().next();
  return next.done ? "" : next.value;
}

export class AmpBoxEditor extends CustomEditor {
  private cursorVisible = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private streamingPrompt: string | null = null;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    kb: KeybindingsManager,
    private fullTheme: Theme,
  ) {
    super(tui, theme, kb);
    this.startCursorBlink();
  }

  private startCursorBlink() {
    this.blinkTimer = setInterval(() => {
      if (!this.focused) {
        if (!this.cursorVisible) {
          this.cursorVisible = true;
          this.tui.requestRender();
        }
        return;
      }
      this.cursorVisible = !this.cursorVisible;
      this.tui.requestRender();
    }, 1000);
  }

  setStreamingPrompt(prompt: string | null): void {
    if (this.streamingPrompt === prompt) return;
    this.streamingPrompt = prompt;
    this.tui.requestRender();
  }

  /** Clean up blink timer when editor is replaced. */
  dispose() {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
  }

  private color(colorName: Parameters<Theme["fg"]>[0], text: string): string {
    try {
      return this.fullTheme.fg(colorName, text);
    } catch {
      return text;
    }
  }

  render(width: number): string[] {
    const text = this.getText();
    const isShell = text.startsWith("!");

    // Prompt:  for normal mode, ≈/≋ wave while streaming, $ for shell mode.
    const prompt = editorPromptForState({ isShell, streamingPrompt: this.streamingPrompt });
    const promptW = visibleWidth(prompt);
    const promptThemed = this.color("accent", prompt);

    const Bg = (s: string) => {
      try {
        if (isShell) {
          return this.fullTheme.bg("userMessageBg", s);
        }
        return this.fullTheme.bg("customMessageBg", s);
      } catch {
        return s;
      }
    };

    const padX = 1;
    const padY = 1;
    const bgWidth = width;
    const bodyWidth = Math.max(1, bgWidth - padX * 2);
    const textAreaW = Math.max(1, bodyWidth - promptW);
    const sidePad = " ".repeat(padX);

    const bgLine = (content = "") => {
      const padded = padRight(content, bgWidth);
      return truncateToWidth(Bg(padded), width);
    };

    // Content lines with cursor
    const contentLines = this.renderInputLines(text, textAreaW);

    const lines: string[] = [];

    for (let i = 0; i < padY; i++) lines.push(bgLine());

    // Content with prompt on first line
    if (contentLines.length === 0) {
      const cursor = this.focused ? CURSOR_MARKER : "";
      // Line: outer margin + bg-colored area (left pad + prompt + cursor + fill + right pad)
      const inputFill = " ".repeat(Math.max(0, bodyWidth - promptW - 1));
      const lineContent =
        sidePad +
        promptThemed +
        cursor +
        "\x1b[7m \x1b[27m" +
        inputFill +
        sidePad;
      lines.push(bgLine(lineContent));
    } else {
      for (let i = 0; i < contentLines.length; i++) {
        const isFirst = i === 0;
        const p = isFirst ? promptThemed : "";
        const pw = isFirst ? promptW : 0;
        // Pad content so trailing spaces receive the background color too.
        const lineContent =
          sidePad + p + padRight(contentLines[i], bodyWidth - pw) + sidePad;
        lines.push(bgLine(lineContent));
      }
    }

    for (let i = 0; i < padY; i++) lines.push(bgLine());

    // Update lastWidth for visual-line cursor navigation (normally set by Editor.render)
    (this as any).lastWidth = textAreaW;

    // Render autocomplete list directly (avoids double-render via super.render)
    const ac = this as any;
    const hasAutocomplete = ac.autocompleteState && ac.autocompleteList;
    lines.push(""); // breathing room before footer or autocomplete
    if (hasAutocomplete) {
      const autocompleteIndent = " ".repeat(padX);
      const autocompleteWidth = Math.max(
        20,
        width - visibleWidth(autocompleteIndent),
      );
      const autocompleteResult = ac.autocompleteList.render(autocompleteWidth);
      if (autocompleteResult.length > 0) {
        for (const al of autocompleteResult) {
          const vw = visibleWidth(al);
          lines.push(
            autocompleteIndent +
              al +
              " ".repeat(
                Math.max(0, width - visibleWidth(autocompleteIndent) - vw),
              ),
          );
        }
      }
    }

    return lines;
  }

  private renderInputLines(text: string, width: number): string[] {
    const isShell = text.startsWith("!");
    // In shell mode, hide the leading "!" from display
    const displayText = isShell ? text.slice(1) : text;
    const logicalLines = displayText.length > 0 ? displayText.split("\n") : [];
    const cursor = this.getCursor();
    // Shift cursor column left by 1 only on line 0 (where hidden "!" is)
    const cursorCol =
      isShell && cursor.line === 0 ? Math.max(0, cursor.col - 1) : cursor.col;
    const cursorLine = Math.max(
      0,
      Math.min(cursor.line, logicalLines.length - 1),
    );
    const rendered: string[] = [];

    for (let i = 0; i < logicalLines.length; i++) {
      const raw = logicalLines[i] ?? "";
      const isCursorLine = i === cursorLine;
      let line = raw;

      if (isCursorLine) {
        const col = Math.max(0, Math.min(cursorCol, raw.length));
        const before = raw.slice(0, col);
        const after = raw.slice(col);
        const glyph = firstCodePoint(after);
        const atCursor = glyph || " ";
        const rest = glyph ? after.slice(glyph.length) : after;
        const marker = this.focused ? CURSOR_MARKER : "";
        // Blink: skip the inverse block cursor when cursorVisible is false
        if (this.cursorVisible) {
          line = `${before}${marker}\x1b[7m${atCursor}\x1b[27m${rest}`;
        } else {
          line = `${before}${marker}${atCursor}${rest}`;
        }
      }

      const wrapped = wrapTextWithAnsi(line, width);
      rendered.push(...(wrapped.length > 0 ? wrapped : [""]));
    }

    return rendered;
  }

  // extractAutocomplete removed — autocomplete is now rendered directly
  // from this.autocompleteList.render() in the render() method above.
}
