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
 *   3. Active Artifacts        → TODO.md / PROGRESS.md from .pi/artifacts/<id>/
 *   4. Memory Observations     → recent session observations (FTS5)
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface CheckpointContent {
  discoveries: string;
  filesRead: string[];
  filesModified: string[];
  activeTasks: string;
  memoryObservations: string;
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
    memoryObservations: "",
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

  // 2. Active artifacts from .pi/artifacts/<id>/ directories (most recent first)
  try {
    const artifactsDir = join(piDir, "artifacts");
    if (existsSync(artifactsDir)) {
      const entries = readdirSync(artifactsDir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .reverse()
        .slice(0, 3); // 3 most recent

      const taskLines: string[] = [];
      for (const dir of dirs) {
        const artifactDir = join(artifactsDir, dir);
        const todoPath = join(artifactDir, "TODO.md");
        const progressPath = join(artifactDir, "PROGRESS.md");

        if (existsSync(todoPath)) {
          const todo = readFileSync(todoPath, "utf-8").trim();
          // Extract task summary: first paragraph + checkbox items
          const lines = todo.split("\n").filter(
            (l) => l.includes("- [ ]") || l.includes("- [x]"),
          );
          if (lines.length > 0) {
            taskLines.push(`## ${dir}`);
            taskLines.push(...lines.slice(0, 10)); // cap at 10 checkboxes
          }
        }
        if (existsSync(progressPath)) {
          const progress = readFileSync(progressPath, "utf-8").trim();
          const firstLines = progress.split("\n").slice(0, 5);
          taskLines.push(`Progress (${dir}):`, ...firstLines);
        }
      }
      result.activeTasks = taskLines.join("\n") || "(no active tasks)";
    }
  } catch {
    result.activeTasks = "(unable to read artifacts)";
  }

  // 3. Memory observations from this session (FTS5)
  try {
    const memoryModule = await import("../memory/db.js");
    if (typeof memoryModule.getMemoryDB === "function") {
      const db = memoryModule.getMemoryDB();
      if (db) {
        const rows = db
          .prepare(
            `SELECT narrative FROM observations
             ORDER BY created_at_epoch DESC
             LIMIT 5`,
          )
          .all() as { narrative: string }[];
        if (rows.length > 0) {
          result.memoryObservations = rows
            .map((r) => `- ${r.narrative.slice(0, 200)}`)
            .join("\n");
        }
      }
    }
  } catch {
    // Memory DB not available — skip
  }

  return result;
}
