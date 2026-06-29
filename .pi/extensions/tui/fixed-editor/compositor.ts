/**
 * FixedEditorCompositor — splits terminal into scrollable messages (top)
 * and fixed editor cluster (bottom).
 *
 * Inspired by nicobailon/pi-powerline-footer and sting8k/pi-droid-styling.
 *
 * Key design decisions:
 *  - Scroll region only sent on change (pi-droid-styling optimization)
 *  - doRender wraps: invalidates cache, paints cluster separately after render pass
 *  - Painting guard prevents reentrant writes
 *  - Editor input handling is NOT touched — up/down history preserved
 *  - Cluster cached until editor/footer/widget state or terminal size changes
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { type FixedClusterInput, type FixedClusterOutput, renderFixedCluster } from "./cluster.js";
import { stripAnsi } from "../helpers.js";
import {
  beginSynchronizedOutput,
  clearLine,
  disableAutoWrap,
  disableMouseReporting,
  emergencyTerminalModeReset,
  enableAutoWrap,
  enableMouseReporting,
  endSynchronizedOutput,
  hideCursor,
  moveCursor,
  overrideColumns,
  padLineToWidth,
  resetScrollRegion,
  restoreCursor,
  sanitizeLine,
  saveCursor,
  setScrollRegion,
  showCursor,
  sliceColumns,
} from "./terminal-escape.js";
import {
  type KeyboardScrollShortcuts,
  type ScrollAction,
  type SgrPacket,
  DEFAULT_KEYBOARD_SCROLL_SHORTCUTS,
  isLeftDrag,
  isLeftPress,
  isMouseRelease,
  isRightPress,
  mouseScrollDelta,
  parseScrollAction,
  parseSgrMouse,
} from "./input.js";

const MAX_RETAINED_ROOT_LINES = 2000;
// 0 = no streaming root-render cache. Every Pi render pass calls originalTuiRender
// for smooth streaming. Other optimizations (cluster repaint throttle, no
// unconditional cluster invalidation, retained line cap) still save memory.
// Set to >0 (e.g. 32) to trade ~50% fewer full renders for slight visible delay.
const STREAMING_ROOT_RENDER_THROTTLE_MS = 0;

// Re-export for backward compatibility (used by index.ts)
export { emergencyTerminalModeReset };

const DOUBLE_CLICK_MS = 500;
const CONTEXT_MENU_MOUSE_REPORTING_PAUSE_MS = 1200;
const CONTEXT_MENU_SELECTION_RESTORE_WINDOW_MS = 5000;
const CONTEXT_MENU_CLIPBOARD_RESTORE_INTERVAL_MS = 100;
const SCROLLBAR_TRACK = "\x1b[48;5;238m \x1b[0m";
const SCROLLBAR_THUMB = "\x1b[48;5;244m \x1b[0m";

// Shift+Enter sequences across terminals. The pi-tui editor's default
// new-line check (kb.matches on tui.input.newLine) only fires when the
// runtime keybinding system parses the data as "shift+enter", which
// depends on the terminal sending a recognized CSI sequence. To make
// shift+enter work reliably on any terminal — not just ones that have
// completed the kitty keyboard protocol handshake — we intercept the
// common raw sequences here and transform them to a plain LF. The
// underlying editor's `(data === "\n" && data.length === 1)` condition
// then inserts a newline.
const SHIFT_ENTER_PATTERNS: readonly RegExp[] = [
  /^\x1b\[13;2u$/,    // Kitty CSI u: ESC [ Ps;Pu (shift+enter)
  /^\x1b\[13;2~$/,    // xterm modifyOtherKeys (without u protocol)
  /^\x1b\[27;2;13~$/, // xterm modifyOtherKeys CSI 27;modifier;key~
  /^\x1b\r$/,          // Legacy xterm / mintty: ESC + CR
  /^\x1b\[Z$/,         // rxvt / urxvt: ESC [ Z
  /^\x1bO2u$/,         // WezTerm SS3 with kitty modifier
];

function isShiftEnter(data: string): boolean {
  for (const pattern of SHIFT_ENTER_PATTERNS) {
    if (pattern.test(data)) return true;
  }
  return false;
}

// ── Renderable patch ────────────────────────────────────────────────────────

interface PatchedRenderable {
  render(width: number): string[];
}

interface RenderPatch {
  target: PatchedRenderable;
  originalRender: (width: number) => string[];
}

type SelectionArea = "root" | "cluster" | "sidebar";

interface SelectionPoint {
  line: number;
  col: number;
}

interface SelectionLocation {
  area: SelectionArea;
  point: SelectionPoint;
}

function compareSelectionPoints(a: SelectionPoint, b: SelectionPoint): number {
  return a.line === b.line ? a.col - b.col : a.line - b.line;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export interface CompositorHooks {
  getEditorLines: (width: number) => string[];
  getEditorText?: () => string;
  getStatusLines?: (width: number) => string[];
  getAboveWidgetLines?: (width: number) => string[];
  getBelowWidgetLines?: (width: number) => string[];
  getTranscriptLines?: (width: number) => string[];
  getFooterLines?: (width: number) => string[];
  getRenderStateKey?: () => string | undefined;
  getSidebarWidth?: (terminalWidth: number) => number;
  getSidebarLines?: (width: number, height: number) => string[];
  getShowHardwareCursor?: () => boolean;
  isStreaming?: () => boolean;
  keyboardScrollShortcuts?: KeyboardScrollShortcuts;
  onCopySelection?: (text: string) => void | Promise<void>;
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

interface RootFrameCache {
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

// ── Compositor ──────────────────────────────────────────────────────────────

export class FixedEditorCompositor {
  private tui: any;
  private terminal: any;
  private hooks: CompositorHooks;
  private installed = false;
  private disposed = false;

  // Saved originals
  private originalRowsDescriptor: PropertyDescriptor | undefined;
  private originalWrite: (data: string) => void;
  private originalTuiRender: ((width: number) => string[]) | null = null;
  private originalTuiDoRender: (() => void) | null = null;

  // Editor render bypass
  private renderPatches: RenderPatch[] = [];

  // Input listener handle
  private removeInputListener: (() => void) | null = null;

  // Scroll state
  private scrollOffset = 0;
  private maxScrollOffset = 0;
  private lastRootLineCount = 0;
  private lastRenderWidth = 0;
  private rootLineBase = 0;
  private rootLines: string[] = [];
  private visibleRootStart = 0;
  private visibleScrollableRows = 0;
  private visibleRootLines: string[] = [];
  private visibleClusterLines: string[] = [];
  private visibleSidebarLines: string[] = [];

  // Cluster cache
  private cachedWidth = 0;
  private cachedRawRows = 0;
  private cachedCluster: FixedClusterOutput | null = null;
  private cachedEditorText = "";
  private cachedRootFrame: RootFrameCache | null = null;

  // Scroll region — only re-send when changed (pi-droid-styling pattern)
  private scrollRegionBottom = 0;

  // Guards
  private painting = false;
  private renderPassActive = false;
  private renderingCluster = false;
  private checkingOverlay = false;

  // Diagnostics
  private interceptedWrites = 0;
  private rootRenderPasses = 0;
  private fullViewportRepaints = 0;
  private clusterOnlyRepaints = 0;
  private rootRenderCacheHits = 0;
  private rootRenderCacheMisses = 0;

  // Selection/copy
  private selectionArea: SelectionArea | null = null;
  private selectionAnchor: SelectionPoint | null = null;
  private selectionFocus: SelectionPoint | null = null;
  private selectionDragging = false;
  private selectionHighlightVisible = false;
  private preserveSelectionFocusOnRelease = false;
  private lastLeftPress: { area: SelectionArea; line: number; at: number } | null = null;
  private copiedSelectionText: string | null = null;
  private mouseReportingResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private clipboardRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollbarDragging = false;

  // Emergency cleanup
  private emergencyCleanup: (() => void) | null = null;

  constructor(tui: any, terminal: any, hooks: CompositorHooks) {
    this.tui = tui;
    this.terminal = terminal;
    this.hooks = hooks;
    this.originalWrite = terminal.write.bind(terminal);
    this.originalRowsDescriptor = this.resolveRowsDescriptor(terminal);
  }

  /** Install the compositor. */
  install(): void {
    if (this.installed) return;
    if (typeof this.terminal.write !== "function") {
      throw new Error("[pi-tui] FixedEditorCompositor: terminal.write is required");
    }

    // ── 1. Override terminal.rows ──────────────────────────────────────
    Object.defineProperty(this.terminal, "rows", {
      configurable: true,
      get: () => this.getScrollableRows(),
    });

    // ── 2. Patch tui.render ────────────────────────────────────────────
    if (typeof this.tui.render === "function") {
      this.originalTuiRender = this.tui.render.bind(this.tui);
      this.tui.render = (width: number) => this.renderScrollableRoot(width);
    }

    // ── 3. Wrap doRender — paint cluster after render pass ───────────
    // NOTE: do NOT invalidateCluster() here. The cluster is stable during
    // streaming (user isn't typing). Invalidation is driven by refreshUI(),
    // tool_result, and other state-change callbacks. Unconditional
    // invalidation here forces a full cluster re-render on every render
    // pass (~60 fps during streaming) despite the 500ms repaint throttle.
    if (typeof this.tui.doRender === "function") {
      this.originalTuiDoRender = this.tui.doRender.bind(this.tui);
      this.tui.doRender = () => {
        this.renderPassActive = true;
        try {
          this.originalTuiDoRender?.();
          this.repaintFixedCluster();
        } finally {
          this.renderPassActive = false;
        }
      };
    }

    // ── 4. Wrap terminal.write ─────────────────────────────────────────
    this.terminal.write = (data: string) => this.write(data);

    // ── 5. Input listener for scroll ───────────────────────────────────
    if (typeof this.tui.addInputListener === "function") {
      this.removeInputListener = this.tui.addInputListener(
        (data: string) => this.handleInput(data),
      );
    }

    // ── 6. Enable SGR mouse wheel reporting for fixed-zone scrolling ───
    this.originalWrite(enableMouseReporting());

    // ── 7. Emergency cleanup on exit ───────────────────────────────────
    this.emergencyCleanup = () => {
      if (!this.disposed) this.restoreTerminalState();
    };
    process.once("exit", this.emergencyCleanup);

    this.installed = true;
  }

  /** Hide a renderable component. */
  hideRenderable(target: PatchedRenderable): void {
    if (this.renderPatches.some((p) => p.target === target)) return;
    const orig = target.render.bind(target);
    this.renderPatches.push({ target, originalRender: orig });
    target.render = () => [];
  }

  /** Restore stale hidden render patches so old UI container graphs are not retained. */
  retainHiddenRenderables(targets: Array<PatchedRenderable | null | undefined>): void {
    const retained = new Set(targets.filter((target): target is PatchedRenderable => !!target));
    for (let i = this.renderPatches.length - 1; i >= 0; i--) {
      const patch = this.renderPatches[i];
      if (retained.has(patch.target)) continue;
      patch.target.render = patch.originalRender;
      this.renderPatches.splice(i, 1);
    }
  }

  /** Get a hidden renderable's original render output. */
  renderHidden(target: PatchedRenderable, width: number): string[] {
    const patch = this.renderPatches.find((p) => p.target === target);
    const render = patch?.originalRender ?? target.render.bind(target);
    return render(width);
  }

  /** Dispose — restore all state. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const p of this.renderPatches.splice(0)) {
      p.target.render = p.originalRender;
    }

    this.removeInputListener?.();
    this.removeInputListener = null;
    if (this.mouseReportingResumeTimer) {
      clearTimeout(this.mouseReportingResumeTimer);
      this.mouseReportingResumeTimer = null;
    }
    if (this.clipboardRestoreTimer) {
      clearTimeout(this.clipboardRestoreTimer);
      this.clipboardRestoreTimer = null;
    }

    this.terminal.write = this.originalWrite;

    if (this.originalTuiRender) {
      this.tui.render = this.originalTuiRender;
    }
    if (this.originalTuiDoRender) {
      this.tui.doRender = this.originalTuiDoRender;
    }

    if (this.originalRowsDescriptor) {
      Object.defineProperty(this.terminal, "rows", this.originalRowsDescriptor);
    } else {
      Reflect.deleteProperty(this.terminal, "rows");
    }

    if (this.emergencyCleanup) {
      process.removeListener("exit", this.emergencyCleanup);
      this.emergencyCleanup = null;
    }

    this.restoreTerminalState();
  }

  /** Jump scroll to bottom (offset = 0). */
  jumpToBottom(): boolean {
    if (this.disposed || this.scrollOffset === 0) return false;
    const width = Math.max(1, this.terminal.columns || 80);
    this.clearSelection();
    this.scrollOffset = 0;
    this.repaintScrollableViewport(width);
    this.requestRender();
    return true;
  }

  /** Best-effort emergency terminal mode reset without disposing the compositor. */
  resetTerminalState(): void {
    this.restoreTerminalState();
  }

  /** Read-only diagnostics for performance/memory troubleshooting. */
  getDiagnostics(): FixedEditorCompositorDiagnostics {
    return {
      installed: this.installed,
      disposed: this.disposed,
      hiddenRenderPatches: this.renderPatches.length,
      retainedRootLines: this.rootLines.length,
      rootLineBase: this.rootLineBase,
      lastRootLineCount: this.lastRootLineCount,
      visibleScrollableRows: this.visibleScrollableRows,
      visibleClusterLines: this.visibleClusterLines.length,
      visibleSidebarLines: this.visibleSidebarLines.length,
      scrollOffset: this.scrollOffset,
      maxScrollOffset: this.maxScrollOffset,
      cachedClusterLines: this.cachedCluster?.lines.length ?? 0,
      cachedWidth: this.cachedWidth,
      cachedRawRows: this.cachedRawRows,
      scrollRegionBottom: this.scrollRegionBottom,
      interceptedWrites: this.interceptedWrites,
      rootRenderPasses: this.rootRenderPasses,
      fullViewportRepaints: this.fullViewportRepaints,
      clusterOnlyRepaints: this.clusterOnlyRepaints,
      rootRenderCacheHits: this.rootRenderCacheHits,
      rootRenderCacheMisses: this.rootRenderCacheMisses,
      streamingRootRenderThrottleMs: STREAMING_ROOT_RENDER_THROTTLE_MS,
      streamingClusterRepaintThrottleMs: 0,
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private resolveRowsDescriptor(t: any): PropertyDescriptor | undefined {
    let target: any = t;
    while (target) {
      const desc = Object.getOwnPropertyDescriptor(target, "rows");
      if (desc) return desc;
      target = Object.getPrototypeOf(target);
    }
    return undefined;
  }

  private getRawRows(): number {
    if (this.originalRowsDescriptor?.get) {
      const value = this.originalRowsDescriptor.get.call(this.terminal);
      return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 24;
    }
    const value = this.originalRowsDescriptor?.value;
    return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 24;
  }

  private getScrollableRows(): number {
    const raw = this.getRawRows();
    if (this.disposed || this.painting || this.renderingCluster || this.hasVisibleOverlay()) return raw;
    const w = Math.max(1, this.terminal.columns || 80);
    const cluster = this.getCachedCluster(w, raw);
    return Math.max(1, raw - cluster.lines.length);
  }

  private hasVisibleOverlay(): boolean {
    if (this.checkingOverlay) return false;
    this.checkingOverlay = true;
    try {
      if (typeof this.tui?.hasOverlay === "function") {
        return !!this.tui.hasOverlay();
      }
      const stack = this.tui?.overlayStack;
      return Array.isArray(stack) && stack.length > 0;
    } catch {
      return false;
    } finally {
      this.checkingOverlay = false;
    }
  }

  private getSidebarWidth(width: number): number {
    const requested = this.hooks.getSidebarWidth?.(width) ?? 0;
    if (!Number.isFinite(requested) || requested <= 0 || width < 40) return 0;
    return Math.max(0, Math.min(Math.floor(requested), width - 20));
  }

  private getMainWidth(width: number): number {
    return Math.max(1, width - this.getSidebarWidth(width));
  }

  private withTerminalColumns<T>(columns: number, fn: () => T): T {
    const terminalOverride = overrideColumns(this.terminal, columns);
    const stdoutOverride = overrideColumns(process.stdout, columns);
    const stderrOverride = overrideColumns(process.stderr, columns);

    try {
      return fn();
    } finally {
      stderrOverride();
      stdoutOverride();
      terminalOverride();
    }
  }

  private getSidebarRows(width: number, rawRows: number): string[] {
    const sidebarWidth = this.getSidebarWidth(width);
    if (sidebarWidth <= 0) return [];
    const lines = this.hooks.getSidebarLines?.(sidebarWidth, rawRows) ?? [];
    const rows = Array.from({ length: rawRows }, (_, index) => padLineToWidth(lines[index] ?? "", sidebarWidth));
    this.visibleSidebarLines = rows;
    return rows;
  }

  private renderSidebarRow(row: string, rowIndex: number): string {
    if (!row) return row;
    return this.renderSelectionHighlight(row, rowIndex, "sidebar");
  }

  private getCachedCluster(width: number, rawRows: number): FixedClusterOutput {
    // Always recompute the cluster. The cluster is small (5-15 lines) and the
    // individual hooks (editor render, status lines, footer) are lightweight.
    // Caching here would freeze the animated working indicator spinner and add
    // complexity for negligible allocation savings.
    const mainWidth = this.getMainWidth(width);
    this.renderingCluster = true;
    try {
      const cluster = this.withTerminalColumns(mainWidth, () => {
        const input: FixedClusterInput = {
          width: mainWidth,
          terminalRows: rawRows,
          statusLines: this.hooks.getStatusLines?.(mainWidth),
          aboveWidgetLines: this.hooks.getAboveWidgetLines?.(mainWidth),
          editorLines: this.hooks.getEditorLines(mainWidth),
          belowWidgetLines: this.hooks.getBelowWidgetLines?.(mainWidth),
          transcriptLines: this.hooks.getTranscriptLines?.(mainWidth),
          footerLines: this.hooks.getFooterLines?.(mainWidth),
        };
        return renderFixedCluster(input);
      });

      this.cachedWidth = width;
      this.cachedRawRows = rawRows;
      this.cachedCluster = cluster;
      this.visibleClusterLines = this.cachedCluster.lines;
      return this.cachedCluster;
    } finally {
      this.renderingCluster = false;
    }
  }


  invalidateCluster(): void {
    this.cachedCluster = null;
  }

  /** Sync scroll region only when changed (pi-droid-styling optimization). */
  private syncScrollRegion(bottom: number): void {
    if (this.scrollRegionBottom === bottom) return;
    this.scrollRegionBottom = bottom;
    this.originalWrite(saveCursor() + setScrollRegion(1, bottom) + restoreCursor());
  }

  private paintCluster(cluster: FixedClusterOutput, rawRows: number, width: number): string {
    if (cluster.lines.length === 0) return "";

    const startRow = Math.max(1, rawRows - cluster.lines.length + 1);
    let buf = "";

    const mainWidth = this.getMainWidth(width);
    for (let i = 0; i < cluster.lines.length; i++) {
      buf += moveCursor(startRow + i, 1);
      buf += clearLine();
      const main = sanitizeLine(this.renderSelectionHighlight(cluster.lines[i] ?? "", i, "cluster"), mainWidth);
      buf += padLineToWidth(main, width);
    }

    // Hardware cursor
    const showHardware = this.hooks.getShowHardwareCursor?.() ?? false;
    if (cluster.cursor && showHardware) {
      buf += moveCursor(startRow + cluster.cursor.row, Math.max(1, cluster.cursor.col + 1));
      buf += showCursor();
    } else {
      buf += hideCursor();
    }

    return buf;
  }

  /**
   * Paint only the fixed cluster after a normal TUI render pass.
   * Always paints (no time throttle) — the cluster output is cached and only
   * recomputed when the cluster state key changes. Skipping the paint causes
   * the cluster area to show stale/garbage content until the next paint,
   * visible as "footer flashing".
   */
  private paintSidebarOverlay(width: number, rawRows: number): string {
    const sidebarWidth = this.getSidebarWidth(width);
    if (sidebarWidth <= 0) return "";
    const sidebarRows = this.getSidebarRows(width, rawRows);
    const overlayCol = width - sidebarWidth + 1;
    let buf = "";
    for (let i = 0; i < Math.min(sidebarRows.length, rawRows); i++) {
      const row = sidebarRows[i];
      if (!row || visibleWidth(stripAnsi(row)) === 0) continue;
      buf += moveCursor(i + 1, overlayCol);
      buf += this.renderSidebarRow(row, i);
    }
    return buf;
  }

  private repaintFixedCluster(): void {
    if (this.disposed || this.painting || this.hasVisibleOverlay()) return;

    const rawRows = this.getRawRows();
    const width = Math.max(1, this.terminal.columns || 80);
    const cluster = this.getCachedCluster(width, rawRows);
    if (cluster.lines.length === 0 || rawRows <= 2) return;

    this.painting = true;
    this.clusterOnlyRepaints++;
    try {
      this.originalWrite(
        beginSynchronizedOutput() +
          disableAutoWrap() +
          this.paintCluster(cluster, rawRows, width) +
          this.paintSidebarOverlay(width, rawRows) +
          enableAutoWrap() +
          enableMouseReporting() +
          endSynchronizedOutput(),
      );
    } finally {
      this.painting = false;
    }
  }

  /** Standalone repaint — called after layout/sidebar/selection updates. */
  requestRepaint(): void {
    if (this.disposed || this.painting || this.hasVisibleOverlay()) return;
    const width = Math.max(1, this.terminal.columns || 80);
    this.repaintScrollableViewport(width);
  }

  /** Intercepted terminal.write. */
  private write(data: string): void {
    this.interceptedWrites++;
    const overlayVisible = this.hasVisibleOverlay();
    if (this.painting || this.disposed || overlayVisible) {
      if (overlayVisible && !this.painting && !this.disposed) {
        this.syncScrollRegion(this.getRawRows());
      }
      this.originalWrite(data);
      return;
    }

    this.painting = true;
    try {
      const rawRows = this.getRawRows();
      const width = Math.max(1, this.terminal.columns || 80);
      const cluster = this.getCachedCluster(width, rawRows);
      const clusterHeight = cluster.lines.length;

      if (clusterHeight === 0 || rawRows <= 2) {
        this.syncScrollRegion(rawRows);
        this.originalWrite(data);
        return;
      }

      const scrollBottom = rawRows - clusterHeight;
      this.syncScrollRegion(scrollBottom);

      // During render pass, write data only — repaintFixedCluster() paints cluster + sidebar afterward.
      // Outside render pass, append cluster paint and sidebar overlay to data.
      const body = this.renderPassActive
        ? data
        : data + this.paintCluster(cluster, rawRows, width) + this.paintSidebarOverlay(width, rawRows);
      this.originalWrite(
        beginSynchronizedOutput() +
          disableAutoWrap() +
          body +
          enableAutoWrap() +
          enableMouseReporting() +
          endSynchronizedOutput(),
      );
    } finally {
      this.painting = false;
    }
  }

  /** Intercepted tui.render — clip to scrollable window. */
  private renderScrollableRoot(width: number): string[] {
    if (!this.originalTuiRender || this.disposed) {
      return this.originalTuiRender?.(width) ?? [];
    }

    this.rootRenderPasses++;
    this.lastRenderWidth = Math.max(1, width);
    const rawRows = this.getRawRows();
    const cluster = this.getCachedCluster(width, rawRows);
    const scrollableRows = Math.max(1, rawRows - cluster.lines.length);
    const mainWidth = this.getMainWidth(width);
    const now = Date.now();

    const cached = this.reusableRootFrame(now, width, rawRows, mainWidth, cluster.lines.length);
    if (cached) {
      this.rootRenderCacheHits++;
      this.visibleRootStart = cached.visibleRootStart;
      this.visibleScrollableRows = cached.visibleScrollableRows;
      this.visibleRootLines = cached.visibleRootLines;
      this.visibleSidebarLines = cached.visibleSidebarLines;
      return cached.lines;
    }
    this.rootRenderCacheMisses++;

    const allLines = this.withTerminalColumns(mainWidth, () => this.originalTuiRender?.(mainWidth) ?? []);
    const retainedBase = Math.max(0, allLines.length - MAX_RETAINED_ROOT_LINES);
    const retainedLines = retainedBase > 0 ? allLines.slice(retainedBase) : allLines;
    this.rootLineBase = retainedBase;
    this.rootLines = retainedLines;

    if (this.scrollOffset > 0 && this.lastRootLineCount > 0 && allLines.length > this.lastRootLineCount) {
      this.scrollOffset += allLines.length - this.lastRootLineCount;
    }
    this.lastRootLineCount = allLines.length;
    this.maxScrollOffset = Math.max(0, retainedLines.length - scrollableRows);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.maxScrollOffset));

    const retainedStart = Math.max(0, retainedLines.length - scrollableRows - this.scrollOffset);
    const visible = retainedLines.slice(retainedStart, retainedStart + scrollableRows);
    const globalStart = retainedBase + retainedStart;

    while (visible.length < scrollableRows) {
      visible.push("");
    }

    this.getSidebarRows(width, rawRows);
    this.visibleRootStart = globalStart;
    this.visibleScrollableRows = scrollableRows;
    this.visibleRootLines = visible;
    const rendered = visible.map((line, index) => {
      const main = this.renderScrollableLine(line, globalStart + index, index, mainWidth);
      return padLineToWidth(main, mainWidth);
    });

    if (this.canCacheRootFrame()) {
      this.cachedRootFrame = {
        width,
        rawRows,
        mainWidth,
        clusterHeight: cluster.lines.length,
        scrollOffset: this.scrollOffset,
        renderedAt: now,
        lines: rendered,
        visibleRootStart: globalStart,
        visibleScrollableRows: scrollableRows,
        visibleRootLines: visible,
        visibleSidebarLines: this.visibleSidebarLines,
      };
    } else {
      this.cachedRootFrame = null;
    }

    return rendered;
  }

  private canCacheRootFrame(): boolean {
    return Boolean(
      this.hooks.isStreaming?.() &&
        !this.selectionHighlightVisible &&
        !this.selectionDragging &&
        !this.scrollbarDragging,
    );
  }

  private reusableRootFrame(
    now: number,
    width: number,
    rawRows: number,
    mainWidth: number,
    clusterHeight: number,
  ): RootFrameCache | null {
    if (STREAMING_ROOT_RENDER_THROTTLE_MS === 0) return null;
    const cached = this.cachedRootFrame;
    if (!cached || !this.canCacheRootFrame()) return null;
    if (now - cached.renderedAt >= STREAMING_ROOT_RENDER_THROTTLE_MS) return null;
    if (cached.width !== width || cached.rawRows !== rawRows || cached.mainWidth !== mainWidth) return null;
    if (cached.clusterHeight !== clusterHeight || cached.scrollOffset !== this.scrollOffset) return null;
    return cached;
  }

  private requestRender(): void {
    if (typeof this.tui.requestRender === "function") {
      this.tui.requestRender();
    }
  }

  /** Handle scroll input — only intercepts scroll keys, passes everything else through. */
  private handleInput(data: string): { consume?: boolean; data?: string } | undefined {
    if (this.disposed || this.hasVisibleOverlay()) return undefined;

    // Transform Shift+Enter to a plain newline. The underlying editor's
    // new-line check matches "\n" (one char), so passing "\n" through
    // here inserts a newline without firing the submit keybinding
    // (which expects "\r"). This catches terminals that haven't
    // completed the kitty keyboard protocol handshake at startup.
    //
    // Do NOT set `consume: true` — the TUI's input dispatcher returns
    // early when consume is true, and the transformed "\n" would never
    // reach the editor. Just return the new data; the TUI passes it
    // through to the focused component (the editor).
    if (isShiftEnter(data)) {
      return { data: "\n" };
    }

    const packets = parseSgrMouse(data);
    if (packets) {
      let consumed = false;
      for (const pkt of packets) {
        consumed = this.handleMousePacket(pkt) || consumed;
      }
      return consumed ? { consume: true } : undefined;
    }

    // Keyboard scroll/navigation — page, configured shortcuts, and top/bottom jumps.
    const action = parseScrollAction(data, this.hooks.keyboardScrollShortcuts);
    if (action) {
      if (action.kind === "scroll") this.scrollBy(action.delta);
      if (action.kind === "top") this.jumpToTop();
      if (action.kind === "bottom") this.jumpToBottom();
      return { consume: true };
    }

    // ⚡ Everything else (including up/down arrows for history) → pass through
    return undefined;
  }

  private scrollBy(delta: number): void {
    const width = Math.max(1, this.terminal.columns || 80);
    this.renderScrollableRoot(width);

    const nextOffset = Math.max(0, Math.min(
      this.scrollOffset + delta,
      this.maxScrollOffset,
    ));

    if (nextOffset === this.scrollOffset) return;

    this.clearSelection();
    this.scrollOffset = nextOffset;
    this.repaintScrollableViewport(width);
    this.requestRender();
  }

  private jumpToTop(): boolean {
    const width = Math.max(1, this.terminal.columns || 80);
    this.renderScrollableRoot(width);
    if (this.scrollOffset === this.maxScrollOffset) return false;
    this.clearSelection();
    this.scrollOffset = this.maxScrollOffset;
    this.repaintScrollableViewport(width);
    this.requestRender();
    return true;
  }

  private repaintScrollableViewport(width: number): void {
    if (this.disposed || this.painting || this.hasVisibleOverlay()) return;

    this.fullViewportRepaints++;
    const rawRows = this.getRawRows();
    const cluster = this.getCachedCluster(width, rawRows);
    const scrollableRows = Math.max(1, rawRows - cluster.lines.length);
    const visible = this.renderScrollableRoot(width);

    this.painting = true;
    try {
      let buffer = setScrollRegion(1, scrollableRows) + moveCursor(1, 1);
      for (let row = 0; row < scrollableRows; row++) {
        if (row > 0) buffer += "\r\n";
        buffer += clearLine() + sanitizeLine(visible[row] ?? "", width);
      }
      buffer += this.paintCluster(cluster, rawRows, width);
      buffer += this.paintSidebarOverlay(width, rawRows);

      this.originalWrite(
        beginSynchronizedOutput() +
          disableAutoWrap() +
          buffer +
          enableAutoWrap() +
          enableMouseReporting() +
          endSynchronizedOutput(),
      );
    } finally {
      this.painting = false;
    }
  }

  private handleMousePacket(pkt: SgrPacket): boolean {
    const delta = mouseScrollDelta(pkt);
    if (delta !== 0) {
      this.clearSelection();
      this.scrollBy(delta);
      return true;
    }

    if (this.handleScrollbarPacket(pkt)) return true;

    if (!this.hooks.onCopySelection) return false;

    const location = this.selectionLocationForPacket(pkt);
    if (isRightPress(pkt)) {
      const selectedText = this.isLocationInsideSelection(location) ? this.getSelectedText() : "";
      if (selectedText) {
        this.copiedSelectionText = selectedText;
        void this.hooks.onCopySelection(selectedText);
      } else {
        this.clearSelection();
      }
      this.lastLeftPress = null;
      this.pauseMouseReportingForContextMenu(selectedText || null);
      return true;
    }

    if (this.scrollSelectionAtViewportEdge(pkt)) return true;

    if (isLeftPress(pkt) && location) {
      this.startSelection(location);
      return true;
    }

    if (this.selectionDragging && isLeftDrag(pkt) && location?.area === this.selectionArea) {
      this.lastLeftPress = null;
      this.preserveSelectionFocusOnRelease = false;
      this.selectionFocus = location.point;
      this.copySelectionIfChanged();
      this.repaintSelection();
      return true;
    }

    if (this.selectionDragging && isMouseRelease(pkt)) {
      if (!this.preserveSelectionFocusOnRelease) {
        this.selectionFocus = location?.area === this.selectionArea
          ? location.point
          : this.clampedSelectionPointForPacket(pkt, this.selectionArea);
      }
      this.preserveSelectionFocusOnRelease = false;
      this.selectionDragging = false;
      this.selectionHighlightVisible = false;
      const selectedText = this.copySelectionIfChanged();
      if (selectedText) {
        this.lastLeftPress = null;
      } else {
        this.clearSelection();
      }
      this.repaintSelection();
      return true;
    }

    return false;
  }

  private startSelection(location: SelectionLocation): void {
    const now = Date.now();
    const line = location.point.line;
    if (
      this.lastLeftPress &&
      this.lastLeftPress.area === location.area &&
      this.lastLeftPress.line === line &&
      now - this.lastLeftPress.at <= DOUBLE_CLICK_MS
    ) {
      this.selectionArea = location.area;
      this.selectionAnchor = { line, col: 0 };
      this.selectionFocus = { line, col: this.selectionLineWidth(location.area, line) };
      this.selectionDragging = true;
      this.selectionHighlightVisible = true;
      this.preserveSelectionFocusOnRelease = true;
      this.lastLeftPress = null;
      this.copySelectionIfChanged();
      this.repaintSelection();
      return;
    }

    this.selectionArea = location.area;
    this.selectionAnchor = location.point;
    this.selectionFocus = location.point;
    this.selectionDragging = true;
    this.selectionHighlightVisible = true;
    this.preserveSelectionFocusOnRelease = false;
    this.copiedSelectionText = null;
    this.lastLeftPress = { area: location.area, line, at: now };
    this.repaintSelection();
  }

  private handleScrollbarPacket(pkt: SgrPacket): boolean {
    if (!this.isScrollbarPacket(pkt)) {
      if (this.scrollbarDragging && isMouseRelease(pkt)) {
        this.scrollbarDragging = false;
        return true;
      }
      return false;
    }

    if (isLeftPress(pkt)) {
      this.scrollbarDragging = true;
      this.scrollToScrollbarRow(pkt.row);
      return true;
    }

    if (this.scrollbarDragging && isLeftDrag(pkt)) {
      this.scrollToScrollbarRow(pkt.row);
      return true;
    }

    if (this.scrollbarDragging && isMouseRelease(pkt)) {
      this.scrollbarDragging = false;
      return true;
    }

    return false;
  }

  private isScrollbarPacket(pkt: SgrPacket): boolean {
    const width = this.lastRenderWidth || Math.max(1, this.terminal.columns || 80);
    const mainWidth = this.getMainWidth(width);
    return (
      this.maxScrollOffset > 0 &&
      this.visibleScrollableRows > 1 &&
      pkt.row >= 1 &&
      pkt.row <= this.visibleScrollableRows &&
      pkt.col === mainWidth
    );
  }

  private scrollToScrollbarRow(row: number): void {
    const rows = Math.max(1, this.visibleScrollableRows);
    const clampedRow = Math.max(1, Math.min(row, rows));
    const ratioFromTop = rows <= 1 ? 0 : (clampedRow - 1) / (rows - 1);
    const nextOffset = Math.max(0, Math.min(this.maxScrollOffset, Math.round((1 - ratioFromTop) * this.maxScrollOffset)));
    if (nextOffset === this.scrollOffset) return;
    const wasDraggingScrollbar = this.scrollbarDragging;
    this.clearSelection();
    this.scrollbarDragging = wasDraggingScrollbar;
    this.scrollOffset = nextOffset;
    this.repaintScrollableViewport(this.lastRenderWidth || Math.max(1, this.terminal.columns || 80));
    this.requestRender();
  }

  private selectionLocationForPacket(pkt: SgrPacket): SelectionLocation | null {
    if (pkt.row < 1) return null;
    const width = this.lastRenderWidth || Math.max(1, this.terminal.columns || 80);
    const mainWidth = this.getMainWidth(width);
    if (pkt.col > mainWidth) {
      const sidebarWidth = this.getSidebarWidth(width);
      if (sidebarWidth <= 0 || pkt.col > mainWidth + sidebarWidth || pkt.row > this.visibleSidebarLines.length) return null;
      return { area: "sidebar", point: { line: pkt.row - 1, col: Math.max(0, pkt.col - mainWidth - 1) } };
    }
    const col = Math.max(0, pkt.col - 1);
    if (pkt.row <= this.visibleScrollableRows) {
      return { area: "root", point: { line: this.visibleRootStart + pkt.row - 1, col } };
    }
    const clusterLine = pkt.row - this.visibleScrollableRows - 1;
    if (clusterLine < 0 || clusterLine >= this.visibleClusterLines.length) return null;
    return { area: "cluster", point: { line: clusterLine, col } };
  }

  private scrollSelectionAtViewportEdge(pkt: SgrPacket): boolean {
    if (!this.selectionDragging || this.selectionArea !== "root" || !isLeftDrag(pkt)) return false;

    const delta = pkt.row <= 1 ? 1 : pkt.row >= this.visibleScrollableRows ? -1 : 0;
    if (delta === 0) return false;

    const nextOffset = Math.max(0, Math.min(this.scrollOffset + delta, this.maxScrollOffset));
    if (nextOffset === this.scrollOffset) return false;

    this.lastLeftPress = null;
    this.preserveSelectionFocusOnRelease = true;
    this.scrollOffset = nextOffset;
    const start = this.updateVisibleRootWindow();
    const edgeLine = delta > 0 ? start : start + Math.max(0, this.visibleScrollableRows - 1);
    this.selectionFocus = { line: edgeLine, col: Math.max(0, pkt.col - 1) };
    this.selectionHighlightVisible = true;
    this.copySelectionIfChanged();
    this.repaintSelection();
    return true;
  }

  private updateVisibleRootWindow(scrollableRows = this.visibleScrollableRows): number {
    const rows = Math.max(1, scrollableRows);
    const retainedStart = Math.max(0, this.rootLines.length - rows - this.scrollOffset);
    const visible = this.rootLines.slice(retainedStart, retainedStart + rows);
    const globalStart = this.rootLineBase + retainedStart;
    while (visible.length < rows) visible.push("");
    this.visibleRootStart = globalStart;
    this.visibleScrollableRows = rows;
    this.visibleRootLines = visible;
    return globalStart;
  }

  private rootLineAt(lineIndex: number): string {
    const retainedIndex = lineIndex - this.rootLineBase;
    return retainedIndex >= 0 && retainedIndex < this.rootLines.length
      ? this.rootLines[retainedIndex]
      : "";
  }

  private copySelectionIfChanged(): string {
    const selectedText = this.getSelectedText();
    if (!selectedText || selectedText === this.copiedSelectionText) return selectedText;
    this.copiedSelectionText = selectedText;
    void this.hooks.onCopySelection?.(selectedText);
    return selectedText;
  }

  private repaintSelection(): void {
    const width = Math.max(1, this.terminal.columns || 80);
    if (this.selectionArea === "cluster") {
      this.requestRepaint();
    } else {
      this.repaintScrollableViewport(width);
    }
    this.requestRender();
  }

  private clampedSelectionPointForPacket(pkt: SgrPacket, area: SelectionArea | null): SelectionPoint {
    const width = this.lastRenderWidth || Math.max(1, this.terminal.columns || 80);
    const mainWidth = this.getMainWidth(width);
    if (area === "cluster") {
      return {
        line: Math.max(0, Math.min(pkt.row - this.visibleScrollableRows - 1, Math.max(0, this.visibleClusterLines.length - 1))),
        col: Math.max(0, Math.min(pkt.col - 1, mainWidth - 1)),
      };
    }
    if (area === "sidebar") {
      return {
        line: Math.max(0, Math.min(pkt.row - 1, Math.max(0, this.visibleSidebarLines.length - 1))),
        col: Math.max(0, pkt.col - mainWidth - 1),
      };
    }
    const row = Math.max(1, Math.min(pkt.row, Math.max(1, this.visibleScrollableRows)));
    return { line: this.visibleRootStart + row - 1, col: Math.max(0, Math.min(pkt.col - 1, mainWidth - 1)) };
  }

  private renderScrollableLine(line: string, lineIndex: number, viewportIndex: number, width: number): string {
    const highlighted = this.renderSelectionHighlight(line, lineIndex, "root");
    return this.decorateScrollbar(highlighted, viewportIndex, width);
  }

  private decorateScrollbar(line: string, viewportIndex: number, width: number): string {
    if (width <= 1 || this.maxScrollOffset <= 0 || this.visibleScrollableRows <= 1) return line;

    const rows = Math.max(1, this.visibleScrollableRows);
    const total = Math.max(rows, this.rootLines.length || this.lastRootLineCount);
    const thumbRows = Math.max(1, Math.min(rows, Math.floor((rows * rows) / total)));
    const travel = Math.max(0, rows - thumbRows);
    const ratioFromTop = 1 - (this.scrollOffset / Math.max(1, this.maxScrollOffset));
    const thumbStart = Math.max(0, Math.min(travel, Math.round(ratioFromTop * travel)));
    const marker = viewportIndex >= thumbStart && viewportIndex < thumbStart + thumbRows ? SCROLLBAR_THUMB : SCROLLBAR_TRACK;
    return padLineToWidth(line, width - 1) + marker;
  }

  private renderSelectionHighlight(line: string, lineIndex: number, area: SelectionArea): string {
    if (!this.selectionHighlightVisible) return line;
    const range = this.getSelectionRangeForLine(lineIndex, area);
    if (!range) return line;

    const plain = stripAnsi(line);
    const startCol = Math.max(0, Math.min(range.startCol, visibleWidth(plain)));
    const endCol = Math.max(startCol, Math.min(range.endCol, visibleWidth(plain)));
    if (startCol === endCol) return line;

    const before = sliceColumns(plain, 0, startCol);
    const selected = sliceColumns(plain, startCol, endCol);
    const after = sliceColumns(plain, endCol, Number.POSITIVE_INFINITY);
    return `${before}\x1b[7m${selected}\x1b[27m${after}`;
  }

  private selectionLineWidth(area: SelectionArea, lineIndex: number): number {
    if (area === "root") return visibleWidth(stripAnsi(this.rootLineAt(lineIndex)));
    const lines = area === "sidebar" ? this.visibleSidebarLines : this.visibleClusterLines;
    return visibleWidth(stripAnsi(lines[lineIndex] ?? ""));
  }

  private getSelectionRangeForLine(lineIndex: number, area: SelectionArea): { startCol: number; endCol: number } | null {
    if (this.selectionArea !== area || !this.selectionAnchor || !this.selectionFocus) return null;
    const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0
      ? this.selectionAnchor
      : this.selectionFocus;
    const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
    if (lineIndex < start.line || lineIndex > end.line) return null;
    return {
      startCol: lineIndex === start.line ? start.col : 0,
      endCol: lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY,
    };
  }

  private isLocationInsideSelection(location: SelectionLocation | null): boolean {
    if (!location || location.area !== this.selectionArea) return false;
    const range = this.getSelectionRangeForLine(location.point.line, location.area);
    return Boolean(range && location.point.col >= range.startCol && location.point.col < range.endCol);
  }

  private getSelectedText(): string {
    if (!this.selectionArea || !this.selectionAnchor || !this.selectionFocus) return "";
    const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0
      ? this.selectionAnchor
      : this.selectionFocus;
    const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
    if (start.line === end.line && start.col === end.col) return "";

    const lines = this.selectionArea === "sidebar" ? this.visibleSidebarLines : this.visibleClusterLines;
    const selected: string[] = [];
    for (let lineIndex = start.line; lineIndex <= end.line; lineIndex++) {
      const sourceLine = this.selectionArea === "root" ? this.rootLineAt(lineIndex) : lines[lineIndex] ?? "";
      const line = stripAnsi(sourceLine);
      const startCol = lineIndex === start.line ? start.col : 0;
      const endCol = lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY;
      selected.push(sliceColumns(line, startCol, endCol));
    }
    return selected.join("\n").replace(/[ \t]+$/gm, "").trimEnd();
  }

  private clearSelection(): void {
    this.selectionArea = null;
    this.selectionAnchor = null;
    this.selectionFocus = null;
    this.selectionDragging = false;
    this.selectionHighlightVisible = false;
    this.preserveSelectionFocusOnRelease = false;
    this.copiedSelectionText = null;
    this.scrollbarDragging = false;
  }

  private pauseMouseReportingForContextMenu(textToRestoreToClipboard: string | null = null): void {
    if (this.mouseReportingResumeTimer) clearTimeout(this.mouseReportingResumeTimer);
    if (this.clipboardRestoreTimer) {
      clearTimeout(this.clipboardRestoreTimer);
      this.clipboardRestoreTimer = null;
    }

    this.originalWrite(beginSynchronizedOutput() + disableMouseReporting() + endSynchronizedOutput());
    const timer = setTimeout(() => {
      this.mouseReportingResumeTimer = null;
      if (!this.disposed) {
        this.originalWrite(beginSynchronizedOutput() + enableMouseReporting() + endSynchronizedOutput());
      }
    }, CONTEXT_MENU_MOUSE_REPORTING_PAUSE_MS);
    this.mouseReportingResumeTimer = timer;
    (timer as { unref?: () => void } | null)?.unref?.();

    if (!textToRestoreToClipboard || !this.hooks.onCopySelection) return;
    let remainingRestores = Math.ceil(CONTEXT_MENU_SELECTION_RESTORE_WINDOW_MS / CONTEXT_MENU_CLIPBOARD_RESTORE_INTERVAL_MS);
    const scheduleClipboardRestore = () => {
      const restoreTimer = setTimeout(() => {
        this.clipboardRestoreTimer = null;
        if (this.disposed) return;
        remainingRestores -= 1;
        if (this.getSelectedText() === textToRestoreToClipboard) {
          void this.hooks.onCopySelection?.(textToRestoreToClipboard);
          if (remainingRestores > 0) scheduleClipboardRestore();
        }
      }, CONTEXT_MENU_CLIPBOARD_RESTORE_INTERVAL_MS);
      this.clipboardRestoreTimer = restoreTimer;
      (restoreTimer as { unref?: () => void } | null)?.unref?.();
    };
    scheduleClipboardRestore();
  }

  private restoreTerminalState(): void {
    try {
      this.originalWrite(emergencyTerminalModeReset());
    } catch {
      // Best-effort cleanup during exit
    }
  }
}
