import { Text, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface TodoItem {
  text: string;
  done: boolean;
  blockTitle: string | null;
  status: "active" | "done" | "abandoned" | null;
  sourceFile: string;
}

export interface TodosState {
  items: TodoItem[];
  sourceFile: string | null;
  sourceCount: number;
}

interface BlockState {
  title: string | null;
  status: TodoItem["status"];
  items: TodoItem[];
}

/**
 * Find the canonical TODO.md. Walks up from cwd looking for `.pi/artifacts/TODO.md`.
 * Returns the path if found, null otherwise.
 */
export function findCanonicalTodo(cwd: string): string | null {
  let current = cwd;
  while (true) {
    const direct = join(current, ".pi", "artifacts", "TODO.md");
    if (existsSync(direct)) return direct;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Parse the canonical TODO.md. The file uses a block format:
 *
 *     ### YYYY-MM-DD - <title>
 *     status: active | updated: YYYY-MM-DD
 *
 *     - [ ] step 1
 *     - [x] step 2
 *
 * Each `###` heading opens a new block; the `status:` line sets the block's
 * status; subsequent `- [ ]` / `- [x]` lines are checkboxes belonging to the
 * current block until the next `###` or end of file.
 */
function parseTodoFile(filePath: string): BlockState[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const blocks: BlockState[] = [];
  let current: BlockState = { title: null, status: null, items: [] };

  for (const line of content.split("\n")) {
    const headingMatch = line.match(/^###\s+(.+?)\s*$/);
    if (headingMatch) {
      blocks.push(current);
      current = { title: headingMatch[1], status: null, items: [] };
      continue;
    }

    if (current.title !== null) {
      const statusMatch = line.match(/^status:\s*(\w+)/);
      if (statusMatch) {
        const value = statusMatch[1].toLowerCase();
        if (value === "active" || value === "done" || value === "abandoned") {
          current.status = value;
        }
        continue;
      }

      const checkboxMatch = line.match(/^[-*]\s*\[([ xX]?)\]\s*(.+)$/);
      if (checkboxMatch) {
        current.items.push({
          text: checkboxMatch[2].trim(),
          done: checkboxMatch[1].toLowerCase() === "x",
          blockTitle: current.title,
          status: current.status,
          sourceFile: filePath,
        });
        continue;
      }
    }
  }

  blocks.push(current);
  return blocks.filter((b) => b.items.length > 0);
}

export function scanTodos(cwd: string): TodosState {
  const file = findCanonicalTodo(cwd);
  if (!file) {
    return { items: [], sourceFile: null, sourceCount: 0 };
  }

  const blocks = parseTodoFile(file);
  const items: TodoItem[] = [];
  for (const block of blocks) {
    items.push(...block.items);
  }

  return { items, sourceFile: file, sourceCount: 1 };
}

export function hasOpenTodos(state: TodosState): boolean {
  return state.items.some((item) => !item.done);
}

export function renderTodosWidget(state: TodosState, _tui: TUI, theme: Theme): Text {
  const lines: string[] = [];

  if (state.sourceFile === null) {
    return new Text(theme.fg("muted", "TODOs — No .pi/artifacts/TODO.md found"), 1, 0);
  }

  if (!hasOpenTodos(state)) {
    return new Text(theme.fg("muted", "TODOs — all done"), 1, 0);
  }

  const open = state.items.filter((item) => !item.done);
  const byBlock = new Map<string, TodoItem[]>();
  for (const item of open) {
    const key = item.blockTitle ?? "(uncategorized)";
    const list = byBlock.get(key) ?? [];
    list.push(item);
    byBlock.set(key, list);
  }

  lines.push(`TODOs — ${open.length} open across ${byBlock.size} block(s):`);
  for (const [title, items] of byBlock) {
    lines.push(`  ${theme.fg("accent", title)}`);
    for (const item of items) {
      lines.push(`    ${theme.fg("warning", "☐")} ${item.text}`);
    }
  }

  lines.push("");
  return new Text(lines.join("\n"), 1, 0);
}
