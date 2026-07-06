/**
 * terminal-manager.ts — Terminal patch lifecycle management.
 *
 * Manages snapshot/restore of 5 monkey-patched entry points:
 *   1. terminal.write
 *   2. terminal.rows (getter)
 *   3. tui.render
 *   4. tui.doRender
 *   5. tui input listener
 *
 * The compositor provides callbacks for each patched function;
 * TerminalManager handles the mechanical install/dispose lifecycle.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TerminalManagerConfig {
  /** Called on terminal.write interception. Compositor handles overlay decisions. */
  onWrite: (data: string) => void;
  /** Called when terminal.rows is read. Return adjusted row count. */
  onRows: () => number;
  /** Called for each input event. Should return consume/data result for pi-tui. */
  onInput: (data: string) => { consume?: boolean; data?: string } | undefined;
  /** Called when tui.render(width) is invoked. Return clipped root lines. */
  onRender: (width: number) => string[];
  /** Called after each tui.doRender run (e.g. to repaint fixed cluster). */
  onDoRender: () => void;
}

interface TerminalSnapshot {
  terminalWrite: (...args: any[]) => void;
  tuiRender: ((width: number) => string[]) | null;
  tuiDoRender: (() => void) | null;
  rowsDescriptor: PropertyDescriptor | undefined;
}

// ── Helpers re-exported from terminal-escape ──────────────────────────────────

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

// ── TerminalManager ───────────────────────────────────────────────────────────

export class TerminalManager {
  private tui: Record<string, any>;
  private terminal: Record<string, any>;

  // Snapshot / state
  private snapshot: TerminalSnapshot | null = null;
  private _installed = false;
  private _disposed = false;

  // Input listener cleanup
  private removeInputListener: (() => void) | null = null;

  constructor(tui: Record<string, any>, terminal: Record<string, any>) {
    this.tui = tui;
    this.terminal = terminal;
  }

  get installed(): boolean {
    return this._installed;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Install the overlay — snapshots originals and patches 5 entry points.
   * Each callback receives the intercepted call and provides compositor-specific logic.
   * The compositor's onWrite callback handles overlay decisions internally.
   * When disposed/uninstalled, writes pass through via snapshot.
   */
  install(config: TerminalManagerConfig): void {
    if (this._installed) return;
    this._installed = true;

    // Snapshot originals
    const rowsDescriptor = this.resolveRowsDescriptor(this.terminal);
    this.snapshot = {
      terminalWrite: this.terminal.write.bind(this.terminal),
      tuiRender: this.tui.render ?? null,
      tuiDoRender: this.tui.doRender ?? null,
      rowsDescriptor,
    };

    // 1. Patch terminal.rows getter
    if (rowsDescriptor) {
      Object.defineProperty(this.terminal, "rows", {
        configurable: true,
        get: () => config.onRows(),
      });
    }

    // 2. Patch terminal.write — always calls onWrite when active;
    //    pass through via snapshot when disposed/uninstalled.
    this.terminal.write = (data: string) => {
      if (this._installed && !this._disposed) {
        config.onWrite(data);
      } else if (this.snapshot) {
        this.snapshot.terminalWrite(data);
      }
    };

    // 3. Patch tui.render — return clipped root lines
    if (this.snapshot.tuiRender) {
      this.tui.render = (width: number) => config.onRender(width);
    }

    // 4. Patch tui.doRender — run cluster repaint after each render pass
    if (this.snapshot.tuiDoRender) {
      this.tui.doRender = () => config.onDoRender();
    }

    // 5. Register input listener
    if (typeof this.tui.addInputListener === "function") {
      this.removeInputListener = (() => {
        let active = true;
        const handler = (data: string) => {
          if (!active || !this._installed || this._disposed) return undefined;
          return config.onInput(data);
        };
        const cleanup = this.tui.addInputListener(handler);
        return () => {
          active = false;
          if (typeof cleanup === "function") cleanup();
        };
      })();
    }
  }

  /** Dispose — restores all patches in reverse order. Safe to call multiple times. */
  dispose(): void {
    if (!this._installed || this._disposed) return;
    this._disposed = true;

    const snapshot = this.snapshot;
    if (!snapshot) return;

    // Remove input listener first (no input during teardown)
    if (this.removeInputListener) {
      this.removeInputListener();
      this.removeInputListener = null;
    }

    // Restore doRender
    if (snapshot.tuiDoRender) {
      this.tui.doRender = snapshot.tuiDoRender;
    } else {
      delete this.tui.doRender;
    }

    // Restore render
    if (snapshot.tuiRender) {
      this.tui.render = snapshot.tuiRender;
    } else {
      delete this.tui.render;
    }

    // Restore write
    this.terminal.write = snapshot.terminalWrite;

    // Restore rows descriptor
    if (snapshot.rowsDescriptor) {
      Object.defineProperty(this.terminal, "rows", snapshot.rowsDescriptor);
    } else {
      Reflect.deleteProperty(this.terminal, "rows");
    }

    // Reset terminal state
    this.writeRaw(emergencyTerminalModeReset());

    this.snapshot = null;
    this._installed = false;
  }

  /** Emergency reset — only as last resort (e.g., process.on("exit")). */
  emergencyReset(): void {
    if (!this._installed && !this._disposed) return;
    this.writeRaw(emergencyTerminalModeReset());
  }

  /** Write raw bytes to the terminal's original write function (bypassing the patch). */
  writeRaw(data: string): void {
    if (this.snapshot) {
      this.snapshot.terminalWrite(data);
    } else {
      this.terminal.write(data);
    }
  }

  private resolveRowsDescriptor(t: any): PropertyDescriptor | undefined {
    let target: any = t;
    while (target) {
      const desc = Object.getOwnPropertyDescriptor(target, "rows");
      if (desc) return desc;
      target = Object.getPrototypeOf(target);
    }
    return undefined;
  }
}

// Re-export escape helpers for convenience
export {
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
};
