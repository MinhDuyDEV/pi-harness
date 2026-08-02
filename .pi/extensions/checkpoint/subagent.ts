/**
 * Checkpoint Content Generator
 *
 * Reads existing session data from DCP, memory, and disk artifacts to produce
 * structured checkpoint content. No subagent is spawned — all data already
 * exists on disk or in memory. This just connects the dots.
 *
 * DATA SOURCES:
 *   1. DCP Artifact Tracker    → files_read / files_modified
 *   2. DCP Persistent Summary  → discoveries, accomplishments
 *   3. Active Artifacts        → blocks from .pi/artifacts/{TODO,PROGRESS}.md
 *   4. (removed) - was Memory Observations via FTS5; MEMORY.md is now managed
 *      by the user and read on-demand via the memory skill
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ParsedBlock {
  title: string;
  status: "active" | "done" | "abandoned" | null;
  checkboxes: { text: string; done: boolean }[];
  firstContentLines: string[];
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

interface ParsedTodoDocument {
  phases: ParsedTodoPhase[];
}

interface TodoMarkdownModule {
  parseMarkdown(markdown: string): ParsedTodoDocument;
}

const TODO_MARKDOWN_SUBPATH = "@minhduydev/pi-todo/markdown";
let parserPromise: Promise<TodoMarkdownModule | null> | undefined;

/**
 * Load the one canonical artifact Markdown parser. pi-todo is optional for a
 * consumer without it, so absence is explicit rather than falling back to
 * a second regex grammar that can drift.
 */
export function loadCanonicalArtifactParser(): Promise<TodoMarkdownModule | null> {
  parserPromise ??= import(TODO_MARKDOWN_SUBPATH)
    .then((module) => (typeof module.parseMarkdown === "function" ? module : null))
    .catch(() => null);
  return parserPromise;
}

/** Project a pi-todo parsed document into the checkpoint's bounded view. */
export function projectCanonicalBlocks(document: ParsedTodoDocument): ParsedBlock[] {
  return document.phases.map((phase) => {
    const checkboxes: ParsedBlock["checkboxes"] = [];
    const firstContentLines: string[] = [];
    let sawItem = false;
    for (const entry of phase.body) {
      if (entry.type === "item") {
        sawItem = true;
        checkboxes.push({
          text: entry.item.content,
          done:
            entry.item.status === "completed" ||
            entry.item.status === "abandoned",
        });
      } else if (
        !sawItem &&
        firstContentLines.length < 5 &&
        entry.text.trim().length > 0
      ) {
        firstContentLines.push(entry.text);
      }
    }
    return {
      title: phase.date ? `${phase.date} - ${phase.title}` : phase.title,
      status: phase.status,
      checkboxes,
      firstContentLines,
    };
  });
}

export async function parseCanonicalArtifactBlocks(
  content: string,
): Promise<ParsedBlock[] | null> {
  const parser = await loadCanonicalArtifactParser();
  return parser ? projectCanonicalBlocks(parser.parseMarkdown(content)) : null;
}

export interface CheckpointContent {
  discoveries: string;
  filesRead: string[];
  filesModified: string[];
  activeTasks: string;
  memoryObservations?: string;
}

/**
 * Summarize parsed TODO/PROGRESS blocks into the "Active Tasks" lines of a
 * checkpoint. TODO blocks contribute their first checkboxes (fully-done blocks
 * are skipped); active PROGRESS blocks contribute their first content lines.
 * Pure — extracted from generateCheckpointContent for testability.
 */
export function summarizeActiveTasks(
  todoBlocks: readonly ParsedBlock[],
  progressBlocks: readonly ParsedBlock[],
): string {
  const taskLines: string[] = [];

  for (const block of todoBlocks.slice(0, 3)) {
    const open = block.checkboxes.filter((c) => !c.done);
    if (open.length === 0 && block.status === "done") continue;
    taskLines.push(`## ${block.title}`);
    for (const c of block.checkboxes.slice(0, 10)) {
      taskLines.push(c.done ? `- [x] ${c.text}` : `- [ ] ${c.text}`);
    }
  }

  for (const block of progressBlocks.slice(0, 3)) {
    if (block.status === "active") {
      const first = block.firstContentLines.slice(0, 5);
      if (first.length > 0) {
        taskLines.push(`Progress (${block.title}):`, ...first);
      }
    }
  }

  return taskLines.join("\n") || "(no active tasks)";
}

/**
 * Generate structured checkpoint content from existing session data.
 */
export async function generateCheckpointContent(
  piDir: string,
  sessionId: string,
): Promise<CheckpointContent> {
  const result: CheckpointContent = {
    discoveries: "",
    filesRead: [],
    filesModified: [],
    activeTasks: "",
  };

  // 1. DCP Artifact Tracker (files_read / files_modified)
  try {
    const dcp = await import("../dcp/compress.js");
    if (typeof dcp.getArtifactTracker === "function") {
      const tracker = dcp.getArtifactTracker(sessionId);
      result.filesRead = tracker.files_read ?? [];
      result.filesModified = tracker.files_modified ?? [];
    }
    if (typeof dcp.getPersistentSummary === "function") {
      const persistentSummary = dcp.getPersistentSummary(sessionId);
      if (persistentSummary?.narrative_parts?.length > 0) {
        result.discoveries = persistentSummary.narrative_parts
          .map((p: { text: string }) => p.text)
          .join("\n");
      }
    }
  } catch {
    // DCP not available — skip
  }

  // 2. Active work session blocks from canonical .pi/artifacts/{TODO,PROGRESS}.md
  try {
    const artifactsDir = join(piDir, "artifacts");
    const todoPath = join(artifactsDir, "TODO.md");
    const progressPath = join(artifactsDir, "PROGRESS.md");

    const todoBlocks = existsSync(todoPath)
      ? await parseCanonicalArtifactBlocks(readFileSync(todoPath, "utf-8"))
      : [];
    const progressBlocks = existsSync(progressPath)
      ? await parseCanonicalArtifactBlocks(readFileSync(progressPath, "utf-8"))
      : [];

    result.activeTasks =
      todoBlocks === null || progressBlocks === null
        ? "(install @minhduydev/pi-todo to parse canonical artifacts)"
        : summarizeActiveTasks(todoBlocks, progressBlocks);
  } catch {
    result.activeTasks = "(unable to read artifacts)";
  }

  return result;
}
