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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CHECKPOINT_CONFIG, type CheckpointConfig } from "./config.js";
import { generateCheckpointContent, type CheckpointContent } from "./subagent.js";

/** Walk upward from `cwd` (max 10 levels) to the nearest directory containing `.pi`. */
export function findPiDir(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, ".pi"))) return join(dir, ".pi");
    const parent = join(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Read one loosely-typed string field off an unknown context object. */
function looseStringField(ctx: unknown, key: string): string | null {
  if (typeof ctx !== "object" || ctx === null) return null;
  const value = (ctx as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Read the SDK-owned session manager id without coupling callers to a context shape. */
function sessionManagerId(ctx: unknown): string | null {
  if (typeof ctx !== "object" || ctx === null) return null;
  const manager = (ctx as Record<string, unknown>).sessionManager;
  if (typeof manager !== "object" || manager === null) return null;
  const getter = (manager as Record<string, unknown>).getSessionId;
  if (typeof getter !== "function") return null;
  try {
    const value = (getter as () => unknown).call(manager);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort session id from an extension context. The harness does not
 * expose a stable field name across versions, so probe the known spellings.
 */
export function getSessionId(ctx: unknown): string | null {
  return (
    sessionManagerId(ctx) ??
    looseStringField(ctx, "sessionId") ??
    looseStringField(ctx, "session_id") ??
    looseStringField(ctx, "id")
  );
}

// ── Checkpoint I/O ─────────────────────────────────────────────────────────

async function ensureCheckpointDir(piDir: string, sessionId: string): Promise<string> {
  const dir = join(piDir, "checkpoints", sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export interface CheckpointInfo {
  num: number;
  path: string;
  ctime: Date;
}

/** Checkpoint number from a `checkpoint-<n>.md` filename, or null. */
export function parseCheckpointFilename(name: string): number | null {
  const match = name.match(/^checkpoint-(\d+)\.md$/);
  return match ? parseInt(match[1], 10) : null;
}

async function listCheckpoints(piDir: string, sessionId: string): Promise<CheckpointInfo[]> {
  const dir = join(piDir, "checkpoints", sessionId);
  try {
    const entries = await readdir(dir);
    const checkpoints: CheckpointInfo[] = [];
    for (const entry of entries) {
      const num = parseCheckpointFilename(entry);
      if (num !== null) {
        const fullPath = join(dir, entry);
        const s = await stat(fullPath);
        checkpoints.push({ num, path: fullPath, ctime: s.ctime });
      }
    }
    return checkpoints.sort((a, b) => b.num - a.num);
  } catch {
    return [];
  }
}

/** Render the markdown body of a checkpoint file. Pure. */
export function renderCheckpointMarkdown(
  num: number,
  writtenAt: string,
  sessionId: string,
  content: CheckpointContent,
): string {
  const sections: string[] = [`# Checkpoint #${num}`, `Written: ${writtenAt}`, ""];

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
  sections.push(`- Checkpoint #: ${num}`);

  return sections.join("\n");
}

async function writeCheckpoint(
  config: CheckpointConfig,
  piDir: string,
  sessionId: string,
): Promise<string | null> {
  const dir = await ensureCheckpointDir(piDir, sessionId);
  const checkpoints = await listCheckpoints(piDir, sessionId);
  const nextNum = checkpoints.length > 0 ? checkpoints[0].num + 1 : 1;

  const now = new Date().toISOString();

  // Read real data instead of ctx fields
  const content = await generateCheckpointContent(piDir, sessionId);

  const filePath = join(dir, `checkpoint-${nextNum}.md`);
  await writeFile(filePath, renderCheckpointMarkdown(nextNum, now, sessionId, content), "utf-8");

  // FIFO eviction
  await pruneOldCheckpoints(config, piDir, sessionId);

  return filePath;
}

/**
 * FIFO eviction decision: given checkpoints sorted newest-first, return the
 * ones that exceed `maxPerSession` and should be deleted. Pure.
 */
export function selectCheckpointsToPrune<T>(
  checkpoints: readonly T[],
  maxPerSession: number,
): T[] {
  if (checkpoints.length <= maxPerSession) return [];
  return checkpoints.slice(maxPerSession);
}

async function pruneOldCheckpoints(
  config: CheckpointConfig,
  piDir: string,
  sessionId: string,
): Promise<void> {
  const checkpoints = await listCheckpoints(piDir, sessionId);
  for (const cp of selectCheckpointsToPrune(checkpoints, config.maxPerSession)) {
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

/**
 * Wrap checkpoint content (truncated to `rebuildBudget` characters) in the
 * rebuild-context frame injected at session start. Pure.
 */
export function formatRebuildContext(checkpoint: string, rebuildBudget: number): string {
  const truncated = checkpoint.slice(0, rebuildBudget);
  return [
    "\n## Prior Session Context (Checkpoint)",
    "",
    truncated,
    "",
    "Continue from where you left off.",
  ].join("\n");
}

async function renderRebuildContext(
  config: CheckpointConfig,
  piDir: string,
  sessionId: string,
): Promise<string | null> {
  const cp = await loadLatestCheckpoint(piDir, sessionId);
  if (!cp) return null;
  return formatRebuildContext(cp, config.rebuildBudget);
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

export default function (pi: ExtensionAPI): void {
  const config = DEFAULT_CHECKPOINT_CONFIG;
  if (!config.enabled) return;

  // On session_before_compact: write checkpoint with real data
  pi.on("session_before_compact", async (_event, ctx) => {
    if (!config.autoOnCompress) return;
    const piDir = findPiDir(ctx.cwd);
    if (!piDir) return;
    const sessionId = getSessionId(ctx);
    if (!sessionId) return;
    const path = await writeCheckpoint(config, piDir, sessionId);
    // The harness consumed everyone else's events but emitted none of its own
    // (audit roadmap 23); a written checkpoint is a durable fact other
    // extensions (DCP, learning) may correlate with.
    if (path) {
      try {
        pi.events?.emit?.("pi-harness:checkpoint:written:v1", {
          version: 1,
          sessionId,
          path,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // The bus must never break the checkpoint.
      }
    }
  });

  pi.on("session_shutdown", () => {});
}
