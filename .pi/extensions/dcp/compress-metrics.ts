import type { Message } from "@earendil-works/pi-ai";
import { getState } from "./compress-state.js";

import type { DCPConfig } from "./config.js";

function extractPathFromArgs(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  if (args.path) return String(args.path);
  if (args.file) return String(args.file);
  if (args.target) return String(args.target);
  return undefined;
}


export function trackToolCall(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  _config: DCPConfig,

): void {
  const state = getState(sessionId);
  const file = extractPathFromArgs(toolName, args);
  if (!file) return;
  const existing = state.artifactTracker.get(file);
  if (existing) {
    existing.lastSeen = Date.now();
    existing.accessCount++;
  } else {
    state.artifactTracker.set(file, {
      lastSeen: Date.now(),
      accessCount: 1,
      toolName,
      wasCompressed: false,
    });
  }
}

export function getArtifactTracker(sessionId: string) {
  const tracker = getState(sessionId).artifactTracker;
  const files_read: string[] = [];
  const files_modified: string[] = [];
  for (const [path, entry] of tracker) {
    if (entry.toolName === "read" || entry.toolName === "grep" || entry.toolName === "find" || entry.toolName === "ls") {
      if (!files_read.includes(path)) files_read.push(path);
    } else {
      if (!files_modified.includes(path)) files_modified.push(path);
    }
  }
  return { files_read, files_modified };
}

function shouldLogRegression(
  msg: Message,
  recentFiles: string[],
): boolean {
  if (msg.role === "toolResult" && Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c && typeof c === "object" && "file" in c) {
        const file = typeof c.file === "string" ? c.file : undefined;
        if (file && recentFiles.some((rf) => file.includes(rf))) {
          return true;
        }
      }
    }
  }
  return false;
}

function scanNewReReads(
  messages: readonly Message[],
  sessionId: string,
): number {
  const state = getState(sessionId);
  if (!state.recentCompressFiles) return 0;
  const recentFiles = state.recentCompressFiles.files;
  let count = 0;
  for (const msg of messages) {
    if (shouldLogRegression(msg, recentFiles)) {
      count++;
    }
  }
  return count;
}

export function checkCompressionRegression(
  messages: readonly Message[],
  sessionId: string,
  config: DCPConfig,
): boolean {
  const count = scanNewReReads(messages, sessionId);
  if (count > 0) {
    getState(sessionId).qualityMetrics.reReadsAfterCompress += count;
    return true;
  }
  return false;
}

export function recordCompressEvent(
  sessionId: string,
  blockId: number,
  fields: { files_read: string[]; files_modified: string[] },
): void {
  const state = getState(sessionId);
  const qm = state.qualityMetrics;
  qm.totalCompressions++;
  qm.cleanCompressions++;
  state.recentCompressFiles = {
    files: [...fields.files_read, ...fields.files_modified],
    turn: state.currentTurn,
  };
  // Guard: clear re-read detection for the next turn
  state.reReadSeenKeys.clear();
  // Mark artifacts as compressed
  const allFiles = [...fields.files_read, ...fields.files_modified];
  for (const f of allFiles) {
    const entry = state.artifactTracker.get(f);
    if (entry) entry.wasCompressed = true;
  }
}

export function getQualityStatus(sessionId: string): string {
  const qm = getState(sessionId).qualityMetrics;
  const lastResults = qm.lastProbeResults;
  const failedProbes = lastResults
    ? lastResults.probes.filter((p) => !p.pass).length
    : 0;
  const probeSummary = lastResults
    ? `${lastResults.allPassed ? "all passed" : `${failedProbes} failed`} (score: ${lastResults.overallScore})`
    : "no probes yet";
  const regressions = qm.regressionLog.length;
  return [
    `Compressions: ${qm.totalCompressions}`,
    `Clean compressions: ${qm.cleanCompressions}`,
    `Re-reads after compress: ${qm.reReadsAfterCompress}`,
    `Regressions: ${regressions}`,
    `Latest probes: ${probeSummary}`,
    `Avg probe score: ${qm.avgProbeScore.toFixed(1)}`,
  ].join(" | ");
}
