/**
 * FixedEditorCompositor — splits terminal into scrollable messages (top)
 * and fixed editor cluster (bottom).
 *
 * Inspired by nicobailon/pi-powerline-footer and sting8k/pi-droid-styling.
 *
 * Key design decisions:
 *  - Delegates terminal patch lifecycle to TerminalManager
 *  - Uses scroll-state.ts for pure scroll offset/range math
 *  - Uses selection-state.ts for selection geometry
 *  - Uses PatchManager for renderable hide/restore lifecycle
 *  - Cluster painting, sidebar overlay, scroll region, selection interaction
 *    stay inline since they're too coupled to pi-tui internals to extract cleanly
 *  - Scroll region only sent on change (pi-droid-styling optimization)
 *  - doRender wraps: invalidates cache, paints cluster separately after render pass
 *  - Painting guard prevents reentrant writes
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
  restoreCursor,
  sanitizeLine,
  saveCursor,
  setScrollRegion,
  showCursor,
  sliceColumns,
} from "./terminal-escape.js";
import {
  type SgrPacket,
  isLeftDrag,
  isLeftPress,
  isMouseRelease,
  isRightPress,
  mouseScrollDelta,
  parseScrollAction,
  parseSgrMouse,
} from "./input.js";
import { PatchManager } from "./patch-manager.js";
import {
  type SelectionArea,
  type Point,
  createSelectionState,
  beginSelection,
  extendSelection,
  finishSelection,
  getSelectionRangeForLine,
  getSelectionText,
} from "./selection-state.js";
import { TerminalManager } from "./terminal-manager.js";
import {
  type ScrollState,
  createScrollState,
  scrollOffsetForRow,
} from "./scroll-state.js";
import {
  createHeightStabilizeState,
  suppressClusterDrivenHeightChange,
  type HeightStabilizeState,
} from "./height-stabilize.js";
type MutableScrollState = { -readonly [K in keyof ScrollState]: ScrollState[K] };

import {
  CONTEXT_MENU_CLIPBOARD_RESTORE_INTERVAL_MS,
  CONTEXT_MENU_MOUSE_REPORTING_PAUSE_MS,
  CONTEXT_MENU_SELECTION_RESTORE_WINDOW_MS,
  DOUBLE_CLICK_MS,
  MAX_RETAINED_ROOT_LINES,
  ROOT_RENDER_FRAME_CACHE_MS,
  SCROLLBAR_THUMB,
  SCROLLBAR_TRACK,
  STREAMING_ROOT_RENDER_THROTTLE_MS,
  createInteraction,
  isNewlineKey,
  type CompositorHooks,
  type FixedEditorCompositorDiagnostics,
  type RootFrameCache,
  type SelectionInteraction,
} from "./compositor-state.js";
export type { CompositorHooks, FixedEditorCompositorDiagnostics } from "./compositor-state.js";

// ── FixedEditorCompositor ───────────────────────────────────────────────────────

export class FixedEditorCompositor {
  // References
  private tui: any;
  private terminal: any;
  private hooks: CompositorHooks;

  // Lifecycle
  private installed = false;
  private disposed = false;

  // Terminal lifecycle manager
  private terminalManager: TerminalManager;

  // Patch manager (replaces inline renderPatches array)
  private patchManager: PatchManager;

  // Selection interaction state (uses selection-state for pure geometry)
  private sel: SelectionInteraction = createInteraction();
  private selectionState = createSelectionState();

  // Scroll state
  private scrollState: ScrollState = createScrollState();
  private rootLines: string[] = [];
  private rootLineBase = 0;
  private lastRootLineCount = 0;

  // Mouse reporting resume timer
  private mouseReportingResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private clipboardRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  // Emergency cleanup
  private emergencyCleanup: (() => void) | null = null;

  // Original references (captured before install to bypass patches)
  private originalWrite: (data: string) => void;
  private originalRowsGetter: (() => number) | null;
  private originalTuiRender: ((width: number) => string[]) | null = null;
  private originalTuiDoRender: (() => void) | null = null;

  // Scroll region — only re-send when changed (pi-droid-styling pattern)
  private scrollRegionBottom = 0;

  // Visible state
  private visibleRootStart = 0;
  private visibleScrollableRows = 0;
  private visibleRootLines: string[] = [];
  private visibleClusterLines: string[] = [];
  private visibleSidebarLines: string[] = [];
  private scrollbarThumbStart = 0;
  private scrollbarThumbRows = 0;
  private lastRenderWidth = 0;

  // Cluster cache — render-pass-scoped: computed once per doRender(), reused for all writes within that pass.
  private cachedCluster: FixedClusterOutput | null = null;
  private cachedWidth = 0;
  private cachedRawRows = 0;
  private renderPassCluster: { width: number; rawRows: number; cluster: FixedClusterOutput } | null = null;
  private invalidationPending = false;

  // Root frame cache for streaming throttle
  private cachedRootFrame: RootFrameCache | null = null;

  // Guards
  private painting = false;
  private renderPassActive = false;
  private renderingCluster = false;
  private repaintFlushQueued = false;
  private repaintDeferred = false;
  private checkingOverlay = false;
  /** Tracks physical terminal rows so cluster height churn does not full-clear. */
  private heightStabilize: HeightStabilizeState = createHeightStabilizeState();
  /** Last measured scrollable rows; used during re-entrant terminal.rows reads. */
  private lastScrollableRows: number | null = null;

  // Diagnostics
  private interceptedWrites = 0;
  private rootRenderPasses = 0;
  private fullViewportRepaints = 0;
  private clusterOnlyRepaints = 0;
  private rootRenderCacheHits = 0;
  private rootRenderCacheMisses = 0;

  constructor(tui: any, terminal: any, hooks: CompositorHooks) {
    this.tui = tui;
    this.terminal = terminal;
    this.hooks = hooks;
    this.originalWrite = terminal.write.bind(terminal);
    this.originalRowsGetter = this.resolveOriginalRowsGetter(terminal);
    this.originalTuiRender = typeof tui.render === "function" ? tui.render.bind(tui) : null;
    this.originalTuiDoRender = typeof tui.doRender === "function" ? tui.doRender.bind(tui) : null;
    this.patchManager = new PatchManager();
    this.terminalManager = new TerminalManager(tui, terminal);
    this.scrollState = createScrollState();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Install the compositor. */
  install(): void {
    try {
      if (this.installed) return;
      if (typeof this.terminal.write !== "function") {
        throw new Error("[pi-tui] FixedEditorCompositor: terminal.write is required");
      }

      // Delegate all patching to TerminalManager with compositor callbacks.
      // The TerminalManager snapshots originals and patches:
      //   terminal.write → this.write
      //   terminal.rows → this.getScrollableRows
      //   tui.render → this.renderScrollableRoot
      //   tui.doRender → repaintFixedCluster after render pass
      //   input listener → this.handleInput
      this.terminalManager.install({
        onWrite: (data) => this.write(data),
        onRows: () => this.getScrollableRows(),
        onInput: (data) => this.handleInput(data),
        onRender: (width) => this.renderScrollableRoot(width),
        onDoRender: () => {
          this.renderPassActive = true;
          this.renderPassCluster = null;
          // A render pass is the atomic boundary for the fixed cluster. Rebuild
          // it once per pass so streaming editor/footer content cannot remain
          // trapped in the previous pass's cache.
          this.cachedCluster = null;
          try {
            // Slash autocomplete / selectors grow the bottom cluster → onRows shrinks.
            // pi-tui treats that as a physical resize and full-clears (2J/3J) = black flash.
            // Measure after clearing pass cache so autocomplete height is current.
            // Rewind previousHeight for cluster-only changes; still full-clear on real resize.
            suppressClusterDrivenHeightChange(
              this.heightStabilize,
              this.tui,
              this.getRawRows(),
              this.getScrollableRows(),
            );
            this.originalTuiDoRender?.();
            // Editor.render re-enters terminal.rows mid-pass; re-sync if drifted.
            const post = this.getScrollableRows();
            const tuiAny = this.tui as { previousHeight?: number };
            if (
              tuiAny.previousHeight !== undefined &&
              tuiAny.previousHeight !== post
            ) {
              tuiAny.previousHeight = post;
            }
            this.repaintFixedCluster();
          } finally {
            this.renderPassActive = false;
            this.renderPassCluster = null;
            this.flushDeferredInvalidation();
          }
        },
      });

      // Enable SGR mouse wheel reporting for fixed-zone scrolling
      this.originalWrite(enableMouseReporting());

      // Emergency cleanup on exit
      this.emergencyCleanup = () => {
        if (!this.disposed) this.restoreTerminalState();
      };
      process.once("exit", this.emergencyCleanup);

      // clearOnShrink full-clears when previous frame had blank lines and content
      // shrinks — common when slash autocomplete closes. With fixed editor the
      // scroll region already isolates the chat pane; disable the flicker path.
      (this.tui as { clearOnShrink?: boolean }).clearOnShrink = false;

      this.installed = true;
    } catch (e) {
      this.dispose();
      throw e;
    }
  }

  /** Hide a renderable component via PatchManager. */
  hideRenderable(target: { render(width: number): string[] }): void {
    this.patchManager.hide(target);
  }

  /** Restore stale hidden render patches so old UI container graphs are not retained. */
  retainHiddenRenderables(targets: Array<{ render(width: number): string[] } | null | undefined>): void {
    this.patchManager.retain(targets);
  }

  /** Get a hidden renderable's original render output via PatchManager. */
  renderHidden(target: { render(width: number): string[] }, width: number): string[] {
    return this.patchManager.renderHidden(target, width);
  }

  /** Dispose — restore all state. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Restore all patches via PatchManager
    this.patchManager.dispose();

    // Restore terminal via TerminalManager (restores write, render, doRender, rows, input)
    this.terminalManager.dispose();

    if (this.mouseReportingResumeTimer) {
      clearTimeout(this.mouseReportingResumeTimer);
      this.mouseReportingResumeTimer = null;
    }
    if (this.clipboardRestoreTimer) {
      clearTimeout(this.clipboardRestoreTimer);
      this.clipboardRestoreTimer = null;
    }

    if (this.emergencyCleanup) {
      process.removeListener("exit", this.emergencyCleanup);
      this.emergencyCleanup = null;
    }

    this.restoreTerminalState();
  }

  /** Jump scroll to center (offset = maxOffset / 2). */
  private jumpToCenter(): boolean {
    const width = Math.max(1, this.terminal.columns || 80);
    this.renderScrollableRoot(width, true); // bypass cache: needs live maxOffset
    if (this.disposed || this.scrollState.maxOffset <= 0) return false;
    this.clearSelection();
    (this.scrollState as MutableScrollState).offset = Math.floor(this.scrollState.maxOffset / 2);
    this.repaintScrollableViewport(width);
    this.requestRender();
    return true;
  }

  /** Jump scroll to bottom (offset = 0). */
  jumpToBottom(): boolean {
    if (this.disposed || this.scrollState.offset === 0) return false;
    const width = Math.max(1, this.terminal.columns || 80);
    this.clearSelection();
    (this.scrollState as MutableScrollState).offset = 0;
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
      hiddenRenderPatches: this.patchManager.patchCount,
      retainedRootLines: this.rootLines.length,
      rootLineBase: this.rootLineBase,
      lastRootLineCount: this.lastRootLineCount,
      visibleScrollableRows: this.visibleScrollableRows,
      visibleClusterLines: this.visibleClusterLines.length,
      visibleSidebarLines: this.visibleSidebarLines.length,
      scrollOffset: this.scrollState.offset,
      maxScrollOffset: this.scrollState.maxOffset,
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

  invalidateCluster(): void {
    if (this.renderPassActive || this.renderingCluster || this.painting) {
      this.invalidationPending = true;
      return;
    }
    this.clearCachedFrames();
  }

  /** Standalone repaint — called after layout/sidebar/selection updates. */
  requestRepaint(): void {
    if (this.disposed || this.hasVisibleOverlay()) return;
    this.repaintDeferred = true;
    if (this.repaintFlushQueued) return;

    this.queueRepaintFlush();
  }

  private clearCachedFrames(): void {
    this.cachedCluster = null;
    this.invalidationPending = false;
  }

  private flushDeferredInvalidation(): void {
    if (!this.invalidationPending || this.renderPassActive || this.renderingCluster || this.painting) return;
    this.clearCachedFrames();
    this.requestRepaint();
  }

  private queueRepaintFlush(): void {
    if (this.repaintFlushQueued) return;
    this.repaintFlushQueued = true;
    queueMicrotask(() => {
      this.repaintFlushQueued = false;
      if (!this.repaintDeferred || this.disposed || this.hasVisibleOverlay()) return;
      if (this.painting || this.renderPassActive || this.renderingCluster) {
        this.queueRepaintFlush();
        return;
      }
      this.repaintDeferred = false;
      const width = Math.max(1, this.terminal.columns || 80);
      this.repaintScrollableViewport(width);
    });
  }

  // ── Private helpers for selection (delegates to selection-state) ────────────

  /** Pure geometry: get selection range for a line. */
  private getSelectionRangeForLineDelegate(lineIndex: number, area: SelectionArea): { startCol: number; endCol: number } | null {
    if (this.sel.area !== area || !this.sel.anchor || !this.sel.focus) return null;
    return getSelectionRangeForLine(this.selectionState, lineIndex, area);
  }

  private isLocationInsideSelection(location: { area: SelectionArea; point: Point } | null): boolean {
    if (!location || location.area !== this.sel.area) return false;
    const range = this.getSelectionRangeForLineDelegate(location.point.line, location.area);
    return Boolean(range && location.point.col >= range.startCol && location.point.col < range.endCol);
  }

  private getSelectedText(): string {
    if (!this.sel.area || !this.sel.anchor || !this.sel.focus) return "";
    const lines = this.sel.area === "sidebar" ? this.visibleSidebarLines : this.visibleClusterLines;
    const getLine = (area: SelectionArea, lineIndex: number): string | null => {
      if (area === "root") return stripAnsi(this.rootLineAt(lineIndex));
      return stripAnsi(lines[lineIndex] ?? "");
    };
    return getSelectionText(this.selectionState, getLine, stripAnsi, sliceColumns);
  }

  private selectionLineWidth(area: SelectionArea, lineIndex: number): number {
    if (area === "root") return visibleWidth(stripAnsi(this.rootLineAt(lineIndex)));
    const lines = area === "sidebar" ? this.visibleSidebarLines : this.visibleClusterLines;
    return visibleWidth(stripAnsi(lines[lineIndex] ?? ""));
  }

  private clearSelection(): void {
    this.sel.area = null;
    this.sel.anchor = null;
    this.sel.focus = null;
    this.sel.dragging = false;
    this.sel.highlightVisible = false;
    this.sel.preserveFocusOnRelease = false;
    this.sel.lastLeftPress = null;
    this.sel.copiedText = null;
    this.sel.scrollbarDragging = false;
    this.selectionState = createSelectionState();
  }

  // ── Private: rendering helpers ─────────────────────────────────────────────

  private resolveOriginalRowsGetter(t: any): (() => number) | null {
    let target: any = t;
    while (target) {
      const desc = Object.getOwnPropertyDescriptor(target, "rows");
      if (desc) {
        if (typeof desc.get === "function") return desc.get.bind(t);
        if (typeof desc.value === "number") {
          const v = desc.value;
          return () => v;
        }
        return null;
      }
      target = Object.getPrototypeOf(target);
    }
    return null;
  }

  private getRawRows(): number {
    if (this.originalRowsGetter) {
      const value = this.originalRowsGetter();
      return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 24;
    }
    return 24;
  }

  private getScrollableRows(): number {
    const raw = this.getRawRows();
    // Overlays / paint own the full screen.
    if (this.disposed || this.painting || this.hasVisibleOverlay()) return raw;
    // Re-entrancy: editor.render() reads tui.terminal.rows while we measure
    // the cluster. Returning `raw` here sized autocomplete against the full
    // terminal, then the outer measurement saw a different height → pi-tui
    // previousHeight drift → full clear (black flash) on `/` slash autocomplete.
    if (this.renderingCluster) {
      return this.lastScrollableRows ?? raw;
    }
    const w = Math.max(1, this.terminal.columns || 80);
    const cluster = this.getCachedCluster(w, raw);
    const rows = Math.max(1, raw - cluster.lines.length);
    this.lastScrollableRows = rows;
    return rows;
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
    if (this.renderPassCluster && this.renderPassCluster.width === width && this.renderPassCluster.rawRows === rawRows) {
      this.visibleClusterLines = this.renderPassCluster.cluster.lines;
      return this.renderPassCluster.cluster;
    }
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
      if (this.renderPassActive) {
        this.renderPassCluster = { width, rawRows, cluster };
      }
      this.visibleClusterLines = this.cachedCluster.lines;
      return this.cachedCluster;
    } finally {
      this.renderingCluster = false;
      this.flushDeferredInvalidation();
    }
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

  /** Intercepted tui.render — clip to scrollable window.
   *  @param bypassCache When true, skip the root-frame cache and force a real
   *  render. Used by jumpToTop()'s pre-render, which needs live maxOffset. */
  private renderScrollableRoot(width: number, bypassCache: boolean = false): string[] {
    if (!this.originalTuiRender || this.disposed) {
      return this.originalTuiRender?.(width) ?? [];
    }

    this.rootRenderPasses++;
    this.lastRenderWidth = Math.max(1, width);
    const rawRows = this.getRawRows();
    const cluster = this.getCachedCluster(width, rawRows);
    const scrollableRows = Math.max(1, rawRows - cluster.lines.length);
    const mainWidth = this.getMainWidth(width);

    // Precompute scrollbar geometry once per root render; decorateScrollbar
    // uses these cached values instead of redoing the math for every line.
    const total = Math.max(scrollableRows, this.rootLines.length || this.lastRootLineCount);
    this.scrollbarThumbRows = Math.max(
      1,
      Math.min(scrollableRows, Math.floor((scrollableRows * scrollableRows) / total)),
    );
    const travel = Math.max(0, scrollableRows - this.scrollbarThumbRows);
    this.scrollbarThumbStart = Math.max(
      0,
      Math.min(
        travel,
        Math.round(
          (1 - this.scrollState.offset / Math.max(1, this.scrollState.maxOffset)) * travel,
        ),
      ),
    );

    const now = Date.now();
    const cached = !bypassCache
      ? this.reusableRootFrame(now, width, rawRows, mainWidth, cluster.lines.length)
      : null;
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

    // Update scroll state. We preserve the original monolith's behavior:
    // growth is detected against the FULL allLines count, but max scroll is
    // computed against the retained window. This keeps the user's relative
    // scroll position stable when content grows past MAX_RETAINED_ROOT_LINES.
    const grown = allLines.length - this.lastRootLineCount;
    const shouldAdjustOffset =
      this.scrollState.offset > 0 &&
      this.lastRootLineCount > 0 &&
      allLines.length > this.lastRootLineCount;
    this.lastRootLineCount = allLines.length;
    const newMax = Math.max(0, retainedLines.length - scrollableRows);
    let newOffset = this.scrollState.offset;
    if (shouldAdjustOffset) {
      newOffset += grown;
    }
    newOffset = Math.max(0, Math.min(newOffset, newMax));
    // Mutate in place to avoid allocating a new ScrollState object on every
    // render (hot path during streaming and rapid scrolling).
    const scrollState = this.scrollState as MutableScrollState;
    scrollState.offset = newOffset;
    scrollState.maxOffset = newMax;
    scrollState.totalLines = retainedLines.length;
    scrollState.viewportRows = scrollableRows;

    const retainedStart = Math.max(0, retainedLines.length - scrollableRows - this.scrollState.offset);
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

    if (!bypassCache && this.canCacheRootFrame() && this.rootFrameCacheTtlMs() > 0) {
      this.cachedRootFrame = {
        width,
        rawRows,
        mainWidth,
        clusterHeight: cluster.lines.length,
        scrollOffset: this.scrollState.offset,
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
      !this.sel.highlightVisible &&
        !this.sel.dragging &&
        !this.sel.scrollbarDragging,
    );
  }

  private rootFrameCacheTtlMs(): number {
    return this.hooks.isStreaming?.()
      ? STREAMING_ROOT_RENDER_THROTTLE_MS
      : ROOT_RENDER_FRAME_CACHE_MS;
  }

  private reusableRootFrame(
    now: number,
    width: number,
    rawRows: number,
    mainWidth: number,
    clusterHeight: number,
  ): RootFrameCache | null {
    if (!this.canCacheRootFrame()) return null;
    const ttl = this.rootFrameCacheTtlMs();
    if (ttl === 0) return null;
    const cached = this.cachedRootFrame;
    if (!cached) return null;
    if (now - cached.renderedAt >= ttl) return null;
    if (cached.width !== width || cached.rawRows !== rawRows || cached.mainWidth !== mainWidth) return null;
    if (cached.clusterHeight !== clusterHeight || cached.scrollOffset !== this.scrollState.offset) return null;
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

    const packets = parseSgrMouse(data);
    if (packets) {
      let consumed = false;
      for (const pkt of packets) {
        consumed = this.handleMousePacket(pkt) || consumed;
      }
      return consumed ? { consume: true } : undefined;
    }

    // Keyboard scroll/navigation — checked BEFORE newline so ctrl+j/ctrl+k
    // can be claimed for jump-to-top/jump-to-bottom.
    const action = parseScrollAction(data, this.hooks.keyboardScrollShortcuts);
    if (action) {
      if (action.kind === 'scroll') this.scrollBy(action.delta);
      if (action.kind === 'top') this.jumpToTop();
      if (action.kind === 'center') this.jumpToCenter();
      if (action.kind === 'bottom') this.jumpToBottom();
      return { consume: true };
    }

    // Transform Shift+Enter and Ctrl+J to a plain newline.
    if (isNewlineKey(data)) {
      return { data: "\n" };
    }

    return undefined;
  }

  private scrollBy(delta: number): void {
    const width = Math.max(1, this.terminal.columns || 80);
    this.renderScrollableRoot(width, true); // bypass cache: needs live maxOffset

    // Inline scroll math and mutate in place to avoid ScrollState allocation.
    const nextOffset = Math.max(
      0,
      Math.min(this.scrollState.offset + delta, this.scrollState.maxOffset),
    );
    if (nextOffset === this.scrollState.offset) return;

    this.clearSelection();
    (this.scrollState as MutableScrollState).offset = nextOffset;
    this.repaintScrollableViewport(width);
    this.requestRender();
  }

  private jumpToTop(): boolean {
    const width = Math.max(1, this.terminal.columns || 80);
    this.renderScrollableRoot(width, true); // bypass cache: needs live maxOffset
    if (this.scrollState.offset === this.scrollState.maxOffset) return false;
    this.clearSelection();
    (this.scrollState as MutableScrollState).offset = this.scrollState.maxOffset;
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
        this.sel.copiedText = selectedText;
        void this.hooks.onCopySelection(selectedText);
      } else {
        this.clearSelection();
      }
      this.sel.lastLeftPress = null;
      this.pauseMouseReportingForContextMenu(selectedText || null);
      return true;
    }

    if (this.scrollSelectionAtViewportEdge(pkt)) return true;

    if (isLeftPress(pkt) && location) {
      this.startSelection(location);
      return true;
    }

    if (this.sel.dragging && isLeftDrag(pkt) && location?.area === this.sel.area) {
      this.sel.lastLeftPress = null;
      this.sel.preserveFocusOnRelease = false;
      this.sel.focus = location.point;
      this.selectionState = extendSelection(this.selectionState, location.point);
      this.copySelectionIfChanged();
      this.repaintSelection();
      return true;
    }

    if (this.sel.dragging && isMouseRelease(pkt)) {
      if (!this.sel.preserveFocusOnRelease) {
        this.sel.focus = location?.area === this.sel.area
          ? location.point
          : this.clampedSelectionPointForPacket(pkt, this.sel.area);
      }
      this.sel.preserveFocusOnRelease = false;
      this.sel.dragging = false;
      this.sel.highlightVisible = false;
      this.selectionState = finishSelection(this.selectionState);

      const selectedText = this.copySelectionIfChanged();
      if (selectedText) {
        this.sel.lastLeftPress = null;
      }
      this.repaintSelection();
      return true;
    }

    return false;
  }

  private startSelection(location: { area: SelectionArea; point: Point }): void {
    const now = Date.now();
    const line = location.point.line;
    if (
      this.sel.lastLeftPress &&
      this.sel.lastLeftPress.area === location.area &&
      this.sel.lastLeftPress.line === line &&
      now - this.sel.lastLeftPress.at <= DOUBLE_CLICK_MS
    ) {
      this.sel.area = location.area;
      this.sel.anchor = { line, col: 0 };
      this.sel.focus = { line, col: this.selectionLineWidth(location.area, line) };
      this.sel.dragging = true;
      this.sel.highlightVisible = true;
      this.sel.preserveFocusOnRelease = true;
      this.selectionState = beginSelection(this.selectionState, this.sel.area, { line, col: 0 }, true);
      this.selectionState = extendSelection(this.selectionState, this.sel.focus);
      this.sel.lastLeftPress = null;
      this.copySelectionIfChanged();
      this.repaintSelection();
      return;
    }

    this.sel.area = location.area;
    this.sel.anchor = location.point;
    this.sel.focus = location.point;
    this.sel.dragging = true;
    this.sel.highlightVisible = true;
    this.sel.preserveFocusOnRelease = false;
    this.sel.copiedText = null;
    this.selectionState = beginSelection(this.selectionState, location.area, location.point, false);
    this.sel.lastLeftPress = { area: location.area, line, at: now };
    this.repaintSelection();
  }

  private handleScrollbarPacket(pkt: SgrPacket): boolean {
    if (!this.isScrollbarPacket(pkt)) {
      if (this.sel.scrollbarDragging && isMouseRelease(pkt)) {
        this.sel.scrollbarDragging = false;
        return true;
      }
      return false;
    }

    if (isLeftPress(pkt)) {
      this.sel.scrollbarDragging = true;
      this.scrollToScrollbarRow(pkt.row);
      return true;
    }

    if (this.sel.scrollbarDragging && isLeftDrag(pkt)) {
      this.scrollToScrollbarRow(pkt.row);
      return true;
    }

    if (this.sel.scrollbarDragging && isMouseRelease(pkt)) {
      this.sel.scrollbarDragging = false;
      return true;
    }

    return false;
  }

  private isScrollbarPacket(pkt: SgrPacket): boolean {
    const width = this.lastRenderWidth || Math.max(1, this.terminal.columns || 80);
    const mainWidth = this.getMainWidth(width);
    return (
      this.scrollState.maxOffset > 0 &&
      this.visibleScrollableRows > 1 &&
      pkt.row >= 1 &&
      pkt.row <= this.visibleScrollableRows &&
      pkt.col === mainWidth
    );
  }

  private scrollToScrollbarRow(row: number): void {
    const rows = Math.max(1, this.visibleScrollableRows);
    const clampedRow = Math.max(1, Math.min(row, rows));

    const offset = scrollOffsetForRow(this.scrollState, clampedRow, rows);
    if (offset === this.scrollState.offset) return;

    const wasDraggingScrollbar = this.sel.scrollbarDragging;
    this.clearSelection();
    this.sel.scrollbarDragging = wasDraggingScrollbar;
    (this.scrollState as MutableScrollState).offset = offset;
    this.repaintScrollableViewport(this.lastRenderWidth || Math.max(1, this.terminal.columns || 80));
    this.requestRender();
  }

  private selectionLocationForPacket(pkt: SgrPacket): { area: SelectionArea; point: Point } | null {
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
    if (!this.sel.dragging || this.sel.area !== "root" || !isLeftDrag(pkt)) return false;

    const delta = pkt.row <= 1 ? 1 : pkt.row >= this.visibleScrollableRows ? -1 : 0;
    if (delta === 0) return false;

    // Inline scroll math and mutate in place to avoid ScrollState allocation.
    const nextOffset = Math.max(
      0,
      Math.min(this.scrollState.offset + delta, this.scrollState.maxOffset),
    );
    if (nextOffset === this.scrollState.offset) return false;

    this.sel.lastLeftPress = null;
    this.sel.preserveFocusOnRelease = true;
    (this.scrollState as MutableScrollState).offset = nextOffset;
    const start = this.updateVisibleRootWindow();
    const edgeLine = delta > 0 ? start : start + Math.max(0, this.visibleScrollableRows - 1);
    this.sel.focus = { line: edgeLine, col: Math.max(0, pkt.col - 1) };
    this.sel.highlightVisible = true;
    this.selectionState = extendSelection(this.selectionState, this.sel.focus);
    this.copySelectionIfChanged();
    this.repaintSelection();
    return true;
  }

  private updateVisibleRootWindow(scrollableRows = this.visibleScrollableRows): number {
    const rows = Math.max(1, scrollableRows);
    const retainedStart = Math.max(0, this.rootLines.length - rows - this.scrollState.offset);
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
    if (!selectedText || selectedText === this.sel.copiedText) return selectedText;
    this.sel.copiedText = selectedText;
    void this.hooks.onCopySelection?.(selectedText);
    return selectedText;
  }

  private repaintSelection(): void {
    const width = Math.max(1, this.terminal.columns || 80);
    if (this.sel.area === "cluster") {
      this.requestRepaint();
    } else {
      this.repaintScrollableViewport(width);
    }
    this.requestRender();
  }

  private clampedSelectionPointForPacket(pkt: SgrPacket, area: SelectionArea | null): Point {
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
    const highlighted = this.sel.highlightVisible
      ? this.renderSelectionHighlight(line, lineIndex, "root")
      : line;
    return this.decorateScrollbar(highlighted, viewportIndex, width);
  }

  private decorateScrollbar(line: string, viewportIndex: number, width: number): string {
    if (width <= 1 || this.scrollState.maxOffset <= 0 || this.visibleScrollableRows <= 1) return line;

    const marker =
      viewportIndex >= this.scrollbarThumbStart &&
      viewportIndex < this.scrollbarThumbStart + this.scrollbarThumbRows
        ? SCROLLBAR_THUMB
        : SCROLLBAR_TRACK;
    return padLineToWidth(line, width - 1) + marker;
  }

  private renderSelectionHighlight(line: string, lineIndex: number, area: SelectionArea): string {
    if (!this.sel.highlightVisible) return line;
    const range = this.getSelectionRangeForLineDelegate(lineIndex, area);
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
      this.terminalManager.writeRaw(emergencyTerminalModeReset());
    } catch {
      // Best-effort cleanup during exit
    }
  }
}

export { emergencyTerminalModeReset };
