/**
 * scroll-state.ts — Pure scroll offset/range math.
 *
 * All functions are deterministic, side-effect-free, and fully testable.
 * A ScrollState is a plain frozen object — identity change means state change.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScrollState {
  readonly offset: number;
  readonly maxOffset: number;
  readonly totalLines: number;
  readonly viewportRows: number;
}

export interface ScrollbarGeometry {
  readonly start: number;
  readonly height: number;
  readonly trackRows: number;
}

// ── Constructors ──────────────────────────────────────────────────────────────

export function createScrollState(viewportRows: number = 0): ScrollState {
  return { offset: 0, maxOffset: 0, totalLines: 0, viewportRows };
}

// ── Mutations (pure — return new state) ───────────────────────────────────────

/** Scroll by a delta (positive = up, negative = down). Returns same object if no change. */
export function scrollBy(state: ScrollState, delta: number): ScrollState {
  if (delta === 0) return state;
  const next = Math.max(0, Math.min(state.offset + delta, state.maxOffset));
  if (next === state.offset) return state;
  return { ...state, offset: next };
}

/** Scroll to an absolute offset. Clamped to [0, maxOffset]. */
export function scrollTo(state: ScrollState, offset: number): ScrollState {
  const clamped = Math.max(0, Math.min(offset, state.maxOffset));
  if (clamped === state.offset) return state;
  return { ...state, offset: clamped };
}

/** Scroll to make `line` visible, with optional padding above/below. */
export function scrollIntoView(
  state: ScrollState,
  line: number,
  linesAbove: number = 0,
  linesBelow: number = 0,
): ScrollState {
  const visibleStart = state.totalLines - state.viewportRows - state.offset;
  const visibleEnd = visibleStart + state.viewportRows;
  if (line >= visibleStart + linesAbove && line <= visibleEnd - linesBelow) return state;
  if (line < visibleStart + linesAbove) {
    return scrollTo(state, Math.max(0, state.totalLines - state.viewportRows - Math.max(0, line - linesAbove)));
  }
  return scrollTo(state, Math.max(0, state.totalLines - state.viewportRows - line + linesBelow));
}

/**
 * Update scroll state after a render pass with new total/visible dimensions.
 * When `isAtBottom` is true (user hasn't scrolled up), auto-scrolls to show new content.
 */
export function updateAfterRender(
  state: ScrollState,
  totalLines: number,
  viewportRows: number,
  isUserAtBottom: boolean,
): ScrollState {
  const newMax = Math.max(0, totalLines - viewportRows);
  const grown = totalLines - state.totalLines;
  let newOffset: number;
  if (isUserAtBottom || state.offset <= 0) {
    newOffset = 0;
  } else if (grown > 0) {
    newOffset = Math.min(state.offset + grown, newMax);
  } else {
    newOffset = Math.min(state.offset, newMax);
  }
  return { offset: newOffset, maxOffset: newMax, totalLines, viewportRows };
}

/** Update viewport size only (e.g., terminal resize). Clamps offset. */
export function updateViewport(state: ScrollState, viewportRows: number): ScrollState {
  if (viewportRows === state.viewportRows) return state;
  const newMax = Math.max(0, state.totalLines - viewportRows);
  return {
    ...state,
    offset: Math.min(state.offset, newMax),
    maxOffset: newMax,
    viewportRows,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function isAtBottom(state: ScrollState): boolean {
  return state.offset <= 0;
}

export function firstVisibleLine(state: ScrollState): number {
  return Math.max(0, state.totalLines - state.viewportRows - state.offset);
}

export function lastVisibleLine(state: ScrollState): number {
  return firstVisibleLine(state) + state.viewportRows;
}

/** Compute scrollbar thumb geometry. Returns null if no scrolling is needed. */
export function scrollbarGeometry(state: ScrollState, trackRows: number): ScrollbarGeometry | null {
  if (state.maxOffset <= 0 || trackRows <= 0 || state.totalLines <= 0) return null;
  const height = Math.max(1, Math.min(
    trackRows,
    Math.floor((trackRows * trackRows) / Math.max(1, state.totalLines)),
  ));
  const travel = trackRows - height;
  const ratio = state.maxOffset > 0 ? state.offset / state.maxOffset : 0;
  const start = Math.round((1 - ratio) * travel);
  return { start, height, trackRows };
}

/** Convert a scrollbar row into an effective scroll offset. */
export function scrollOffsetForRow(state: ScrollState, row: number, trackRows: number): number {
  if (trackRows <= 1) return state.maxOffset;
  const ratioFromTop = (row - 1) / (trackRows - 1);
  return Math.round((1 - ratioFromTop) * state.maxOffset);
}

/** Clip an absolute line number to viewport-relative row. Returns null if not visible. */
export function clipToViewport(state: ScrollState, absoluteLine: number): number | null {
  const first = firstVisibleLine(state);
  const last = first + state.viewportRows;
  if (absoluteLine < first || absoluteLine >= last) return null;
  return absoluteLine - first;
}

/** Map a scroll position delta to a ScrollState delta (matching mouse wheel direction convention). */
export function wheelToScrollOffset(scrollSpeed: number): number {
  return Math.max(1, Math.round(scrollSpeed * 3));
}
