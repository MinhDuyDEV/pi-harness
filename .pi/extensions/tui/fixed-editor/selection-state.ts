/**
 * selection-state.ts — Pure selection geometry for split-area text selection.
 *
 * Handles:
 *  — Selection begin/extend/finish across "root", "cluster", and "sidebar" areas
 *  — Ordered-point range computation (anchor can be before or after focus)
 *  — Line-range determination for highlight rendering
 *  — Get-selected-text extraction with ANSI stripping
 *  — Hit-test: point-in-selection for right-click context-menu behavior
 *  — Simple word-at-cursor detection for double-click
 *
 * All functions are deterministic and fully testable without a terminal.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type SelectionArea = "root" | "cluster" | "sidebar";

export interface Point {
  readonly line: number;
  readonly col: number;
}

export interface SelectionRange {
  readonly startCol: number;
  readonly endCol: number;
}

export interface SelectionState {
  readonly area: SelectionArea | null;
  readonly anchor: Point | null;
  readonly focus: Point | null;
  readonly highlightVisible: boolean;
  readonly dragging: boolean;
  readonly doubleClickLine: number | null;
}

// ── Constructors ──────────────────────────────────────────────────────────────

export function createSelectionState(): SelectionState {
  return {
    area: null,
    anchor: null,
    focus: null,
    highlightVisible: false,
    dragging: false,
    doubleClickLine: null,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function comparePoints(a: Point, b: Point): number {
  return a.line === b.line ? a.col - b.col : a.line - b.line;
}

function orderedEndpoints(
  anchor: Point,
  focus: Point,
): { start: Point; end: Point } {
  return comparePoints(anchor, focus) <= 0
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor };
}

// ── Mutations (pure) ──────────────────────────────────────────────────────────

/**
 * Begin a new selection at `point` in `area`.
 * If `isDoubleClick` is true, the selection sets col=0 on anchor and Infinity
 * on focus so the full line is covered (caller resolves Infinity to actual line width).
 */
export function beginSelection(
  state: SelectionState,
  area: SelectionArea,
  point: Point,
  isDoubleClick: boolean,
): SelectionState {
  if (isDoubleClick) {
    return {
      ...state,
      area,
      anchor: { ...point, col: 0 },
      focus: { ...point, col: Number.POSITIVE_INFINITY },
      highlightVisible: true,
      dragging: true,
      doubleClickLine: point.line,
    };
  }
  return {
    ...state,
    area,
    anchor: point,
    focus: point,
    highlightVisible: true,
    dragging: true,
    doubleClickLine: null,
  };
}

/**
 * Extend the selection to `point`. No-op if not dragging.
 */
export function extendSelection(
  state: SelectionState,
  point: Point,
): SelectionState {
  if (!state.dragging || state.area === null) return state;
  return { ...state, focus: point, doubleClickLine: null };
}

/**
 * Finish the selection (release mouse button).
 * If anchor === focus (zero-length), clears the selection.
 */
export function finishSelection(state: SelectionState): SelectionState {
  const isZeroLength =
    state.anchor !== null &&
    state.focus !== null &&
    comparePoints(state.anchor, state.focus) === 0;
  if (isZeroLength) return createSelectionState();
  return { ...state, dragging: false, highlightVisible: false, doubleClickLine: null };
}

/**
 * Clear the selection entirely.
 */
export function clearSelection(): SelectionState {
  return createSelectionState();
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Get the column range for a given line if it falls within the selection.
 * Returns null if the line is not selected.
 */
export function getSelectionRangeForLine(
  state: SelectionState,
  lineIndex: number,
  area: SelectionArea,
  lineWidth?: number,
): SelectionRange | null {
  if (state.area !== area || !state.anchor || !state.focus) return null;
  const ordered = orderedEndpoints(state.anchor, state.focus);
  if (lineIndex < ordered.start.line || lineIndex > ordered.end.line) return null;
  return {
    startCol: lineIndex === ordered.start.line ? ordered.start.col : 0,
    endCol:
      lineIndex === ordered.end.line
        ? lineWidth !== undefined
          ? Math.min(ordered.end.col, lineWidth)
          : ordered.end.col
        : Number.POSITIVE_INFINITY,
  };
}

/**
 * Test whether a given point is inside the selection (for right-click context menu).
 */
export function isInSelection(
  state: SelectionState,
  point: Point,
  area: SelectionArea,
): boolean {
  if (state.area !== area || !state.anchor || !state.focus) return false;
  const ordered = orderedEndpoints(state.anchor, state.focus);
  // Quick range check by line
  if (point.line < ordered.start.line || point.line > ordered.end.line) return false;
  if (point.line === ordered.start.line && point.col < ordered.start.col) return false;
  if (point.line === ordered.end.line && point.col >= ordered.end.col) return false;
  return true;
}

/**
 * Compute the combined selected text across lines in the given area.
 * `getLineContent` is called by the caller to retrieve raw content per line.
 * `stripAnsiFn` strips ANSI escape codes; `sliceColumnsFn` slices by column.
 */
export function getSelectionText(
  state: SelectionState,
  getLineContent: (area: SelectionArea, lineIndex: number) => string | null,
  stripAnsiFn: (s: string) => string,
  sliceColumnsFn: (s: string, start: number, end: number) => string,
): string {
  if (!state.area || !state.anchor || !state.focus) return "";
  const ordered = orderedEndpoints(state.anchor, state.focus);
  if (ordered.start.line === ordered.end.line && ordered.start.col === ordered.end.col) {
    return "";
  }
  const lines: string[] = [];
  for (let lineIndex = ordered.start.line; lineIndex <= ordered.end.line; lineIndex++) {
    const sourceLine = getLineContent(state.area, lineIndex);
    if (sourceLine === null) continue;
    const plain = stripAnsiFn(sourceLine);
    const startCol = lineIndex === ordered.start.line ? ordered.start.col : 0;
    const endCol = lineIndex === ordered.end.line ? ordered.end.col : Number.POSITIVE_INFINITY;
    lines.push(sliceColumnsFn(plain, startCol, endCol));
  }
  return lines.join("\n").replace(/[ \t]+$/gm, "").trimEnd();
}

/**
 * Render a line with selection highlight (inverse video).
 * If the line is not selected, returns the line unchanged.
 */
export function renderHighlightOnLine(
  line: string,
  lineIndex: number,
  area: SelectionArea,
  state: SelectionState,
  stripAnsiFn: (s: string) => string,
  sliceColumnsFn: (s: string, start: number, end?: number) => string,
): string {
  if (!state.highlightVisible || state.area !== area) return line;
  const rng = getSelectionRangeForLine(state, lineIndex, area);
  if (!rng) return line;
  const startCol = Math.max(0, rng.startCol);
  const endCol = Math.max(startCol, rng.endCol);
  if (startCol >= endCol) return line;
  const plain = stripAnsiFn(line);
  const before = sliceColumnsFn(plain, 0, startCol);
  const selected = sliceColumnsFn(plain, startCol, endCol);
  const after = sliceColumnsFn(plain, endCol, Number.POSITIVE_INFINITY);
  return `${before}\x1b[7m${selected}\x1b[27m${after}`;
}

/**
 * Find the word boundaries at a given column on a line.
 * Returns the start/end columns of the word, or the column itself if no word found.
 */
export function wordRangeAtColumn(line: string, col: number): SelectionRange {
  const stripped = line.replace(/\x1b\[[\d;]*[a-zA-Z]/g, "");
  // Find word boundaries using regex
  const wordPattern = /[\w\u00C0-\u024F]+/g;
  let match: RegExpExecArray | null;
  let best: SelectionRange | null = null;
  while ((match = wordPattern.exec(stripped)) !== null) {
    if (match.index <= col && col <= match.index + match[0].length) {
      best = { startCol: match.index, endCol: match.index + match[0].length };
      break;
    }
    if (!best && match.index > col) {
      best = { startCol: match.index, endCol: match.index + match[0].length };
      break;
    }
  }
  return best ?? { startCol: col, endCol: col + 1 };
}
