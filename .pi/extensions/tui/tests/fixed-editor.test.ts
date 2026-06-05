import test, { before } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let renderFixedCluster: any;
let FixedEditorCompositor: any;
let emergencyTerminalModeReset: any;
let readAmpTuiSettings: any;

before(async () => {
  const clusterModule: any = await import("../fixed-editor/cluster.ts");
  const compositorModule: any = await import("../fixed-editor/compositor.ts");
  const settingsModule: any = await import("../settings.ts");
  ({ renderFixedCluster } = clusterModule.default ?? clusterModule);
  ({ FixedEditorCompositor, emergencyTerminalModeReset } = compositorModule.default ?? compositorModule);
  ({ readAmpTuiSettings } = settingsModule.default ?? settingsModule);
});

class FakeTerminal {
  columns = 40;
  private rowCount = 8;
  writes: string[] = [];

  get rows(): number {
    return this.rowCount;
  }

  setRows(rows: number): void {
    this.rowCount = rows;
  }

  write(data: string): void {
    this.writes.push(data);
  }
}

function makeCompositor(options: {
  rows?: number;
  rootLines?: string[];
  clusterLines?: string[];
  keyboardScrollShortcuts?: {
    up: string;
    down: string;
    top?: string;
    bottom?: string;
  };
  onCopySelection?: (text: string) => void;
  sidebarWidth?: number | (() => number);
  sidebarLines?: string[];
  rootRender?: (width: number, terminal: FakeTerminal) => string[];
  hasOverlay?: boolean;
  isStreaming?: boolean;
} = {}) {
  const terminal = new FakeTerminal();
  terminal.setRows(options.rows ?? 6);
  let listener: ((data: string) => unknown) | undefined;
  let requestRenderCount = 0;
  const rootLines = options.rootLines ?? Array.from({ length: 20 }, (_, i) => `root-${i}`);
  const clusterLines = options.clusterLines ?? ["editor"];
  const tui: any = {
    terminal,
    hasOverlay: () => options.hasOverlay ?? false,
    render: (width: number) => options.rootRender?.(width, terminal) ?? rootLines,
    doRender() {},
    requestRender() {
      requestRenderCount++;
    },
    addInputListener(fn: (data: string) => unknown) {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
  };
  const compositor = new FixedEditorCompositor(tui, terminal, {
    getEditorLines: () => clusterLines,
    getRenderStateKey: () => clusterLines.join("\n") + "|" + (options.sidebarLines ?? []).join("\n"),
    getSidebarWidth: () => typeof options.sidebarWidth === "function" ? options.sidebarWidth() : options.sidebarWidth ?? 0,
    getSidebarLines: (_width: number, height: number) => (options.sidebarLines ?? []).slice(0, height),
    isStreaming: () => options.isStreaming ?? false,
    keyboardScrollShortcuts: options.keyboardScrollShortcuts,
    onCopySelection: options.onCopySelection,
  });
  compositor.install();
  assert(listener, "input listener installed");
  return {
    terminal,
    tui,
    compositor,
    input(data: string) {
      return listener?.(data);
    },
    requestRenderCount() {
      return requestRenderCount;
    },
  };
}

test("fixed cluster gives editor first claim before footer and optional rows", () => {
  const rendered = renderFixedCluster({
    width: 80,
    terminalRows: 4,
    statusLines: ["status"],
    aboveWidgetLines: ["above"],
    editorLines: ["edit-a", "edit-b", "edit-c"],
    belowWidgetLines: ["below"],
    footerLines: ["footer"],
  });

  assert.deepEqual(rendered.lines, ["edit-a", "edit-b", "edit-c"]);
});

test("streaming every render pass calls originalTuiRender (no root cache)", () => {
  let rootRenderCount = 0;
  const fixture = makeCompositor({
    rows: 5,
    clusterLines: ["editor"],
    isStreaming: true,
    rootRender: () => {
      rootRenderCount++;
      return [`render-${rootRenderCount}`, "stable"];
    },
  });

  assert.ok(fixture.tui.render(40)[0].includes("render-1"));
  assert.ok(fixture.tui.render(40)[0].includes("render-2"));
  assert.equal(rootRenderCount, 2, "no streaming cache — every render call triggers originalTuiRender for smooth streaming");

  fixture.compositor.dispose();
});

test("cluster repaint fires on every render pass (no time throttle, recomputation cached)", () => {
  const fixture = makeCompositor({
    rows: 5,
    clusterLines: ["editor"],
    isStreaming: true,
  });

  for (let i = 0; i < 10; i++) fixture.tui.doRender();

  assert.equal(
    fixture.compositor.getDiagnostics().clusterOnlyRepaints,
    10,
    "every doRender paints the cluster from cache — no throttle skip, no footer flashing",
  );

  fixture.compositor.dispose();
});

test("keyboard scroll recognizes Kitty/super fallback sequences", () => {
  const fixture = makeCompositor({ rows: 6 });
  assert.deepEqual(fixture.input("\x1b[5;9~"), { consume: true });
  assert.ok(fixture.requestRenderCount() > 0, "super/page-up fallback scrolls and requests render");
  fixture.compositor.dispose();
});

test("emergency terminal reset exports a full terminal mode cleanup sequence", () => {
  assert.equal(typeof emergencyTerminalModeReset, "function");
  const reset = emergencyTerminalModeReset();
  assert.ok(reset.includes("\x1b[?2026h"), "begins synchronized output");
  assert.ok(reset.includes("\x1b[r"), "resets scroll region");
  assert.ok(reset.includes("\x1b[?1006l"), "disables SGR mouse reporting");
  assert.ok(reset.includes("\x1b[?1002l"), "disables button-event mouse reporting");
  assert.ok(reset.includes("\x1b[?1000l"), "disables normal mouse reporting");
  assert.ok(reset.includes("\x1b[?7h"), "restores autowrap");
  assert.ok(reset.includes("\x1b[?25h"), "shows cursor");
  assert.ok(reset.includes("\x1b[?2026l"), "ends synchronized output");
});

test("mouse drag selection paints immediately and copies root text through onCopySelection", () => {
  const copied: string[] = [];
  const fixture = makeCompositor({
    rows: 5,
    rootLines: ["alpha", "bravo", "charlie", "delta"],
    clusterLines: ["editor"],
    onCopySelection: (text) => copied.push(text),
  });

  fixture.tui.render(40);
  fixture.terminal.writes.length = 0;
  assert.deepEqual(fixture.input("\x1b[<0;1;1M"), { consume: true });
  assert.deepEqual(fixture.input("\x1b[<32;3;2M"), { consume: true });
  assert.ok(fixture.terminal.writes.join("").includes("\x1b[7malpha\x1b[27m"), "drag selection repaints highlighted root text immediately");
  assert.deepEqual(copied, ["alpha\nbr"], "drag selection auto-copies before mouse release");
  assert.deepEqual(fixture.input("\x1b[<0;3;2m"), { consume: true });
  assert.ok(!fixture.terminal.writes.at(-1)?.includes("\x1b[7m"), "mouse release clears visible selection highlight");

  assert.deepEqual(copied, ["alpha\nbr"], "mouse release does not duplicate the same copied selection");
  fixture.compositor.dispose();
});

test("root selection still copies visible text after retained history cap", () => {
  const copied: string[] = [];
  const fixture = makeCompositor({
    rows: 5,
    rootLines: Array.from({ length: 2505 }, (_, i) => `line-${i}`),
    clusterLines: ["editor"],
    onCopySelection: (text) => copied.push(text),
  });

  fixture.tui.render(40);
  assert.deepEqual(fixture.input("\x1b[<0;1;2M"), { consume: true });
  assert.deepEqual(fixture.input("\x1b[<32;10;2M"), { consume: true });

  assert.equal(copied.at(-1), "line-2502");
  fixture.compositor.dispose();
});

test("hidden render patches prune stale containers", () => {
  const fixture = makeCompositor();
  const oldRenderable = { render: () => ["old"] };
  const currentRenderable = { render: () => ["current"] };

  fixture.compositor.hideRenderable(oldRenderable);
  fixture.compositor.hideRenderable(currentRenderable);
  assert.deepEqual(oldRenderable.render(), []);
  assert.deepEqual(currentRenderable.render(), []);

  fixture.compositor.retainHiddenRenderables([currentRenderable]);

  assert.deepEqual(oldRenderable.render(), ["old"]);
  assert.deepEqual(currentRenderable.render(), []);
  fixture.compositor.dispose();
});

test("right-click selection pauses mouse reporting for terminal context menu", () => {
  const copied: string[] = [];
  const fixture = makeCompositor({
    rows: 5,
    rootLines: ["alpha", "bravo", "charlie", "delta"],
    clusterLines: ["editor"],
    onCopySelection: (text) => copied.push(text),
  });

  fixture.tui.render(40);
  fixture.input("\x1b[<0;1;1M");
  fixture.input("\x1b[<32;3;1M");
  fixture.input("\x1b[<0;3;1m");
  fixture.terminal.writes.length = 0;

  assert.deepEqual(fixture.input("\x1b[<2;2;1M"), { consume: true });
  assert.equal(copied.at(-1), "al");
  assert.ok(fixture.terminal.writes.join("").includes("\x1b[?1006l"), "right-click pause disables mouse reporting");
  fixture.compositor.dispose();
});

test("double-click selects and copies the whole root line", () => {
  const copied: string[] = [];
  const fixture = makeCompositor({
    rows: 5,
    rootLines: ["alpha", "bravo", "charlie", "delta"],
    clusterLines: ["editor"],
    onCopySelection: (text) => copied.push(text),
  });

  fixture.tui.render(40);
  fixture.input("\x1b[<0;3;2M");
  fixture.input("\x1b[<0;3;2m");
  fixture.input("\x1b[<0;3;2M");
  fixture.input("\x1b[<0;3;2m");

  assert.equal(copied.at(-1), "bravo");
  fixture.compositor.dispose();
});

test("dragging root selection past the top edge scrolls to older lines", () => {
  const copied: string[] = [];
  const fixture = makeCompositor({
    rows: 5,
    rootLines: Array.from({ length: 10 }, (_, i) => `line-${i}`),
    clusterLines: ["editor"],
    onCopySelection: (text) => copied.push(text),
  });

  fixture.tui.render(40);
  fixture.input("\x1b[<0;1;2M");
  fixture.input("\x1b[<32;1;1M");
  fixture.input("\x1b[<0;1;1m");

  assert.equal(copied.at(-1), "line-5\nline-6");
  fixture.compositor.dispose();
});

test("right-click context menu repeatedly restores selected text to clipboard briefly", async () => {
  const copied: string[] = [];
  const fixture = makeCompositor({
    rows: 5,
    rootLines: ["alpha", "bravo", "charlie", "delta"],
    clusterLines: ["editor"],
    onCopySelection: (text) => copied.push(text),
  });

  fixture.tui.render(40);
  fixture.input("\x1b[<0;1;1M");
  fixture.input("\x1b[<32;3;1M");
  fixture.input("\x1b[<0;3;1m");
  fixture.input("\x1b[<2;2;1M");
  const copiesAfterRightClick = copied.length;

  await new Promise((resolve) => setTimeout(resolve, 140));

  assert.ok(copied.length > copiesAfterRightClick, "clipboard restore timer copied selection again");
  assert.equal(copied.at(-1), "al");
  fixture.compositor.dispose();
});

test("right sidebar reserves terminal columns beside scrollable chat", () => {
  const fixture = makeCompositor({
    rows: 5,
    rootLines: ["alpha", "bravo", "charlie"],
    clusterLines: ["editor"],
    sidebarWidth: 12,
    sidebarLines: ["│ Side     ", "│ TODOs    ", "│ item     ", "│          ", "│          "],
  });

  const rendered = fixture.tui.render(40);
  fixture.compositor.requestRepaint();
  const writes = fixture.terminal.writes.join("");

  assert.ok(rendered[0].includes("alpha"), "main chat still renders on the left");
  assert.ok(rendered.every((line: string) => visibleWidth(line) === 28), "main lines constrained to main pane width");
  assert.ok(writes.includes("│ Side"), "sidebar renders as fixed terminal overlay");
  assert.ok(writes.includes("│ TODOs"), "sidebar keeps row alignment");
  fixture.compositor.dispose();
});

test("right sidebar exposes reduced terminal columns while rendering the main pane", () => {
  const fixture = makeCompositor({
    rows: 5,
    clusterLines: ["editor"],
    sidebarWidth: 12,
    sidebarLines: ["side", "side", "side", "side", "side"],
    rootRender: (width, terminal) => [`width=${width} columns=${terminal.columns}`],
  });

  const rendered = fixture.tui.render(40);
  fixture.compositor.requestRepaint();
  const writes = fixture.terminal.writes.join("");

  assert.ok(rendered[0].includes("width=28 columns=28"), "main renderers see the reduced main-pane width and terminal columns");
  assert.ok(writes.includes("side"), "sidebar renders as fixed terminal overlay");
  fixture.compositor.dispose();
});


test("right sidebar exposes reduced process stdout columns while rendering the main pane", () => {
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "columns", { configurable: true, value: 40 });
  try {
    const fixture = makeCompositor({
      rows: 5,
      clusterLines: ["editor"],
      sidebarWidth: 12,
      sidebarLines: ["side", "side", "side", "side", "side"],
      rootRender: (width) => [`width=${width} stdout=${process.stdout.columns}`],
    });

    const rendered = fixture.tui.render(40);

    assert.ok(rendered[0].includes("width=28 stdout=28"), "pi-diff-style process.stdout.columns consumers see the reduced main-pane width");
    fixture.compositor.dispose();
  } finally {
    if (stdoutDescriptor) {
      Object.defineProperty(process.stdout, "columns", stdoutDescriptor);
    } else {
      Reflect.deleteProperty(process.stdout, "columns");
    }
  }
});


test("right sidebar also constrains overlay renderers to the main pane", () => {
  const fixture = makeCompositor({
    rows: 5,
    clusterLines: ["editor"],
    sidebarWidth: 12,
    sidebarLines: ["side", "side", "side", "side", "side"],
    hasOverlay: true,
    rootRender: (width, terminal) => [`overlay width=${width} columns=${terminal.columns}`],
  });

  const rendered = fixture.tui.render(40);

  assert.ok(rendered[0].includes("overlay width=28 columns=28"), "pi-diff-style overlays see the reduced main-pane width when sidebar is visible");
  assert.ok(rendered.every((line: string) => visibleWidth(line) === 28), "main pane lines stay within main pane width");
  fixture.compositor.dispose();
});


test("streaming repaint refreshes the full sidebar instead of only fixed editor rows", () => {
  const sidebarLines = ["old top", "old todo", "old git", "old filler", "old bottom"];
  const fixture = makeCompositor({
    rows: 5,
    rootLines: ["root-a", "root-b", "root-c", "root-d"],
    clusterLines: ["editor"],
    sidebarWidth: 12,
    sidebarLines,
  });

  fixture.tui.render(40);
  fixture.terminal.writes.length = 0;
  sidebarLines.splice(0, sidebarLines.length, "new top", "new todo", "new git", "new filler", "new bottom");
  fixture.compositor.invalidateCluster();
  fixture.compositor.requestRepaint();
  const repaint = fixture.terminal.writes.join("");

  assert.ok(repaint.includes("new top"), "top sidebar rows repaint during streaming updates");
  assert.ok(repaint.includes("new todo"), "middle sidebar rows repaint during streaming updates");
  assert.doesNotMatch(repaint, /old top|old todo|old git/, "stale sidebar content is not re-emitted");
  fixture.compositor.dispose();
});


test("sidebar toggle off repaints the main pane across the released columns", () => {
  let sidebarWidth = 12;
  const sidebarLines = ["side top", "side todo", "side git", "side filler", "side bottom"];
  const fixture = makeCompositor({
    rows: 5,
    rootLines: ["root-a", "root-b", "root-c", "root-d"],
    clusterLines: ["editor"],
    sidebarWidth: () => sidebarWidth,
    sidebarLines,
  });

  fixture.tui.render(40);
  fixture.terminal.writes.length = 0;
  sidebarWidth = 0;
  fixture.compositor.invalidateCluster();
  fixture.compositor.requestRepaint();
  const repaint = fixture.terminal.writes.join("");

  assert.ok(repaint.includes("root-a"), "main pane rows repaint after sidebar is hidden");
  assert.ok(repaint.includes("editor"), "fixed editor rows repaint after sidebar is hidden");
  assert.doesNotMatch(repaint, /side top|side todo|side git/, "hidden sidebar content is not re-emitted");
  fixture.compositor.dispose();
});


test("sidebar text can be selected and copied", () => {
  const copied: string[] = [];
  const fixture = makeCompositor({
    rows: 5,
    rootLines: ["root"],
    clusterLines: ["editor"],
    sidebarWidth: 12,
    sidebarLines: ["alpha side", "beta side", "gamma side", "delta side", "omega side"],
    onCopySelection: (text) => copied.push(text),
  });

  fixture.tui.render(40);
  assert.deepEqual(fixture.input("\x1b[<0;29;1M"), { consume: true });
  assert.deepEqual(fixture.input("\x1b[<32;34;1M"), { consume: true });
  assert.equal(copied.at(-1), "alpha", "dragging inside the sidebar copies selected sidebar text");
  assert.deepEqual(fixture.input("\x1b[<0;34;1m"), { consume: true });
  fixture.compositor.dispose();
});


test("sidebar mode keeps scrollbar draggable at the main pane edge", () => {
  const fixture = makeCompositor({
    rows: 6,
    rootLines: Array.from({ length: 20 }, (_, i) => `line-${i}`),
    clusterLines: ["editor"],
    sidebarWidth: 12,
    sidebarLines: Array.from({ length: 6 }, () => "│ Side     "),
  });

  fixture.tui.render(40);
  assert.deepEqual(fixture.input("\x1b[<0;28;5M"), { consume: true });
  assert.deepEqual(fixture.input("\x1b[<32;28;1M"), { consume: true });
  assert.ok(fixture.tui.render(40)[0].startsWith("line-0"), "dragging the main-pane scrollbar still scrolls to oldest lines");
  fixture.compositor.dispose();
});

test("right-edge scrollbar renders opencode-style rail and moves with chat scroll position", () => {
  const fixture = makeCompositor({
    rows: 6,
    rootLines: Array.from({ length: 20 }, (_, i) => `line-${i}`),
    clusterLines: ["editor"],
  });

  const track = "\x1b[48;5;238m \x1b[0m";
  const thumb = "\x1b[48;5;244m \x1b[0m";
  const bottom = fixture.tui.render(12);
  assert.ok(bottom.every((line: string) => line.endsWith(track) || line.endsWith(thumb)), "scrollable rows reserve right edge for a background-color scrollbar");
  assert.ok(bottom.every((line: string) => visibleWidth(line) === 12), "scrollbar rows are padded to the full viewport width");
  assert.ok(bottom.at(-1)?.endsWith(thumb), "scrollbar thumb starts at bottom when chat is at latest message");

  assert.deepEqual(fixture.input("\x1b[5~"), { consume: true });
  const older = fixture.tui.render(12);
  assert.ok(!older.at(-1)?.endsWith(thumb), "scrollbar thumb moves away from bottom after scrolling up");
  assert.ok(older.some((line: string, index: number) => index < older.length - 1 && line.endsWith(thumb)), "scrollbar thumb is visible above bottom after scrolling");
  fixture.compositor.dispose();
});

test("dragging the right-edge scrollbar scrolls the chat viewport", () => {
  const fixture = makeCompositor({
    rows: 6,
    rootLines: Array.from({ length: 20 }, (_, i) => `line-${i}`),
    clusterLines: ["editor"],
  });

  fixture.tui.render(12);
  assert.deepEqual(fixture.input("\x1b[<0;12;5M"), { consume: true });
  assert.deepEqual(fixture.input("\x1b[<32;12;1M"), { consume: true });
  assert.ok(fixture.tui.render(12)[0].startsWith("line-0"), "dragging scrollbar thumb to top shows oldest chat lines");

  assert.deepEqual(fixture.input("\x1b[<32;12;5M"), { consume: true });
  assert.deepEqual(fixture.input("\x1b[<0;12;5m"), { consume: true });
  assert.ok(fixture.tui.render(12).at(-1)?.includes("line-19"), "dragging scrollbar thumb to bottom shows latest chat lines");
  fixture.compositor.dispose();
});

test("keyboard navigation jumps scrollable chat to top and bottom", () => {
  const fixture = makeCompositor({
    rows: 6,
    rootLines: Array.from({ length: 20 }, (_, i) => `line-${i}`),
    clusterLines: ["editor"],
  });

  assert.deepEqual(fixture.input("\x1b[1;9H"), { consume: true });
  assert.ok(fixture.tui.render(12)[0].startsWith("line-0"), "super+home jumps to oldest chat lines");

  assert.deepEqual(fixture.input("\x1b[1;9F"), { consume: true });
  assert.ok(fixture.tui.render(12).at(-1)?.startsWith("line-19"), "super+end jumps to latest chat lines");
  fixture.compositor.dispose();
});

test("amp-tui settings read persisted fixed-editor scroll shortcuts", () => {
  const dir = mkdtempSync(join(tmpdir(), "amp-tui-settings-"));
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify({
      ampTui: {
        fixedEditor: {
          scrollChatUp: "ctrl+shift+u",
          scrollChatDown: "ctrl+shift+d",
          scrollChatTop: "ctrl+shift+home",
          scrollChatBottom: "ctrl+shift+end",
        },
      },
    }));

    assert.deepEqual(readAmpTuiSettings(dir).keyboardScrollShortcuts, {
      up: "ctrl+shift+u",
      down: "ctrl+shift+d",
      top: "ctrl+shift+home",
      bottom: "ctrl+shift+end",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
