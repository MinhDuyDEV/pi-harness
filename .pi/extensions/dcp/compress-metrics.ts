import type { Message } from "@earendil-works/pi-ai";
import { getState } from "./compress-state.js";
import type { QualityMetricsData } from "./compress-types.js";
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

export { extractPathFromArgs };

export function trackToolCall(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  config: DCPConfig,
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
      if (c && typeof c === "object") {
        const block = c as Record<string, unknown>;
        const file = block.file as string | undefined;
        if (file && recentFiles.some((rf) => file?.includes(rf))) {
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

export function detectReadRegression(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  config: DCPConfig,
): boolean {
  const state = getState(sessionId);
  if (!state.recentCompressFiles) return false;
  const file = extractPathFromArgs(toolName, args);
  if (!file) return false;
  const isReRead = state.recentCompressFiles.files.includes(file);
  if (isReRead) {
    state.qualityMetrics.reReadsAfterCompress++;
    const blockId =
      state.blocks.length > 0
        ? state.blocks[state.blocks.length - 1].blockId
        : 0;
    state.qualityMetrics.regressionLog.push({
      blockId,
      file,
      turnGap: state.currentTurn - state.recentCompressFiles.turn,
      timestamp: Date.now(),
    });
    if (state.qualityMetrics.regressionLog.length > 100) {
      state.qualityMetrics.regressionLog =
        state.qualityMetrics.regressionLog.slice(-50);
    }
  }
  return isReRead;
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

export function recordCompressFiles(
  sessionId: string,
  files: readonly string[],
): void {
  const state = getState(sessionId);
  state.recentCompressFiles = { files: [...files], turn: state.currentTurn };
}

export function markArtifactsCompressed(
  sessionId: string,
  files: readonly string[],
): void {
  const tracker = getState(sessionId).artifactTracker;
  for (const f of files) {
    const entry = tracker.get(f);
    if (entry) entry.wasCompressed = true;
  }
}

export function getQualityStatus(sessionId: string): string {
  const qm = getState(sessionId).qualityMetrics;
  const lastResults = qm.lastProbeResults;
  const probeSummary = lastResults
    ? `${lastResults.allPassed ? "all passed" : `${lastResults.failedProbes} failed`} (score: ${lastResults.overallScore})`
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

export function evaluateQuality(
  qualityMetrics: QualityMetricsData,
): { status: string; numericalScore: number; details: string[] } {
  const details: string[] = [];
  let score = 100;

  const rereadPenalty = Math.min(
    qualityMetrics.reReadsAfterCompress * 10,
    50,
  );
  if (rereadPenalty > 0) {
    details.push(
      `-${rereadPenalty} points: ${qualityMetrics.reReadsAfterCompress} re-read after compress`,
    );
    score -= rereadPenalty;
  }

  const probePenalty = qualityMetrics.failedProbes * 15;
  if (probePenalty > 0) {
    details.push(
      `-${probePenalty} points: ${qualityMetrics.failedProbes} probe failures`,
    );
    score -= probePenalty;
  }

  if (
    qualityMetrics.lastProbeResults &&
    qualityMetrics.totalCompressions > 0
  ) {
    const probeScore = qualityMetrics.lastProbeResults.overallScore;
    if (probeScore < 70) {
      const penalty = Math.round((70 - probeScore) / 2);
      details.push(`-${penalty} points: low probe score (${probeScore})`);
      score -= penalty;
    }
  }

  const status = score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
  return {
    status,
    numericalScore: Math.max(0, score),
    details,
  };
}
