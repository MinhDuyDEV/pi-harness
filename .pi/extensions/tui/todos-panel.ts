import { Text, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * TODO.md display projection for the TUI sidebar / below-editor widget.
 *
 * ── Ownership boundary (audit H5) ───────────────────────────────────────────
 * `@minhduydev/pi-todo` is the SINGLE owner and parser of the canonical
 * `.pi/artifacts/TODO.md` format. This module only projects the parsed document
 * into the TUI's smaller display shape. The parser is loaded lazily because
 * pi-todo is an optional peer of the harness; when it is absent, the panel
 * reports that the parser is unavailable instead of silently inventing a
 * second grammar.
 */

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
  parserAvailable?: boolean;
}

interface ParsedTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed" | "abandoned" | "blocked";
}

interface ParsedTodoPhase {
  title: string;
  date?: string;
  status: "active" | "done" | "abandoned";
  body: Array<{ type: "item"; item: ParsedTodoItem } | { type: "note"; text: string }>;
}

interface TodoMarkdownModule {
  parseMarkdown(markdown: string): { phases: ParsedTodoPhase[] };
}

const TODO_MARKDOWN_SUBPATH = "@minhduydev/pi-todo/markdown";
let parserPromise: Promise<TodoMarkdownModule | null> | undefined;

/** Load the canonical parser once, without making the optional peer mandatory. */
export function loadTodoParser(): Promise<TodoMarkdownModule | null> {
  parserPromise ??= import(TODO_MARKDOWN_SUBPATH)
    .then((module) => (typeof module.parseMarkdown === "function" ? module : null))
    .catch(() => null);
  return parserPromise;
}

/**
 * Find the canonical TODO.md. Walks up from cwd looking for
 * `.pi/artifacts/TODO.md` (pi-todo's default `todoFile`, resolved against the
 * project root). Returns the path if found, null otherwise. Path discovery,
 * not parsing — the walk-up is TUI-specific (sessions may start in a subdir).
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

function phaseTitle(phase: ParsedTodoPhase): string {
  return phase.date ? `${phase.date} - ${phase.title}` : phase.title;
}

/** Project the canonical pi-todo document into the TUI shape. */
function projectParsedDocument(
  filePath: string,
  document: { phases: ParsedTodoPhase[] },
): TodoItem[] {
  const items: TodoItem[] = [];
  for (const phase of document.phases) {
    for (const entry of phase.body) {
      if (entry.type !== "item") continue;
      items.push({
        text: entry.item.content,
        done: entry.item.status === "completed" || entry.item.status === "abandoned",
        blockTitle: phaseTitle(phase),
        status: phase.status,
        sourceFile: filePath,
      });
    }
  }
  return items;
}

async function readCanonicalItems(
  filePath: string,
  parser: TodoMarkdownModule,
): Promise<TodoItem[]> {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  return projectParsedDocument(filePath, parser.parseMarkdown(content));
}

export async function scanTodos(cwd: string): Promise<TodosState> {
  const file = findCanonicalTodo(cwd);
  if (!file) {
    return { items: [], sourceFile: null, sourceCount: 0, parserAvailable: true };
  }
  const parser = await loadTodoParser();
  if (!parser) {
    return { items: [], sourceFile: file, sourceCount: 0, parserAvailable: false };
  }
  return {
    items: await readCanonicalItems(file, parser),
    sourceFile: file,
    sourceCount: 1,
    parserAvailable: true,
  };
}

export function hasOpenTodos(state: TodosState): boolean {
  return state.items.some((item) => !item.done);
}

export function renderTodosWidget(state: TodosState, _tui: TUI, theme: Theme): Text {
  const lines: string[] = [];

  if (state.sourceFile === null) {
    return new Text(theme.fg("muted", "TODOs — No .pi/artifacts/TODO.md found"), 1, 0);
  }

  if (state.parserAvailable === false) {
    return new Text(theme.fg("warning", "TODOs — install @minhduydev/pi-todo to parse TODO.md"), 1, 0);
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
