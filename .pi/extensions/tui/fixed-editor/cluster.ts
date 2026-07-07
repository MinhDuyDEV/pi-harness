/**
 * Fixed-editor cluster: packs editor + status + footer into reserved bottom rows.
 *
 * Layout (top to bottom):
 *   [status]        — working/thinking indicator
 *   [above widgets] — queue + widgets above editor
 *   [footer]        — model label, tokens, cost (above editor to avoid streaming overlap)
 *   [editor]        — input editor
 *   [below widgets] — todos widget
 *   [transcript]    — bash output
 *
 * Allocation priority: editor > footer > above > below > status > transcript.
 * Cursor marker extraction is also handled here so the compositor
 * can paint a hardware cursor when one is available.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../helpers.js";

export const CURSOR_MARKER = "\x1b_pi:c\x07";

/** Max rows the cluster can consume (reserved from the bottom). */
const MAX_CLUSTER_ROWS = 20;

export interface FixedClusterInput {
  width: number;
  terminalRows: number;
  statusLines?: string[];
  aboveWidgetLines?: string[];
  editorLines: string[];
  belowWidgetLines?: string[];
  transcriptLines?: string[];
  footerLines?: string[];
}

export interface FixedCursorPos {
  row: number;
  col: number;
}

export interface FixedClusterOutput {
  lines: string[];
  cursor: FixedCursorPos | null;
}

/** Normalize lines — filter nulls, truncate to width. */
function norm(lines: string[] | undefined, width: number): string[] {
  if (!lines || width <= 0) return [];
  return lines
    .filter((l) => l != null)
    .map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width, "", true) : l));
}

/** Take the last N lines (tail). */
function takeTail(lines: string[], n: number): string[] {
  if (n <= 0) return [];
  return lines.length <= n ? lines : lines.slice(lines.length - n);
}

/**
 * Pin editor lines — show the section around the cursor when lines
 * exceed the available space (like the base Editor does internally).
 */
function pinEditorLines(lines: string[], max: number): string[] {
  if (max <= 0) return [];
  if (lines.length <= max) return lines;

  // Try to find the cursor marker row first.
  const cursorRow = lines.findIndex((l) => l.includes(CURSOR_MARKER));
  if (cursorRow !== -1) {
    const start = Math.max(0, Math.min(cursorRow - max + 1, lines.length - max));
    return lines.slice(start, start + max);
  }

  // Selector/autocomplete replacements often mark the active row with "→".
  const selectedRow = lines.findIndex((l) => stripAnsi(l).trimStart().startsWith("→ "));
  if (selectedRow !== -1) {
    const start = Math.max(0, Math.min(selectedRow - Math.floor(max / 2), lines.length - max));
    return lines.slice(start, start + max);
  }

  return lines.slice(0, max);
}

/** Extract the CURSOR_MARKER from rendered lines, returning cleaned lines + cursor position. */
export function extractCursor(lines: string[]): FixedClusterOutput {
  let cursor: FixedCursorPos | null = null;
  const cleaned = lines.map((line, row) => {
    const idx = line.indexOf(CURSOR_MARKER);
    if (idx === -1) return line;
    if (!cursor) {
      cursor = { row, col: visibleWidth(line.slice(0, idx)) };
    }
    // Remove the marker
    return line.slice(0, idx) + line.slice(idx + CURSOR_MARKER.length);
  });
  return { lines: cleaned, cursor };
}

/**
 * Render the fixed editor cluster.
 *
 * Layout (top to bottom):
 *   [status]        — Pi working/status container
 *   [above widgets] — widgets above editor
 *   [footer]        — Pi/custom footer (above editor to avoid streaming overlap)
 *   [editor]        — whole editor container, including autocomplete replacements
 *   [below widgets] — widgets below editor
 *   [transcript]    — optional fixed transcript lines
 */
export function renderFixedCluster(input: FixedClusterInput): FixedClusterOutput {
  const { width } = input;
  const maxRows = Math.max(1, Math.min(input.terminalRows - 1, MAX_CLUSTER_ROWS));

  // Editor+footer get first claim; other widgets use leftover rows.
  let remaining = maxRows;

  const editorLines = pinEditorLines(norm(input.editorLines, width), remaining);
  remaining -= editorLines.length;

  const footerLines = takeTail(norm(input.footerLines, width), Math.min(3, remaining));
  remaining -= footerLines.length;

  const above = takeTail(norm(input.aboveWidgetLines, width), remaining);
  remaining -= above.length;

  const below = takeTail(norm(input.belowWidgetLines, width), remaining);
  remaining -= below.length;

  const status = takeTail(norm(input.statusLines, width), remaining);
  remaining -= status.length;

  const transcript = takeTail(norm(input.transcriptLines, width), remaining);

  return extractCursor([...status, ...above, ...footerLines, ...editorLines, ...below, ...transcript]);
}
