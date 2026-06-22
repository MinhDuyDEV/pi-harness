import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GitInfo } from "./git-status.js";
import { NF, formatCost, fmtNum } from "./helpers.js";

// ── Icon helpers ───────────────────────────────────────────────────────────

/** Returns icon + trailing space with Nerd Fonts, empty string without. */
function iFolder(): string   { return ""; }
function iGit(): string      { return ""; }
function iQueue(): string    { return NF ? "\uf0c9 " : ""; }
function iInput(): string    { return NF ? "󰁝" : "↑"; }
function iOutput(): string   { return NF ? "󰁅" : "↓"; }
function iCache(): string    { return NF ? "󰆼" : "cache"; }
function iTurn(): string     { return NF ? "" : "turn"; }
function sep(): string       { return "·"; }



// ── Footer state ───────────────────────────────────────────────────────────

export interface FooterState {
  modelLabel: string;
  thinkingLevel: string;
  isStreaming: boolean;
  tokenCount: number;
  contextWindow: number;
  hasPendingMessages: boolean;
  tui: TUI | null;
  git: GitInfo | null;
  cwd: string;
  /** Elapsed ms since current turn started. */
  turnElapsed: number;
  /** Tokens received in current turn so far. */
  turnTokens: number;
  /** Input tokens reported for the current turn. */
  turnInputTokens: number;
  /** Output tokens reported for the current turn. */
  turnOutputTokens: number;
  /** Cache-read tokens reported for the current turn. */
  turnCacheReadTokens: number;
  /** Cache-write tokens reported for the current turn. */
  turnCacheWriteTokens: number;
  /** Session cost in USD reported by model usage events. */
  totalCostUsd: number;
}

export function createDefaultFooterState(): FooterState {
  return {
    modelLabel: "",
    thinkingLevel: "",
    isStreaming: false,
    tokenCount: 0,
    contextWindow: 0,
    hasPendingMessages: false,
    tui: null,
    git: null,
    cwd: "",
    turnElapsed: 0,
    turnTokens: 0,
    turnInputTokens: 0,
    turnOutputTokens: 0,
    turnCacheReadTokens: 0,
    turnCacheWriteTokens: 0,
    totalCostUsd: 0,
  };
}

// ── Segment helpers ────────────────────────────────────────────────────────

interface Seg {
  text: string;
  width: number;
}

function seg(text: string): Seg {
  return { text, width: visibleWidth(text) };
}

function join(segs: Seg[], sepStr: string): Seg {
  if (segs.length === 0) return { text: "", width: 0 };
  const combined = segs.map((s) => s.text).join(sepStr);
  let totalW = 0;
  for (let i = 0; i < segs.length; i++) {
    totalW += segs[i].width;
    if (i < segs.length - 1) totalW += visibleWidth(sepStr);
  }
  return { text: combined, width: totalW };
}

// ── Token bar ──────────────────────────────────────────────────────────────

function tokenBar(tokens: number, cw: number, costUsd: number, theme: Theme): Seg {
  const pct = cw > 0 ? (tokens / cw) * 100 : 0;
  const label = `${fmtContextNum(cw)} (${pct.toFixed(1)}%)`;
  const text = theme.fg("dim", label) + theme.fg("borderMuted", " · ") + theme.fg("dim", formatCost(costUsd));
  return { text, width: visibleWidth(text) };
}

function fmtContextNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return "" + n;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return (ms / 1000).toFixed(1) + "s";
  if (ms < 10000) return (ms / 1000).toFixed(1) + "s";  // 1.0s – 9.9s
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? m + "m " + s + "s" : m + "m";
}

function turnStats(state: FooterState, theme: Theme): Seg {
  const parts = [
    `${iInput()} ${fmtNum(state.turnInputTokens)}`,
    `${iOutput()} ${fmtNum(state.turnOutputTokens)}`,
    `${iCache()} ${fmtNum(state.turnCacheReadTokens)}/${fmtNum(state.turnCacheWriteTokens)}`,
  ];
  if (state.turnElapsed >= 1000) {
    parts.push(`${iTurn()} ${formatDuration(state.turnElapsed)}`);
  }
  const text = parts.join(" · ");
  return seg(theme.fg("dim", `[${text}]`));
}

// ── Git status ─────────────────────────────────────────────────────────────

function gitSeg(git: GitInfo | null, theme: Theme): Seg | null {
  if (!git || !git.branch) return null;
  let parts = iGit() + theme.fg("mdLinkUrl", git.branch);
  const ds: string[] = [];
  if (git.staged > 0) ds.push(theme.fg("success", "+" + git.staged));
  if (git.unstaged > 0) ds.push(theme.fg("error", "-" + git.unstaged));
  if (git.untracked > 0) ds.push(theme.fg("warning", "?" + git.untracked));
  if (ds.length > 0) parts += " " + ds.join(" ");
  return seg(parts);
}

// ── Rainbow text (for high/xhigh thinking level) ─────────────────────────

const RAINBOW_COLORS = [
  "#b281d6", "#d787af", "#febc38", "#e4c00f",
  "#89d281", "#00afaf", "#178fb9", "#b281d6",
];

function hexFgAnsi(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function rainbow(text: string): string {
  let result = "";
  let colorIndex = 0;
  for (const char of text) {
    if (char === " " || char === ":") {
      result += char;
    } else {
      result += hexFgAnsi(RAINBOW_COLORS[colorIndex % RAINBOW_COLORS.length]) + char;
      colorIndex++;
    }
  }
  return result + "\x1b[0m";
}

// ── Path ───────────────────────────────────────────────────────────────────

function shortPath(cwd: string): string {
  if (!cwd) return "";
  const home = process.env.HOME ?? "";
  const d = cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const parts = d.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return d;
  return "\u22ef/" + parts.slice(-2).join("/");
}

// ── Footer component factory ───────────────────────────────────────────────

function extensionStatusLines(footerData: unknown): string[] {
  const statuses = (footerData as { getExtensionStatuses?: () => ReadonlyMap<string, string> } | undefined)?.getExtensionStatuses?.();
  if (!statuses || statuses.size === 0) return [];
  return Array.from(statuses.entries())
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([, text]) => String(text ?? ""))
    .filter((line) => line.trim().length > 0);
}

export function createFooterRenderer(state: FooterState) {
  return (_tui: TUI, theme: Theme, footerData?: unknown) => ({
    invalidate() {},
    render(width: number): string[] {
      state.tui = _tui;
      const sepStr = theme.fg("borderMuted", " " + sep() + " ");

      // ── Left: [spinner] [model] [thinking] [path] [queue] ─────────────
      const L: Seg[] = [];

      let modelText = "";
      modelText += theme.fg("accent", state.modelLabel || "no model");
      L.push(seg(modelText));

      if (state.thinkingLevel) {
        const level = state.thinkingLevel;
        const text = (level === "high" || level === "xhigh")
          ? rainbow(level)
          : theme.fg("muted", level);
        L.push(seg(text));
      }

      if (state.cwd) {
        L.push(seg(theme.fg("dim", iFolder() + " " + shortPath(state.cwd) + " ")));
      }

      if (state.hasPendingMessages) {
        L.push(seg(theme.fg("warning", iQueue() + "\u25c6")));
      }

      // ── Right: [git] [latency*] [token bar] ──────────────────────────
      const R: Seg[] = [];

      const g = gitSeg(state.git, theme);
      if (g) R.push(g);

      // Current/last turn stats: [󰁝 12.3K · 󰁅 4.5K · 󰆼 1.2K/0 ·  5.3s]
      R.push(turnStats(state, theme));

      if (state.tokenCount > 0) {
        const bar = tokenBar(state.tokenCount, state.contextWindow, state.totalCostUsd, theme);
        R.push(seg(bar.text));
      }

      const left = join(L, sepStr);
      const right = join(R, sepStr);

      const statusLines = extensionStatusLines(footerData).map((line) => truncateToWidth(line, width));

      if (right.width === 0) {
        return [...statusLines, truncateToWidth(left.text, width)];
      }

      const gap = Math.max(1, width - left.width - right.width);
      return [...statusLines, truncateToWidth(left.text + " ".repeat(gap) + right.text, width)];
    },
  });
}
