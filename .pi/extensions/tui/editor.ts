    /**
     * AmpBoxEditor: bordered editor with $ / $$ prompt.
     *
     * Layout:
     *     ──────────────────────
     *      $ text here            $ = editor mode, $$ = shell mode (! prefix)
     *     ──────────────────────
     */
import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
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
    import {
  editorBorderColorForThinkingLevel,
  editorPromptColorForThinkingLevel,
  editorPromptForState,
  normalizeThinkingLevel,
} from "./editor-prompt.js";

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
  private thinkingLevel = "medium";


  constructor(
    tui: TUI,
    theme: EditorTheme,
    kb: KeybindingsManager,
    private fullTheme: Theme,
    editorPaddingX: number = 0,
    thinkingLevel: string = "medium",
  ) {

        super(tui, theme, kb);
        // Clamp to pi's documented 0-3 range. Mirrors the top-level
        // `editorPaddingX` UI setting. Non-finite values default to 0.
    const clamped = Number.isFinite(editorPaddingX)
      ? Math.max(0, Math.min(3, Math.trunc(editorPaddingX)))
      : 0;
    this.setPaddingX(clamped);
    this.thinkingLevel = normalizeThinkingLevel(thinkingLevel);
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

  setThinkingLevel(level: string): void {
    const normalized = normalizeThinkingLevel(level);
    if (this.thinkingLevel === normalized) return;
    this.thinkingLevel = normalized;
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

    // Prompt + border respond to the active thinking budget.
    const prompt = editorPromptForState({
      isShell,
      streamingPrompt: this.streamingPrompt,
      thinkingLevel: this.thinkingLevel,
    });
    const promptW = visibleWidth(prompt);
    const borderColorName = editorBorderColorForThinkingLevel(this.thinkingLevel);
    const promptColorName = editorPromptColorForThinkingLevel(this.thinkingLevel);
    const promptThemed = this.color(promptColorName, prompt);

    const border = this.color(borderColorName, "─".repeat(width));


        const padX = this.getPaddingX();
        const bodyWidth = Math.max(1, width - padX * 2);
        const textAreaW = Math.max(1, bodyWidth - promptW);
        const sidePad = " ".repeat(padX);

        // Content lines with cursor
        const contentLines = this.renderInputLines(text, textAreaW);

        const lines: string[] = [];

        // Top border
        lines.push(border);

        // Content with prompt on first line
        if (contentLines.length === 0) {
          const cursor = this.focused ? CURSOR_MARKER : "";
          // Line: side padding + prompt + cursor + fill + side padding
          const inputFill = " ".repeat(Math.max(0, bodyWidth - promptW - 1));
          const lineContent =
            sidePad +
            promptThemed +
            cursor +
            "\x1b[7m \x1b[27m" +
            inputFill +
            sidePad;
          lines.push(truncateToWidth(lineContent, width));
        } else {
          for (let i = 0; i < contentLines.length; i++) {
            const isFirst = i === 0;
            const p = isFirst ? promptThemed : "";
            const pw = isFirst ? promptW : 0;
            // Pad content to fill the row, then add side padding on both ends.
            const lineContent =
              sidePad + p + padRight(contentLines[i], bodyWidth - pw) + sidePad;
            lines.push(truncateToWidth(lineContent, width));
          }
        }

        // Bottom border
        lines.push(border);

        // Update lastWidth for visual-line cursor navigation (normally set by Editor.render)
        (this as any).lastWidth = textAreaW;

        // Render autocomplete list directly (avoids double-render via super.render)
        const ac = this as any;
        const hasAutocomplete = ac.autocompleteState && ac.autocompleteList;
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

