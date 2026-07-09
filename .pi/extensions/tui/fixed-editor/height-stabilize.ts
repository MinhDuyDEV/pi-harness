/**
 * Prevent pi-tui fullRender(true) when only the fixed-editor cluster height changed.
 *
 * pi-tui treats `terminal.rows` changes as physical resizes and emits:
 *   \x1b[2J\x1b[H\x1b[3J
 * That full clear is the black flash + scrollback wipe ("scroll to bottom") when
 * slash autocomplete / selectors grow the bottom cluster.
 *
 * The compositor still reports scrollableRows via onRows (so pi-tui never writes
 * past the DECSTBM region). This helper only rewinds tui.previousHeight so
 * doRender takes the differential path instead of a full clear.
 */

export type HeightStabilizeState = {
  lastTrackedRawRows: number;
};

export type PiTuiHeightFields = {
  previousHeight?: number;
  previousLines?: string[];
  previousViewportTop?: number;
};

export function createHeightStabilizeState(): HeightStabilizeState {
  return { lastTrackedRawRows: -1 };
}

/**
 * @returns true when a cluster-driven height change was suppressed
 */
export function suppressClusterDrivenHeightChange(
  state: HeightStabilizeState,
  tui: PiTuiHeightFields,
  rawRows: number,
  scrollableRows: number,
): boolean {
  // Real terminal resize: leave pi-tui alone so it full-clears correctly.
  if (rawRows !== state.lastTrackedRawRows) {
    state.lastTrackedRawRows = rawRows;
    return false;
  }

  const prevH = tui.previousHeight ?? 0;
  if (prevH <= 0 || prevH === scrollableRows) return false;

  // Cluster-only change (autocomplete, selectors, overlay open/close).
  tui.previousHeight = scrollableRows;
  if (typeof tui.previousViewportTop === "number") {
    // Fixed-editor always windows content to exactly scrollableRows → viewportTop 0.
    tui.previousViewportTop = 0;
  }

  // Avoid differential path fullRender(true) when extraLines > height on large shrinks.
  if (Array.isArray(tui.previousLines) && tui.previousLines.length > scrollableRows) {
    // Keep the bottom of the previous window (matches offset=0 pin-to-bottom).
    tui.previousLines = tui.previousLines.slice(-scrollableRows);
  }

  return true;
}
