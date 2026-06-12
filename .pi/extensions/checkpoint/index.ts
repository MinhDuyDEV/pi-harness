/**
 * Checkpoint Writer Extension
 *
 * Writes structured session state to markdown files on key events.
 * Uses generateCheckpointContent() to read from DCP, memory, and artifacts
 * instead of relying on empty ctx fields.
 *
 * Triggers:
 * - session_before_compact (DCP compress) — only save point
 * - session_shutdown (cleanup)
 *
 * On session start: injects rebuild context from latest checkpoint.
 */

import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { DEFAULT_CHECKPOINT_CONFIG, type CheckpointConfig } from "./config.js";
import { generateCheckpointContent } from "./subagent.js";

function findPiDir(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, ".pi"))) return join(dir, ".pi");
    const parent = join(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function getSessionId(ctx: any): string | null {
  return ctx?.sessionId || ctx?.session_id || ctx?.id || null;
}

// ── Checkpoint I/O ─────────────────────────────────────────────────────────

async function ensureCheckpointDir(piDir: string, sessionId: string): Promise<string> {
  const dir = join(piDir, "checkpoints", sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

interface CheckpointInfo {
  num: number;
  path: string;
  ctime: Date;
}

async function listCheckpoints(piDir: string, sessionId: string): Promise<CheckpointInfo[]> {
  const dir = join(piDir, "checkpoints", sessionId);
  try {
    const entries = await readdir(dir);
    const checkpoints: CheckpointInfo[] = [];
    for (const entry of entries) {
      const match = entry.match(/^checkpoint-(\d+)\.md$/);
      if (match) {
        const fullPath = join(dir, entry);
        const s = await stat(fullPath);
        checkpoints.push({ num: parseInt(match[1]), path: fullPath, ctime: s.ctime });
      }
    }
    return checkpoints.sort((a, b) => b.num - a.num);
  } catch {
    return [];
  }
}

async function writeCheckpoint(
  config: CheckpointConfig,
  piDir: string,
  _ctx: any,
  sessionId: string,
): Promise<string | null> {
  const dir = await ensureCheckpointDir(piDir, sessionId);
  const checkpoints = await listCheckpoints(piDir, sessionId);
  const nextNum = checkpoints.length > 0 ? checkpoints[0].num + 1 : 1;

  const now = new Date().toISOString();

  // Read real data instead of ctx fields
  const content = await generateCheckpointContent(piDir, sessionId);

  const sections: string[] = [
    `# Checkpoint #${nextNum}`,
    `Written: ${now}`,
    "",
  ];

  // Discoveries
  sections.push("## Discoveries");
  sections.push(content.discoveries || "(no discoveries recorded yet)");
  sections.push("");

  // Files touched
  sections.push("## Files Touched");
  if (content.filesModified.length > 0) {
    sections.push(`Modified: ${content.filesModified.slice(0, 10).join(", ")}`);
  }
  if (content.filesRead.length > 0) {
    sections.push(`Read: ${content.filesRead.slice(0, 10).join(", ")}`);
  }
  if (content.filesModified.length === 0 && content.filesRead.length === 0) {
    sections.push("No files tracked yet.");
  }
  sections.push("");

  // Active tasks
  sections.push("## Active Tasks");
  sections.push(content.activeTasks || "(no active tasks)");
  sections.push("");

  // Memory observations
  if (content.memoryObservations) {
    sections.push("## Recent Observations");
    sections.push(content.memoryObservations);
    sections.push("");
  }

  // Footer
  sections.push("## Session State");
  sections.push(`- Session: ${sessionId}`);
  sections.push(`- Checkpoint #: ${nextNum}`);

  const filePath = join(dir, `checkpoint-${nextNum}.md`);
  await writeFile(filePath, sections.join("\n"), "utf-8");

  // FIFO eviction
  await pruneOldCheckpoints(config, piDir, sessionId);

  return filePath;
}

async function pruneOldCheckpoints(
  config: CheckpointConfig,
  piDir: string,
  sessionId: string,
): Promise<void> {
  const checkpoints = await listCheckpoints(piDir, sessionId);
  if (checkpoints.length <= config.maxPerSession) return;
  const toDelete = checkpoints.slice(config.maxPerSession);
  for (const cp of toDelete) {
    try {
      await unlink(cp.path);
    } catch {
      /* ignore */
    }
  }
}

async function listAllCheckpoints(piDir: string): Promise<CheckpointInfo[]> {
  const root = join(piDir, "checkpoints");
  try {
    const sessions = await readdir(root, { withFileTypes: true });
    const all: CheckpointInfo[] = [];
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      all.push(...(await listCheckpoints(piDir, session.name)));
    }
    return all.sort((a, b) => b.ctime.getTime() - a.ctime.getTime());
  } catch {
    return [];
  }
}

async function loadLatestCheckpoint(piDir: string, sessionId: string): Promise<string | null> {
  let checkpoints = await listCheckpoints(piDir, sessionId);
  if (checkpoints.length === 0) {
    checkpoints = await listAllCheckpoints(piDir);
  }
  if (checkpoints.length === 0) return null;
  try {
    return await readFile(checkpoints[0].path, "utf-8");
  } catch {
    return null;
  }
}

async function renderRebuildContext(
  config: CheckpointConfig,
  piDir: string,
  sessionId: string,
): Promise<string | null> {
  const cp = await loadLatestCheckpoint(piDir, sessionId);
  if (!cp) return null;

  const lines = cp.slice(0, config.rebuildBudget);
  const parts: string[] = [];

  parts.push(
    "\n## Prior Session Context (Checkpoint)",
    "",
    lines,
    "",
    "Continue from where you left off.",
  );

  return parts.join("\n");
}

// ── Extension Entry Point ───────────────────────────────────────────────────

export async function getCheckpointRebuildContext(
  cwd: string,
  sessionId: string,
  config: CheckpointConfig = DEFAULT_CHECKPOINT_CONFIG,
): Promise<string | null> {
  if (!config.enabled) return null;
  const piDir = findPiDir(cwd);
  if (!piDir) return null;
  return renderRebuildContext(config, piDir, sessionId);
}

export default function (pi: any): void {
  const config = DEFAULT_CHECKPOINT_CONFIG;
  if (!config.enabled) return;

  // On session_before_compact: write checkpoint with real data
  pi.on("session_before_compact", async (_event: any, ctx: any) => {
    if (!config.autoOnCompress) return;
    const piDir = findPiDir(ctx.cwd);
    if (!piDir) return;
    const sessionId = getSessionId(ctx);
    if (!sessionId) return;
    await writeCheckpoint(config, piDir, ctx, sessionId);
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", () => {});
}
