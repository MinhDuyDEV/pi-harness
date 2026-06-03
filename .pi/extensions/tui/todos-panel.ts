import { Text, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface TodoItem {
  text: string;
  done: boolean;
  sourceFile: string;
}

export interface TodosState {
  items: TodoItem[];
  sourceCount: number;
}

function resolveArtifactsDir(cwd: string): string | null {
  let current = cwd;
  while (true) {
    const direct = join(current, "artifacts");
    if (basename(current) === ".pi" && existsSync(direct)) return direct;

    const nested = join(current, ".pi", "artifacts");
    if (existsSync(nested)) return nested;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Resolve one active TODO.md instead of aggregating every historical artifact.
 * If Pi is launched inside .pi/artifacts/<id>/..., that artifact wins. Otherwise,
 * use the most recently changed artifact TODO.md as the active workflow.
 */
function findTodoFiles(basePath: string, maxDepth = 4): string[] {
  const artifactsDir = resolveArtifactsDir(basePath);
  if (!artifactsDir) return [];

  const nearest = findNearestArtifactTodo(basePath, artifactsDir);
  if (nearest) return [nearest];

  const latest = findLatestArtifactTodo(artifactsDir, maxDepth);
  return latest ? [latest] : [];
}

function findNearestArtifactTodo(basePath: string, artifactsDir: string): string | null {
  let current = basePath;
  while (current !== artifactsDir && isSameOrInside(current, artifactsDir)) {
    const todoPath = join(current, "TODO.md");
    if (existsSync(todoPath)) return todoPath;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function findLatestArtifactTodo(artifactsDir: string, maxDepth: number): string | null {
  const candidates: string[] = [];

  function scan(dir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, depth + 1);
        } else if (entry.name.toLowerCase() === "todo.md") {
          candidates.push(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  scan(artifactsDir, 0);
  return candidates.sort((a, b) => statMtimeMs(b) - statMtimeMs(a) || a.localeCompare(b))[0] ?? null;
}

function isSameOrInside(path: string, dir: string): boolean {
  let current = path;
  while (true) {
    if (current === dir) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function statMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function parseTodoFile(filePath: string): TodoItem[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const items: TodoItem[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      // Match markdown checkboxes: - [ ] or - [x]
      const match = trimmed.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/);
      if (match) {
        items.push({
          text: match[2].trim(),
          done: match[1].toLowerCase() === "x",
          sourceFile: filePath,
        });
      }
    }

    return items;
  } catch {
    return [];
  }
}

export function scanTodos(cwd: string): TodosState {
  const files = findTodoFiles(cwd);
  const allItems: TodoItem[] = [];

  for (const file of files) {
    const items = parseTodoFile(file);
    allItems.push(...items);
  }

  return {
    items: allItems,
    sourceCount: files.length,
  };
}

export function hasOpenTodos(state: TodosState): boolean {
  return state.items.some((item) => !item.done);
}

export function renderTodosWidget(state: TodosState, _tui: TUI, theme: Theme): Text {
  const lines: string[] = [];

  if (!hasOpenTodos(state)) {
    if (state.sourceCount === 0) {
      return new Text(theme.fg("muted", "  TODOs — No TODO.md files found in .pi/artifacts/"), 0, 0);
    }
    return new Text(theme.fg("muted", `  TODOs — ${state.sourceCount} file(s), all done`), 0, 0);
  }

  lines.push(`  TODOs — ${state.sourceCount} file(s):`);

  for (const item of state.items.filter((todo) => !todo.done)) {
    lines.push(`    ${theme.fg("warning", "☐")} ${item.text}`);
  }

  return new Text(lines.join("\n"), 0, 0);
}
