import type { KeyboardScrollShortcuts } from "./input.js";
import type { Point, SelectionArea } from "./selection-state.js";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Double-click window for line selection (ms). */
export const DOUBLE_CLICK_MS = 400;

/** Maximum root lines retained for scroll-back (2000 matches original hard limit). */
export const MAX_RETAINED_ROOT_LINES = 2_000;

/** Throttle root render cache reuse during streaming (0 = no root caching during streaming). */
export const STREAMING_ROOT_RENDER_THROTTLE_MS = 0;

/** Root-frame cache TTL for non-streaming renders. A short window lets the
 *  compositor reuse the most recent root frame for the follow-up render that
 *  pi-tui schedules after a scroll input, eliminating the redundant second
 *  root render per scroll step. Disabled during streaming to keep frames live. */
export const ROOT_RENDER_FRAME_CACHE_MS = 16;
/** Scrollbar characters. */
export const SCROLLBAR_THUMB = "\x1b[48;5;244m \x1b[0m";
export const SCROLLBAR_TRACK = "\x1b[48;5;238m \x1b[0m";

/** Context menu mouse reporting pause duration (ms). */
export const CONTEXT_MENU_MOUSE_REPORTING_PAUSE_MS = 1_200;

/** Clipboard restore retry window for context menus (ms). */
export const CONTEXT_MENU_SELECTION_RESTORE_WINDOW_MS = 5_000;

/** Interval between clipboard restore attempts (ms). */
export const CONTEXT_MENU_CLIPBOARD_RESTORE_INTERVAL_MS = 100;

// ── Newline key patterns ───────────────────────────────────────────────────────

const NEWLINE_KEY_PATTERNS: RegExp[] = [
  // kitty protocol (Shift+Enter)
  /^\x1b\[13;2u$/,
  // DEC 7-bit (Shift+Enter)
  /^\x1bOM$/,
  // DEC 8-bit (Shift+Enter)
  /^\x1b\[27;2;13~$/,
  // Kitty protocol (Ctrl+J)
  /^\x1b\[10;5u$/,
  /^\x1bO2u$/,
  /^\x1b\[27;5;106~$/,
  /^\x1b\[106;5u$/,
  /^\x1bO5u$/,
];

export function isNewlineKey(data: string): boolean {
  for (const pattern of NEWLINE_KEY_PATTERNS) {
    if (pattern.test(data)) return true;
  }
  return false;
}

// ── Types ───────────────────────────────────────────────────────────────────────

/** Cache entry for a root frame during streaming. */
export interface RootFrameCache {
  width: number;
  rawRows: number;
  mainWidth: number;
  clusterHeight: number;
  scrollOffset: number;
  renderedAt: number;
  lines: string[];
  visibleRootStart: number;
  visibleScrollableRows: number;
  visibleRootLines: string[];
  visibleSidebarLines: string[];
}

export interface SelectionInteraction {
  area: SelectionArea | null;
  anchor: Point | null;
  focus: Point | null;
  dragging: boolean;
  highlightVisible: boolean;
  preserveFocusOnRelease: boolean;
  lastLeftPress: { area: SelectionArea; line: number; at: number } | null;
  copiedText: string | null;
  scrollbarDragging: boolean;
}

export function createInteraction(): SelectionInteraction {
  return {
    area: null,
    anchor: null,
    focus: null,
    dragging: false,
    highlightVisible: false,
    preserveFocusOnRelease: false,
    lastLeftPress: null,
    copiedText: null,
    scrollbarDragging: false,
  };
}


// ── Hooks ───────────────────────────────────────────────────────────────────────

export interface CompositorHooks {
  getEditorLines: (width: number) => string[];
  getEditorText?: () => string;
  getStatusLines?: (width: number) => string[];
  getAboveWidgetLines?: (width: number) => string[];
  getBelowWidgetLines?: (width: number) => string[];
  getTranscriptLines?: (width: number) => string[];
  getFooterLines?: (width: number) => string[];
  onCopySelection?: (text: string) => Promise<void>;
  getSidebarLines?: (width: number, rows: number) => string[];
  getSidebarWidth?: (width: number) => number;
  getShowHardwareCursor?: () => boolean;
  keyboardScrollShortcuts?: KeyboardScrollShortcuts;
  isStreaming?: () => boolean;
}

export interface FixedEditorCompositorDiagnostics {
  installed: boolean;
  disposed: boolean;
  hiddenRenderPatches: number;
  retainedRootLines: number;
  rootLineBase: number;
  lastRootLineCount: number;
  visibleScrollableRows: number;
  visibleClusterLines: number;
  visibleSidebarLines: number;
  scrollOffset: number;
  maxScrollOffset: number;
  cachedClusterLines: number;
  cachedWidth: number;
  cachedRawRows: number;
  scrollRegionBottom: number;
  interceptedWrites: number;
  rootRenderPasses: number;
  fullViewportRepaints: number;
  clusterOnlyRepaints: number;
  rootRenderCacheHits: number;
  rootRenderCacheMisses: number;
  streamingRootRenderThrottleMs: number;
  streamingClusterRepaintThrottleMs: number;
}

