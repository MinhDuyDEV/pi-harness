import { Text, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * TODO.md display projection for the TUI sidebar / below-editor widget.
 *
 * ── Ownership boundary (audit H5) ───────────────────────────────────────────
 * `@minhduydev/pi-todo` (pinned as `npm:@minhduydev/pi-todo@0.3.0` in
 * `.pi/settings.json`) is the SINGLE owner and parser of the canonical
 * `.pi/artifacts/TODO.md` format. This module is NOT a second parser — it is a
 * read-only display projection that recognizes only the three line shapes
 * pi-todo's serializer emits:
 *
 *   ### [YYYY-MM-DD - ]<title>          → phase heading (used verbatim as block title)
 *   status: <s>[ | updated: <date>]     → phase status (active | done | abandoned)
 *   <indent><bullet> [<mark>] <content> → item; mark ∈ { " ", "/", "!", "x", "X", "-" }
 *
 * Item marks map to a single open/closed bit: open = pending(" ") /
 * in_progress("/") / blocked("!"); closed = completed("x"/"X") / abandoned("-").
 * Everything pi-todo treats as structure beyond that is deliberately NOT
 * re-implemented here and must not creep back in:
 *   - no `- []` empty-bracket or oh-my-pi alias (`- > `, `- ~ `) forms —
 *     pi-todo's parser rejects/normalizes those, so displaying them would make
 *     the panel disagree with the owner;
 *   - no `(#id)` / `[blocks …]` / `[blocked by …]` / `(note: …)` annotation
 *     parsing — item content is shown verbatim;
 *   - no ref resolution, no mutation, no write path.
 *
 * Why not just import pi-todo? v0.3.0's `exports` map exposes only ".",
 * "./core", "./events" and "./replay"; the parser (`parseMarkdown` in
 * `dist/markdown.js`) is not reachable through any public subpath, so a
 * dynamic optional-peer import (the learning-coordinator/source-ports.ts
 * pattern) has no public API to call. When pi-todo ships a parse export
 * (e.g. a "./markdown" subpath re-exporting `parseMarkdown`), replace
 * `readCanonicalItems` with that import and delete the regexes below.
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

/** `### <title>` — mirrors pi-todo's heading test (`/^#{3}\s+\S/`). */
const HEADING_RE = /^###\s+(\S.*?)\s*$/;
/** Canonical meta line: `status: <s>` or `status: <s> | updated: <date>`. */
const META_RE = /^status:\s*(\w+)\s*(?:\|\s*updated:\s*\S+\s*)?$/i;
/** Canonical item line — the exact checkbox shape pi-todo emits. */
const ITEM_RE = /^\s*[-*+]\s+\[([ xX/\-!])\]\s*(.*)$/;

const PHASE_STATUSES = new Set(["active", "done", "abandoned"]);
/** Marks whose item is closed: completed ("x"/"X") or abandoned ("-"). */
const CLOSED_MARKS = new Set(["x", "X", "-"]);

/**
 * Minimal reader for the canonical serialized format (see boundary note
 * above). Lines before the first heading are preamble (never items); a block
 * without a meta line defaults to "active", matching pi-todo's parse default.
 */
function readCanonicalItems(filePath: string): TodoItem[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const items: TodoItem[] = [];
  let blockTitle: string | null = null;
  let blockStatus: TodoItem["status"] = null;

  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      blockTitle = heading[1];
      blockStatus = "active";
      continue;
    }
    if (blockTitle === null) continue; // preamble

    const meta = line.match(META_RE);
    if (meta) {
      const value = meta[1].toLowerCase();
      if (PHASE_STATUSES.has(value)) blockStatus = value as TodoItem["status"];
      continue;
    }

    const item = line.match(ITEM_RE);
    if (item) {
      items.push({
        text: item[2].trim(),
        done: CLOSED_MARKS.has(item[1]),
        blockTitle,
        status: blockStatus,
        sourceFile: filePath,
      });
    }
  }

  return items;
}

export function scanTodos(cwd: string): TodosState {
  const file = findCanonicalTodo(cwd);
  if (!file) {
    return { items: [], sourceFile: null, sourceCount: 0 };
  }
  return { items: readCanonicalItems(file), sourceFile: file, sourceCount: 1 };
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
