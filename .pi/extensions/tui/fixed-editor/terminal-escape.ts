/**
 * Terminal escape sequence helpers and utility functions.
 * Extracted from compositor.ts to reduce monolith size.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Terminal ESC sequence helpers ───────────────────────────────────────────

export function setScrollRegion(top: number, bottom: number): string {
  return `\x1b[${top};${bottom}r`;
}
export function resetScrollRegion(): string {
  return "\x1b[r";
}
export function moveCursor(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}
export function clearLine(): string {
  return "\x1b[2K";
}
export function hideCursor(): string {
  return "\x1b[?25l";
}
export function showCursor(): string {
  return "\x1b[?25h";
}
export function saveCursor(): string {
  return "\x1b[s";
}
export function restoreCursor(): string {
  return "\x1b[u";
}
export function enableMouseReporting(): string {
  return "\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?1007l";
}
export function disableMouseReporting(): string {
  return "\x1b[?1002l\x1b[?1000l\x1b[?1006l\x1b[?1007h";
}
export function beginSynchronizedOutput(): string {
  return "\x1b[?2026h";
}
export function endSynchronizedOutput(): string {
  return "\x1b[?2026l";
}
export function disableAutoWrap(): string {
  return "\x1b[?7l";
}
export function enableAutoWrap(): string {
  return "\x1b[?7h";
}
function enableAlternateScrollMode(): string {
  return "\x1b[?1007h";
}
function resetExtendedKeyboardModes(): string {
  return "\x1b[<999u\x1b[>4;0m";
}

export function emergencyTerminalModeReset(): string {
  return beginSynchronizedOutput()
    + resetScrollRegion()
    + enableAutoWrap()
    + showCursor()
    + disableMouseReporting()
    + enableAlternateScrollMode()
    + resetExtendedKeyboardModes()
    + endSynchronizedOutput();
}

// ── Utilities ───────────────────────────────────────────────────────────────

export function sanitizeLine(line: string, width: number): string {
  const vw = visibleWidth(line);
  if (vw <= width) return line;
  return truncateToWidth(line, width, "", true);
}

export function padLineToWidth(line: string, width: number): string {
  const sanitized = sanitizeLine(line, width);
  const padding = Math.max(0, width - visibleWidth(sanitized));
  return sanitized + " ".repeat(padding);
}

export function overrideColumns(target: { columns?: number } | undefined, columns: number): () => void {
  if (!target) return () => undefined;
  const descriptor = Object.getOwnPropertyDescriptor(target, "columns");
  const previous = target.columns;
  try {
    Object.defineProperty(target, "columns", {
      configurable: true,
      get: () => columns,
    });
    return () => {
      if (descriptor) {
        Object.defineProperty(target, "columns", descriptor);
      } else {
        Reflect.deleteProperty(target, "columns");
      }
    };
  } catch {
    try {
      target.columns = columns;
      return () => {
        try {
          target.columns = previous;
        } catch {
          // Best-effort restoration for unusual terminal objects.
        }
      };
    } catch {
      return () => undefined;
    }
  }
}

export function sliceColumns(text: string, startCol: number, endCol: number): string {
  let col = 0;
  let result = "";
  for (const char of Array.from(text)) {
    const width = Math.max(0, visibleWidth(char));
    if (col >= startCol && col < endCol) result += char;
    col += width;
  }
  return result;
}
