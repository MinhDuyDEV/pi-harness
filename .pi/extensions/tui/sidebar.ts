import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GitInfo } from "./git-status.js";
import type { QueueState } from "./queue-panel.js";
import { hasOpenTodos, type TodosState } from "./todos-panel.js";
import { formatCost, fmtNum } from "./helpers.js";

const RESET = "\x1b[0m";
const LABEL = "\x1b[97m";
const SUBTEXT = "\x1b[2m";
const LEFT_PADDING = "   ";

export interface SidebarStyle {
  label?: (text: string) => string;
  subtext?: (text: string) => string;
  success?: (text: string) => string;
  error?: (text: string) => string;
  warning?: (text: string) => string;
}

export interface SidebarState {
  enabled: boolean;
  width: number;
  minTerminalWidth: number;
  todos: TodosState;
  queue: QueueState;
  git: GitInfo | null;
  modelLabel: string;
  tokenCount: number;
  contextWindow: number;
  totalCostUsd: number;
  cwd: string;
  piVersion: string;
  contextFilesCount: number;
  activeSkillsCount: number;
  thinkingLevel: string;
}

export function createDefaultSidebarState(): SidebarState {
  return {
    enabled: false,
    width: 30,
    minTerminalWidth: 150,
        todos: { items: [], sourceFile: null, sourceCount: 0 },
    queue: { steerCount: 0, followUpCount: 0, hasPending: false },
    git: null,
    modelLabel: "",
    tokenCount: 0,
    contextWindow: 0,
    totalCostUsd: 0,
    cwd: "",
    piVersion: "",
    contextFilesCount: 0,
    activeSkillsCount: 0,
    thinkingLevel: "",
  };
}

export function sidebarTotalWidth(state: SidebarState, terminalWidth: number): number {
  if (!state.enabled || terminalWidth < state.minTerminalWidth) return 0;
  const sidebarFraction = Math.max(0.1, Math.min(0.8, state.width / 100));
  return Math.min(Math.max(20, Math.round(terminalWidth * sidebarFraction)), Math.max(20, terminalWidth - 20));
}

export function renderSidebar(state: SidebarState, width: number, height: number, style: SidebarStyle = {}): string[] {
  if (width <= 0 || height <= 0) return [];
  const contentWidth = Math.max(1, width - visibleWidth(LEFT_PADDING));
  const lines: string[] = [];

  const labelText = style.label ?? label;
  const subtextText = style.subtext ?? subtext;
  const bottomRows = bottomIdentityRows(state);
  const contentLimit = Math.max(0, height - bottomRows.length);

  const formatLine = (line = "", decorate = subtextText) => {
    const clipped = truncateToWidth(line, contentWidth, "", true);
    const styled = line ? decorate(clipped) : clipped;
    return `${LEFT_PADDING}${padRight(styled, contentWidth)}`;
  };
  const push = (line = "", decorate = subtextText) => {
    if (lines.length >= contentLimit) return;
    lines.push(formatLine(line, decorate));
  };
  push("Session", labelText);
  push(modelLine(state));
  push(contextLine(state));
  push();

  if (hasOpenTodos(state.todos)) {
    push("TODOs", labelText);
    const openTodos = state.todos.items.filter((item) => !item.done);
    const visibleTodos = openTodos.slice(0, 5);
    for (const item of visibleTodos) push(`☐ ${item.text}`);
    if (openTodos.length > visibleTodos.length) push(`+${openTodos.length - visibleTodos.length} more`);
    push();
  }

  if (state.queue.hasPending) {
    push("Queue", labelText);
    if (state.queue.steerCount > 0) push(`${state.queue.steerCount} steering`);
    if (state.queue.followUpCount > 0) push(`${state.queue.followUpCount} follow-up`);
    push();
  }

  while (lines.length < contentLimit) push();
  for (const row of bottomRows) {
    if (lines.length >= height) break;
    lines.push(formatLine(row));
  }
  return lines;
}

function label(text: string): string {
  return color(LABEL, text);
}

function subtext(text: string): string {
  return color(SUBTEXT, text);
}

function color(ansi: string, text: string): string {
  return `${ansi}${text}${RESET}`;
}

function modelLine(state: SidebarState): string {
  const model = state.modelLabel || "no model";
  if (state.thinkingLevel && state.thinkingLevel.length > 0) {
    return `${model} · ${state.thinkingLevel}`;
  }
  return model;
}

function contextLine(state: SidebarState): string {
  const pct = state.contextWindow > 0 ? ((state.tokenCount / state.contextWindow) * 100).toFixed(1) : "0.0";
  let line = `${fmtNum(state.tokenCount)} (${pct}%) · ${formatCost(state.totalCostUsd)}`;
  if (state.contextFilesCount > 0 || state.activeSkillsCount > 0) {
    const parts: string[] = [];
    if (state.contextFilesCount > 0) parts.push(`${state.contextFilesCount} file` + (state.contextFilesCount !== 1 ? "s" : ""));
    if (state.activeSkillsCount > 0) parts.push(`${state.activeSkillsCount} skill` + (state.activeSkillsCount !== 1 ? "s" : ""));
    line += ` · ${parts.join(" ")}`;
  }
  return line;
}

function bottomIdentityRows(state: SidebarState): string[] {
  return [
    formatSidebarPath(state.cwd, state.git?.branch),
    `Pi ${state.piVersion || "unknown"}`,
  ];
}

function formatSidebarPath(cwd: string, branch?: string): string {
  const home = process.env.HOME;
  const path = home && cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : (cwd || "cwd unknown");
  return branch ? `${path}:${branch}` : path;
}

function padRight(content: string, width: number): string {
  return content + " ".repeat(Math.max(0, width - visibleWidth(content)));
}
