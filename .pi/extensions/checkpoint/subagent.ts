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
     *   4. (removed) - was Memory Observations via FTS5; now MEMORY.md is injected via before_agent_start in extensions/memory.ts
     */

    import { readdirSync, readFileSync, existsSync } from "node:fs";
    import { join } from "node:path";

    interface ParsedBlock {
      title: string;
      status: "active" | "done" | "abandoned" | null;
      checkboxes: { text: string; done: boolean }[];
      firstContentLines: string[];
    }

    /**
     * Parse a canonical artifact file (TODO.md / PROGRESS.md) into blocks keyed
     * by `### <title>` headings. Returns blocks in file order. Each block carries
     * its status (from the `status:` line, if present), its checkboxes, and the
     * first few content lines under the heading for context.
     */
    function parseActiveBlocks(content: string): ParsedBlock[] {
      const blocks: ParsedBlock[] = [];
      let current: ParsedBlock | null = null;
      let inCheckboxSection = false;

      for (const line of content.split("\n")) {
        const heading = line.match(/^###\s+(.+?)\s*$/);
        if (heading) {
          if (current) blocks.push(current);
          current = {
            title: heading[1],
            status: null,
            checkboxes: [],
            firstContentLines: [],
          };
          inCheckboxSection = false;
          continue;
        }

        if (!current) continue;

        const statusMatch = line.match(/^status:\s*(\w+)/);
        if (statusMatch) {
          const v = statusMatch[1].toLowerCase();
          if (v === "active" || v === "done" || v === "abandoned") {
            current.status = v;
          }
          continue;
        }

        const checkbox = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/);
        if (checkbox) {
          current.checkboxes.push({ text: checkbox[2].trim(), done: checkbox[1].toLowerCase() === "x" });
          inCheckboxSection = true;
          continue;
        }

        // Capture the first few non-checkbox content lines (#### Run Report etc.)
        if (!inCheckboxSection && current.firstContentLines.length < 5 && line.trim().length > 0) {
          current.firstContentLines.push(line);
        }
      }

      if (current) blocks.push(current);
      return blocks;
    }

    interface CheckpointContent {
  discoveries: string;
  filesRead: string[];
  filesModified: string[];
  activeTasks: string;
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

        const taskLines: string[] = [];

        if (existsSync(todoPath)) {
          const blocks = parseActiveBlocks(readFileSync(todoPath, "utf-8"));
          for (const block of blocks.slice(0, 3)) {
            const open = block.checkboxes.filter((c) => !c.done);
            if (open.length === 0 && block.status === "done") continue;
            taskLines.push(`## ${block.title}`);
            for (const c of block.checkboxes.slice(0, 10)) {
              taskLines.push(c.done ? `- [x] ${c.text}` : `- [ ] ${c.text}`);
            }
          }
        }

        if (existsSync(progressPath)) {
          const blocks = parseActiveBlocks(readFileSync(progressPath, "utf-8"));
          for (const block of blocks.slice(0, 3)) {
            if (block.status === "active") {
              const first = block.firstContentLines.slice(0, 5);
              if (first.length > 0) {
                taskLines.push(`Progress (${block.title}):`, ...first);
              }
            }
          }
        }

        result.activeTasks = taskLines.join("\n") || "(no active tasks)";
      } catch {
        result.activeTasks = "(unable to read artifacts)";
      }

  return result;
}
