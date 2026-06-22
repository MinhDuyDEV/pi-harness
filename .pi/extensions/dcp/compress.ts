/**
 * DCP Extension — Compression Engine
 *
 * Compression block management, compress tool registration,
 * deterministic compaction, durable state, and context-event message stripping
 * (compress-strip, dedup, purge-errors).
 */

import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import type { DCPConfig, ProbeConfig } from "./config.js";
import { applyCompressStrip } from "./compress-strip.js";
import { applyDedup, applyPurgeErrors } from "./compress-dedup.js";
import { pruneToolResults } from "./compress-prune.js";
import {
  getSessionKey,
  loadDurableSessionState,
  saveDurableSessionState,
  type DurableSessionState,
} from "./storage.js";

export const DCP_STATE_ENTRY_TYPE = "dcp_state";

export interface DcpStateEntryPayload {
  version: 1;
  reason: string;
  snapshot: DurableSessionState;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Custom message types (internal to DCP extension)
// ---------------------------------------------------------------------------

/** Custom message type for DCP compressed summaries */
interface DCPCompressedSummaryMessage {
  role: "custom";
  customType: "dcp-compressed-summary";
  content: string;
  display: boolean;
  timestamp: number;
}

/** Internal Pi message type for bash execution results */
interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
}

/** Internal Pi message type for compaction summaries */
interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
}

/** Internal Pi message type for branch summaries */
interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
}

// ---------------------------------------------------------------------------
// Structured summary types (P0: Factory-style structured fields)
// ---------------------------------------------------------------------------

/** Structured fields for a compression event */
export interface StructuredSummaryFields {
  files_read: string[];
  files_modified: string[];
  decisions: string[];
  next_steps: string[];
}

/**
 * Persistent session summary — accumulated across all compressions.
 * Factory pattern: anchored iterative summarization.
 */
export interface PersistentSessionSummary {
  /** All files ever read, deduplicated (most recent first) */
  files_read: string[];
  /** All files ever modified, deduplicated (most recent first) */
  files_modified: string[];
  /** Accumulated decisions with provenance */
  decisions: Array<{ text: string; block_id: number; timestamp: number }>;
  /** Accumulated narrative segments ordered by time */
  narrative_parts: Array<{ text: string; block_id: number }>;
  /** Current next steps (from most recent compress) */
  next_steps: Array<{ text: string; block_id: number; timestamp: number }>;
  last_updated: number;
  merged_block_ids: number[];
  topic: string;
}

// ---------------------------------------------------------------------------
// Artifact tracking types (P1: file-path harvesting from tool calls)
// ---------------------------------------------------------------------------

export interface ArtifactTrackerEntry {
  lastSeen: number;
  accessCount: number;
  toolName: string;
  /** Whether this file was in a compressed range */
  wasCompressed: boolean;
}

/** Tools whose outputs are regeneratable and safe to compact */
const COMPACTABLE_TOOLS = new Set([
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "glob",
  "webfetch",
  "websearch",
  "codesearch",
  "grepsearch",
  "multi_grep",
]);

/**
 * Check if a tool is compactable (its outputs can be safely replaced with a placeholder).
 * Uses the built-in compactable list; override via config.toolResultPruning.compactableTools.
 */
export function isCompactableTool(toolName: string): boolean {
  return COMPACTABLE_TOOLS.has(toolName);
}

/** Tools whose path arguments should be tracked as "read" operations */
export const READ_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "multi_grep",
  "grepsearch",
  "web_fetch",
  "webclaw_scrape",
  "webclaw_batch",
  "memory-search",
  "observation",
  "context7",
]);

/** Tools whose path arguments should be tracked as "modify" operations */
const MODIFY_TOOLS = new Set(["write", "edit"]);

// ---------------------------------------------------------------------------
// Quality metrics types (P1: regression detection)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Probe evaluation types (P1 enhancement: probe-based quality evaluation)
// ---------------------------------------------------------------------------

export interface ProbeResult {
  name: string;
  pass: boolean;
  score: number;
  detail: string;
}

export interface ProbeEvaluationResult {
  probes: ProbeResult[];
  overallScore: number;
  allPassed: boolean;
  summaryTokens: number;
  fieldsCount: number;
}

export interface RegressionEvent {
  blockId: number;
  file: string;
  turnGap: number;
  timestamp: number;
}

export interface QualityMetricsData {
  reReadsAfterCompress: number;
  totalCompressions: number;
  cleanCompressions: number;
  regressionLog: RegressionEvent[];
  lastProbeResults?: ProbeEvaluationResult;
  avgProbeScore: number;
  failedProbes: number;
}

// ---------------------------------------------------------------------------
// In-memory block storage
// ---------------------------------------------------------------------------

export interface CompressionBlock {
  blockId: number;
  topic: string;
  summary: string;
  startLabel: string;
  endLabel: string;
  summaryTokens: number;
  createdAt: number; // timestamp
  metadata?: Record<string, unknown>;
}

export interface SessionState {
  blocks: CompressionBlock[];
  nextBlockId: number;
  /** Cumulative tokens saved by compression stripping */
  totalStrippedTokens: number;
  /** Cumulative items pruned by dedup/purge */
  totalPrunedCount: number;
  /** P0: Persistent merged summary across all compressions */
  persistentSummary: PersistentSessionSummary;
  /** P1: Artifact tracking per file */
  artifactTracker: Map<string, ArtifactTrackerEntry>;
  /** P1: Quality / regression metrics */
  qualityMetrics: QualityMetricsData;
  /** P2: Guard: files in most recent compression (for re-read detection) */
  recentCompressFiles: { files: string[]; turn: number } | null;
  /** Current turn counter */
  currentTurn: number;
}

const sessions = new Map<string, SessionState>();

function emptyPersistentSummary(): PersistentSessionSummary {
  return {
    files_read: [],
    files_modified: [],
    decisions: [],
    narrative_parts: [],
    next_steps: [],
    last_updated: 0,
    merged_block_ids: [],
    topic: "session",
  };
}

export function getDcpSessionId(
  ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
): string {
  return ctx.sessionManager.getSessionFile() ?? ctx.cwd;
}

export function getState(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    const durable = loadDurableSessionState(sessionId);
    s = durable ? sessionStateFromDurable(durable) : newSessionState();
    sessions.set(sessionId, s);
  }
  return s;
}

function newSessionState(): SessionState {
  return {
    blocks: [],
    nextBlockId: 1,
    totalStrippedTokens: 0,
    totalPrunedCount: 0,
    persistentSummary: emptyPersistentSummary(),
    artifactTracker: new Map(),
    qualityMetrics: {
      reReadsAfterCompress: 0,
      totalCompressions: 0,
      cleanCompressions: 0,
      regressionLog: [],
      avgProbeScore: 0,
      failedProbes: 0,
    },
    recentCompressFiles: null,
    currentTurn: 0,
  };
}

function sessionStateFromDurable(durable: DurableSessionState): SessionState {
  const state = newSessionState();
  state.blocks = durable.blocks.map((block, index) => ({
    blockId: Number(block.id.replace(/^b/, "")) || index + 1,
    topic: block.topic,
    summary: block.summary,
    startLabel: block.startMessageId ?? "durable",
    endLabel: block.endMessageId ?? "durable",
    summaryTokens: Math.ceil(block.summary.length / 4),
    createdAt: block.createdAt,
    metadata: {
      files_read: block.filesRead,
      files_modified: block.filesModified,
      decisions: block.decisions,
      next_steps: block.nextSteps,
      start_message_id: block.startMessageId,
      end_message_id: block.endMessageId,
      bead_id: block.beadId,
      source: block.source,
    },
  }));
  state.nextBlockId = Math.max(
    1,
    ...state.blocks.map((block) => block.blockId + 1),
  );
  state.artifactTracker = new Map(
    durable.artifacts.map((artifact) => [artifact.path, artifact]),
  );
  if (
    durable.persistentSummary &&
    typeof durable.persistentSummary === "object"
  ) {
    state.persistentSummary =
      durable.persistentSummary as PersistentSessionSummary;
  }
  state.qualityMetrics.totalCompressions = durable.compressEventCount;
  state.currentTurn = durable.lastCompressTurn;
  return state;
}

function durableFromSessionState(
  sessionId: string,
  state: SessionState,
): DurableSessionState {
  return {
    version: 1,
    sessionId,
    sessionKey: getSessionKey(sessionId),
    blocks: state.blocks.map((block) => ({
      id: `b${block.blockId}`,
      topic: block.topic,
      summary: block.summary,
      filesRead: parseMetadataArray(block.metadata?.files_read),
      filesModified: parseMetadataArray(block.metadata?.files_modified),
      decisions: parseMetadataArray(block.metadata?.decisions),
      nextSteps: parseMetadataArray(block.metadata?.next_steps),
      createdAt: block.createdAt,
      startMessageId: parseMetadataString(block.metadata?.start_message_id),
      endMessageId: parseMetadataString(block.metadata?.end_message_id),
      beadId: parseMetadataString(block.metadata?.bead_id),
      source: parseMetadataString(block.metadata?.source),
    })),
    artifacts: Array.from(state.artifactTracker.entries()).map(
      ([path, artifact]) => ({ path, ...artifact }),
    ),
    persistentSummary: state.persistentSummary,
    processedMessageIds: [],
    lastDigest: undefined,
    compressEventCount: state.qualityMetrics.totalCompressions,
    lastCompressTurn: state.currentTurn,
    updatedAt: Date.now(),
  };
}

export function getDurableStateSnapshot(
  sessionId: string,
): DurableSessionState {
  return durableFromSessionState(sessionId, getState(sessionId));
}

export function makeDcpStateEntryPayload(
  sessionId: string,
  reason: DcpStateEntryPayload["reason"],
): DcpStateEntryPayload {
  return {
    version: 1,
    reason,
    snapshot: getDurableStateSnapshot(sessionId),
    createdAt: Date.now(),
  };
}

export function restoreDcpStateSnapshot(
  sessionId: string,
  snapshot: DurableSessionState,
): void {
  const normalized: DurableSessionState = {
    ...snapshot,
    sessionId,
    sessionKey: getSessionKey(sessionId),
  };
  sessions.set(sessionId, sessionStateFromDurable(normalized));
  saveDurableSessionState(normalized);
}

export function restoreDcpStateFromSessionEntries(
  sessionId: string,
  entries: readonly unknown[],
): boolean {
  let latest: { timestamp: number; snapshot: DurableSessionState } | undefined;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const details =
      obj.details && typeof obj.details === "object"
        ? (obj.details as Record<string, unknown>)
        : undefined;
    const dcpDetails =
      details?.dcp && typeof details.dcp === "object"
        ? (details.dcp as Record<string, unknown>)
        : undefined;
    const data =
      obj.data && typeof obj.data === "object"
        ? (obj.data as Record<string, unknown>)
        : undefined;
    const payload = obj.customType === DCP_STATE_ENTRY_TYPE ? data : undefined;
    const snapshot = (payload?.snapshot ?? dcpDetails?.snapshot) as
      | DurableSessionState
      | undefined;
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.blocks))
      continue;
    const timestamp = typeof obj.timestamp === "number" ? obj.timestamp : 0;
    if (!latest || timestamp >= latest.timestamp)
      latest = { timestamp, snapshot };
  }
  if (!latest) return false;
  restoreDcpStateSnapshot(sessionId, latest.snapshot);
  return true;
}

function persistState(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  saveDurableSessionState(durableFromSessionState(sessionId, state));
}

function parseMetadataArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

function parseMetadataString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Clean up session state on shutdown */
export function cleanupSession(sessionId: string): void {
  sessions.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Block operations
// ---------------------------------------------------------------------------

export function addBlock(
  sessionId: string,
  topic: string,
  summary: string,
  startLabel: string,
  endLabel: string,
  metadata?: Record<string, unknown>,
): CompressionBlock {
  const state = getState(sessionId);
  const block: CompressionBlock = {
    blockId: state.nextBlockId++,
    topic,
    summary,
    startLabel,
    endLabel,
    summaryTokens: Math.ceil(summary.length / 4),
    createdAt: Date.now(),
    metadata,
  };
  state.blocks.push(block);
  persistState(sessionId);
  return block;
}

export function getBlocks(sessionId: string): readonly CompressionBlock[] {
  return getState(sessionId).blocks;
}

export function getStats(sessionId: string) {
  const s = getState(sessionId);
  return {
    blockCount: s.blocks.length,
    totalStrippedTokens: s.totalStrippedTokens,
    totalPrunedCount: s.totalPrunedCount,
    summaryTokens: s.blocks.reduce((sum, b) => sum + b.summaryTokens, 0),
    qualityMetrics: s.qualityMetrics,
  };
}

// ---------------------------------------------------------------------------
// P0: Persistent summary merging (anchored iterative summarization)
// ---------------------------------------------------------------------------

/**
 * Parse comma-separated string into trimmed, non-empty array.
 */
function parseCSV(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Merge structured fields into the persistent session summary.
 * Factory pattern: anchored iterative summarization.
 */
export function mergeIntoPersistentSummary(
  sessionId: string,
  fields: StructuredSummaryFields,
  topic: string,
  blockId: number,
): PersistentSessionSummary {
  const ps = getState(sessionId).persistentSummary;

  // Merge files (deduplicated, newest-first ordering)
  const newReads = fields.files_read.filter((f) => !ps.files_read.includes(f));
  const newModifies = fields.files_modified.filter(
    (f) => !ps.files_modified.includes(f),
  );
  if (newReads.length > 0) ps.files_read = [...newReads, ...ps.files_read];
  if (newModifies.length > 0)
    ps.files_modified = [...newModifies, ...ps.files_modified];

  // Merge decisions (dedup by exact text match)
  const existingDecisionTexts = new Set(ps.decisions.map((d) => d.text));
  for (const d of fields.decisions) {
    if (!existingDecisionTexts.has(d)) {
      ps.decisions.push({ text: d, block_id: blockId, timestamp: Date.now() });
      existingDecisionTexts.add(d);
    }
  }

  // Append next steps (newest tells current direction), keep last 20
  for (const ns of fields.next_steps) {
    ps.next_steps.push({ text: ns, block_id: blockId, timestamp: Date.now() });
  }
  if (ps.next_steps.length > 20) {
    ps.next_steps = ps.next_steps.slice(-20);
  }

  // Update topic to most recent
  ps.topic = topic;
  ps.merged_block_ids.push(blockId);
  ps.last_updated = Date.now();
  persistState(sessionId);

  return ps;
}

// ---------------------------------------------------------------------------
// P1: Probe-based compression quality evaluation
// ---------------------------------------------------------------------------

/**
 * Run quality probes on a compression event.
 * Returns per-probe scores and overall quality assessment.
 */
export function evaluateCompressionProbes(
  fields: StructuredSummaryFields,
  narrative: string,
  summaryTokens: number,
  config: ProbeConfig,
): ProbeEvaluationResult {
  const probes: ProbeResult[] = [];

  // 1. File coverage probe: are files_read and files_modified populated?
  const hasReads = fields.files_read.length > 0;
  const hasModifies = fields.files_modified.length > 0;
  let fileCoverageScore: number;
  if (hasReads && hasModifies) {
    fileCoverageScore = 100;
  } else if (hasReads || hasModifies) {
    fileCoverageScore = 50;
  } else {
    fileCoverageScore = 0;
  }
  probes.push({
    name: "file-coverage",
    pass: fileCoverageScore >= config.minFileCoverage,
    score: fileCoverageScore,
    detail:
      hasReads && hasModifies
        ? `${fields.files_read.length} read, ${fields.files_modified.length} modified`
        : hasReads
          ? `${fields.files_read.length} read, no modified files`
          : hasModifies
            ? `no read files, ${fields.files_modified.length} modified`
            : "no file paths provided",
  });

  // 2. Decision coverage probe: how many decisions captured?
  const decisionCount = fields.decisions.length;
  let decisionScore: number;
  if (decisionCount >= 3) {
    decisionScore = 100;
  } else if (decisionCount >= 1) {
    decisionScore = 50;
  } else {
    decisionScore = 0;
  }
  probes.push({
    name: "decision-coverage",
    pass: decisionScore >= config.minDecisionCoverage,
    score: decisionScore,
    detail:
      decisionCount >= 1
        ? `${decisionCount} decision${decisionCount !== 1 ? "s" : ""} captured`
        : "no decisions recorded",
  });

  // 3. Narrative depth probe: is the summary substantive?
  const narrativeLen = narrative.length;
  let narrativeScore: number;
  if (narrativeLen > 500) {
    narrativeScore = 100;
  } else if (narrativeLen > 200) {
    narrativeScore = 60;
  } else if (narrativeLen > 50) {
    narrativeScore = 30;
  } else {
    narrativeScore = 0;
  }
  probes.push({
    name: "narrative-depth",
    pass: narrativeScore >= config.minNarrativeDepth,
    score: narrativeScore,
    detail: narrativeLen > 0 ? `${narrativeLen} characters` : "empty narrative",
  });

  // 4. Structure completeness probe: % of 4 structured fields filled
  const filledFields = [
    fields.files_read.length > 0,
    fields.files_modified.length > 0,
    fields.decisions.length > 0,
    fields.next_steps.length > 0,
  ];
  const filledCount = filledFields.filter(Boolean).length;
  const structScore = Math.round((filledCount / 4) * 100);
  probes.push({
    name: "structure-completeness",
    pass: structScore >= config.minStructureCompleteness,
    score: structScore,
    detail: `${filledCount}/4 structured fields populated`,
  });

  const overallScore = Math.round(
    probes.reduce((sum, p) => sum + p.score, 0) / probes.length,
  );
  const allPassed = probes.every((p) => p.pass);

  return {
    probes,
    overallScore,
    allPassed,
    summaryTokens,
    fieldsCount: filledCount,
  };
}

/**
 * Store probe evaluation results in session quality metrics.
 */
export function recordProbeResults(
  sessionId: string,
  result: ProbeEvaluationResult,
): void {
  const state = getState(sessionId);
  state.qualityMetrics.lastProbeResults = result;
  if (!result.allPassed) {
    state.qualityMetrics.failedProbes++;
  }
  // Running average
  const n = state.qualityMetrics.totalCompressions;
  if (n > 0) {
    const prevAvg = state.qualityMetrics.avgProbeScore;
    state.qualityMetrics.avgProbeScore =
      (prevAvg * (n - 1) + result.overallScore) / n;
  } else {
    state.qualityMetrics.avgProbeScore = result.overallScore;
  }
  persistState(sessionId);
}

/**
 * Build a structured context message from the persistent summary.
 * This is what gets injected into the LLM context after compression.
 */
export function buildCompressedSummaryMessage(
  summary: PersistentSessionSummary,
): string {
  const parts: string[] = [];

  // Header
  const mergedLabel =
    summary.merged_block_ids.length === 1
      ? `b${summary.merged_block_ids[0]}`
      : `b${summary.merged_block_ids[0]}–b${summary.merged_block_ids[summary.merged_block_ids.length - 1]}`;
  parts.push(`\uF07C Session Context (${mergedLabel})`);

  // Topic
  if (summary.topic && summary.topic !== "session") {
    parts.push(`  Topic: ${summary.topic}`);
  }

  // Files read
  if (summary.files_read.length > 0) {
    parts.push("", "\uF15B Files Read:");
    for (const f of summary.files_read) {
      parts.push(`  \u2022 ${f}`);
    }
  }

  // Files modified
  if (summary.files_modified.length > 0) {
    parts.push("", "\uF15C Files Modified:");
    for (const f of summary.files_modified) {
      parts.push(`  \u2022 ${f}`);
    }
  }

  // Decisions
  if (summary.decisions.length > 0) {
    parts.push("", "\uF0E7 Decisions Made:");
    for (const d of summary.decisions) {
      parts.push(`  \u2022 ${d.text}`);
    }
  }

  // Next steps
  if (summary.next_steps.length > 0) {
    const latest = summary.next_steps[summary.next_steps.length - 1];
    parts.push("", "\uF140 Next Steps:");
    parts.push(`  \u2022 ${latest.text}`);
    if (summary.next_steps.length > 1) {
      parts.push(
        `  (${summary.next_steps.length - 1} prior step groups archived)`,
      );
    }
  }

  // Narrative segments
  if (summary.narrative_parts.length > 0) {
    parts.push("", "\uF0EA Summary:");
    for (const np of summary.narrative_parts) {
      parts.push("");
      parts.push(`From b${np.block_id}:`);
      parts.push(np.text);
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// P0/P1: Extract structured fields from compress tool call arguments
// ---------------------------------------------------------------------------

/**
 * Extract structured fields from compress tool params.
 * Handles both the new structured fields and the old freeform summary fallback.
 */
function extractStructuredFields(
  params: Record<string, unknown>,
  config: DCPConfig,
): { fields: StructuredSummaryFields; narrative: string } {
  const fields: StructuredSummaryFields = {
    files_read: parseCSV(params.files_read as string | undefined),
    files_modified: parseCSV(params.files_modified as string | undefined),
    decisions: parseCSV(params.decisions as string | undefined),
    next_steps: parseCSV(params.next_steps as string | undefined),
  };

  const narrative = (params.summary as string) ?? "";

  // Auto-extract file paths from summary text when structured fields are empty
  if (config.structuredSummary.autoExtractPaths) {
    if (fields.files_read.length === 0 && fields.files_modified.length === 0) {
      const filePattern =
        /(?:\b(?:src|lib|app|test|config|public)\/[^\s,)]+(?:\.[a-z]+)?\b)|(?:\b[a-zA-Z0-9_-]+\/[a-zA-Z0-9._\/-]+\.[a-z]+\b)/g;
      const matches = narrative.match(filePattern);
      if (matches) {
        const readContext = /read|open|look|check|examine|review/i;
        const modContext =
          /modify|edit|write|change|update|fix|add|create|delete|refactor/i;
        for (const m of [...new Set(matches)]) {
          const idx = narrative.indexOf(m);
          const start = Math.max(0, idx - 60);
          const lineContext = narrative.substring(start, idx + m.length + 60);
          if (modContext.test(lineContext)) {
            if (!fields.files_modified.includes(m))
              fields.files_modified.push(m);
          } else if (readContext.test(lineContext)) {
            if (!fields.files_read.includes(m)) fields.files_read.push(m);
          } else {
            if (!fields.files_read.includes(m)) fields.files_read.push(m);
          }
        }
      }
    }
  }

  return { fields, narrative };
}

// ---------------------------------------------------------------------------
// P1: Artifact tracking
// ---------------------------------------------------------------------------

/**
 * Extract file path(s) from tool call arguments.
 */
function extractPathFromArgs(
  toolName: string,
  args: Record<string, unknown>,
): string[] {
  const paths: string[] = [];

  if (typeof args.path === "string" && args.path.trim()) {
    paths.push(args.path.trim());
  }
  if (typeof args.scope === "string" && args.scope.trim()) {
    paths.push(args.scope.trim());
  }
  // grep/find pattern is NOT a file path
  if (Array.isArray(args.paths)) {
    for (const p of args.paths) {
      if (typeof p === "string" && p.trim()) paths.push(p.trim());
    }
  }

  return paths.map((p) => p.replace(/^\.\//, "").replace(/\/+$/, ""));
}

/**
 * Track a tool call for artifact tracking.
 * Called from index.ts on `tool_result` events.
 */
export function trackToolCall(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  maxFiles?: number,
): void {
  if (!READ_TOOLS.has(toolName) && !MODIFY_TOOLS.has(toolName)) return;

  const state = getState(sessionId);
  const paths = extractPathFromArgs(toolName, args);
  const category = MODIFY_TOOLS.has(toolName) ? "modified" : "read";
  const limit = maxFiles ?? 200;

  for (const rawPath of paths) {
    const path = rawPath.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!path || path === "." || path === "..") continue;

    const existing = state.artifactTracker.get(path);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.accessCount++;
    } else if (state.artifactTracker.size < limit) {
      state.artifactTracker.set(path, {
        lastSeen: Date.now(),
        accessCount: 1,
        toolName,
        wasCompressed: false,
      });
    }

    // Also merge into persistent summary
    const ps = state.persistentSummary;
    if (category === "read") {
      if (!ps.files_read.includes(path)) ps.files_read.push(path);
    } else {
      if (!ps.files_modified.includes(path)) ps.files_modified.push(path);
    }
  }
}

/**
 * Get current artifact tracker state.
 */
export function getArtifactTracker(sessionId: string): {
  files_read: string[];
  files_modified: string[];
} {
  const ps = getState(sessionId).persistentSummary;
  return {
    files_read: [...ps.files_read],
    files_modified: [...ps.files_modified],
  };
}

// ---------------------------------------------------------------------------
// P1: Quality metrics / regression detection
// ---------------------------------------------------------------------------

/**
 * Record a compress event for quality tracking.
 */
export function recordCompressEvent(
  sessionId: string,
  blockId: number,
  fields: StructuredSummaryFields,
): void {
  const state = getState(sessionId);
  state.qualityMetrics.totalCompressions++;
  state.qualityMetrics.cleanCompressions++;
  state.recentCompressFiles = {
    files: [...new Set([...fields.files_read, ...fields.files_modified])],
    turn: state.currentTurn,
  };

  for (const f of [...fields.files_read, ...fields.files_modified]) {
    const entry = state.artifactTracker.get(f);
    if (entry) entry.wasCompressed = true;
  }
  persistState(sessionId);
}

/**
 * Check for compression regression: agent re-reading files that were
 * in a compressed block within the regression window.
 */
export function checkCompressionRegression(
  messages: Message[],
  sessionId: string,
  config?: DCPConfig,
): void {
  const state = getState(sessionId);
  if (!state.recentCompressFiles) return;

  const regressionWindow = config?.qualityMetrics?.regressionWindow ?? 5;
  const turnGap = state.currentTurn - state.recentCompressFiles.turn;
  if (turnGap > regressionWindow) {
    state.recentCompressFiles = null;
    persistState(sessionId);
    return;
  }

  const compressedFiles = new Set(state.recentCompressFiles.files);

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const asst = msg as AssistantMessage;
    if (!Array.isArray(asst.content)) continue;
    for (const part of asst.content) {
      if (part.type !== "toolCall") continue;
      const tc = part as ToolCall;
      if (!READ_TOOLS.has(tc.name)) continue;

      const paths = extractPathFromArgs(
        tc.name,
        tc.arguments as Record<string, unknown>,
      );
      for (const p of paths) {
        if (compressedFiles.has(p)) {
          state.qualityMetrics.reReadsAfterCompress++;
          state.qualityMetrics.cleanCompressions = 0;
          state.qualityMetrics.regressionLog.push({
            blockId: state.blocks.length,
            file: p,
            turnGap,
            timestamp: Date.now(),
          });
        }
      }
    }
  }
  persistState(sessionId);
}

/**
 * Get quality metrics.
 */
export function getQualityMetrics(sessionId: string): QualityMetricsData {
  return { ...getState(sessionId).qualityMetrics };
}

/**
 * Increment turn counter.
 */
export function incrementTurn(sessionId: string): void {
  getState(sessionId).currentTurn++;
  persistState(sessionId);
}

/**
 * Get persistent summary (for /dcp command).
 */
export function getPersistentSummary(
  sessionId: string,
): PersistentSessionSummary {
  return { ...getState(sessionId).persistentSummary };
}

/**
 * Get quality status line with probe info.
 */
export function getQualityStatus(sessionId: string): string {
  const qm = getState(sessionId).qualityMetrics;
  if (qm.totalCompressions === 0) return "";
  const reReadPct =
    qm.totalCompressions > 0
      ? Math.round((qm.reReadsAfterCompress / qm.totalCompressions) * 100)
      : 0;
  const streak =
    qm.cleanCompressions > 0 ? ` (${qm.cleanCompressions}\uF00C streak)` : "";
  let status = `Regression: ${qm.reReadsAfterCompress}/${qm.totalCompressions} (${reReadPct}%)${streak}`;

  // Add probe score if available
  if (qm.lastProbeResults) {
    const pct = qm.lastProbeResults.overallScore;
    const icon = qm.lastProbeResults.allPassed ? "\uF00C" : "\uF071";
    status += ` | Probe: ${pct}% ${icon}`;
  } else if (qm.avgProbeScore > 0) {
    status += ` | Avg probe: ${Math.round(qm.avgProbeScore)}%`;
  }

  // Failed probes count
  if (qm.failedProbes > 0) {
    status += ` | Failed: ${qm.failedProbes}`;
  }

  return status;
}

// ---------------------------------------------------------------------------
// Context message stripping
//
// Invoked on every `context` event (before every LLM request).
// Three strategies applied in order:
//   1. compress-strip — replace ranges covered by compress blocks with summaries
//   2. dedup — strip duplicate tool call arguments, keep latest result
//   3. purge-errors — strip large inputs from old errored tool calls
// ---------------------------------------------------------------------------

/**
 * Estimate token count for a message using chars/4 heuristic.
 */
export function estimateTokens(msg: Message): number {
  let chars = 0;
  if (msg.role === "assistant") {
    const asst = msg as AssistantMessage;
    for (const part of asst.content) {
      if (part.type === "text")
        chars += (part as TextContent).text?.length ?? 0;
      else if (part.type === "thinking")
        chars += (part as ThinkingContent).thinking?.length ?? 0;
      else if (part.type === "toolCall") {
        const tc = part as ToolCall;
        chars += tc.name.length + JSON.stringify(tc.arguments).length;
      }
    }
  } else if (msg.role === "user") {
    const um = msg as UserMessage;
    if (typeof um.content === "string") chars = um.content.length;
    else if (Array.isArray(um.content))
      chars = um.content.reduce(
        (s: number, c: TextContent | ImageContent) =>
          s + (c.type === "text" ? c.text.length : 0),
        0,
      );
  } else if (msg.role === "toolResult") {
    const tr = msg as ToolResultMessage;
    chars = tr.content.reduce(
      (s: number, c: TextContent | ImageContent) =>
        s + (c.type === "text" ? c.text.length : 0),
      0,
    );
  } else if ((msg as BashExecutionMessage).role === "bashExecution") {
    const b = msg as BashExecutionMessage;
    chars = (b.command?.length ?? 0) + (b.output?.length ?? 0);
  } else if (
    (msg as CompactionSummaryMessage).role === "compactionSummary" ||
    (msg as BranchSummaryMessage).role === "branchSummary"
  ) {
    chars =
      (msg as CompactionSummaryMessage | BranchSummaryMessage).summary
        ?.length ?? 0;
  }
  return Math.ceil(chars / 4);
}

function estimateToolArgsTokens(args: unknown): number {
  return Math.ceil(JSON.stringify(args).length / 4);
}

/** Strip tool arguments from a tool call content block, replace with a marker */
export function stripToolArgs(tc: ToolCall, marker: string): number {
  const before = estimateToolArgsTokens(tc.arguments);
  tc.arguments = { __dcp: marker };
  return before;
}

// ── Step 1: Compress-strip ──────────────────────────────────────────────
// Moved to ./compress-strip.ts. applyCompressStrip is imported at the top.

interface ToolOp {
  messageIndex: number;
  contentIndex: number;
  type: "call" | "result";
  toolName: string;
  toolCallId: string;
  isError: boolean;
}

export function extractToolOps(messages: Message[]): ToolOp[] {
  const ops: ToolOp[] = [];
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg.role === "assistant") {
      const asst = msg as AssistantMessage;
      if (!Array.isArray(asst.content)) continue;
      for (let ci = 0; ci < asst.content.length; ci++) {
        const part = asst.content[ci];
        if (part.type === "toolCall") {
          const tc = part as ToolCall;
          ops.push({
            messageIndex: mi,
            contentIndex: ci,
            type: "call",
            toolName: tc.name,
            toolCallId: tc.id,
            isError: false,
          });
        }
      }
    } else if (msg.role === "toolResult") {
      const tr = msg as ToolResultMessage;
      ops.push({
        messageIndex: mi,
        contentIndex: -1,
        type: "result",
        toolName: tr.toolName,
        toolCallId: tr.toolCallId,
        isError: tr.isError ?? false,
      });
    }
  }
  return ops;
}

// ── Step 2: Deduplication ───────────────────────────────────────────────
// Moved to ./compress-dedup.ts.

// ── Step 3: Purge errors ────────────────────────────────────────────────
// Moved to ./compress-dedup.ts.

// ── Combined context processing ─────────────────────────────────────────

/**
 * Apply all DCP strategies to the messages array.
 * Called from the `context` event handler before every LLM request.
 *
 * Order matters: compress-strip first (changes array indices),
 * then dedup and purge-errors operate on the remaining messages.
 */
export function processContextMessages(
  messages: Message[],
  sessionId: string,
  config: DCPConfig,
): Message[] {
  const state = getState(sessionId);

  // P2: Check for regression (re-reads of recently compressed files)
  if (config.qualityMetrics.enabled && config.qualityMetrics.trackReReads) {
    checkCompressionRegression(messages, sessionId, config);
  }

  // 1. Compress-strip — now receives sessionId for persistent summary injection
  const {
    messages: afterStrip,
    prunedTokens: stripTokens,
    prunedCount: stripCount,
  } = applyCompressStrip(messages, sessionId, config);

  // 2. Dedup
  const { prunedTokens: dedupTokens, prunedCount: dedupCount } = applyDedup(
    afterStrip,
    config,
  );

  // 3. Purge errors
  const { prunedTokens: purgeTokens, prunedCount: purgeCount } =
    applyPurgeErrors(afterStrip, config);

  // 4. Tool-result pruning — selectively compact regeneratable tool outputs
  const { prunedTokens: pruneTokens, prunedCount: pruneCount } =
    pruneToolResults(afterStrip, config);

  state.totalStrippedTokens +=
    stripTokens + dedupTokens + purgeTokens + pruneTokens;
  state.totalPrunedCount += stripCount + dedupCount + purgeCount + pruneCount;

  return afterStrip;
}

// ── Step 4: Tool-Result Pruning ────────────────────────────────────────
// Moved to ./compress-prune.ts.

// ---------------------------------------------------------------------------
// Post-compaction token estimate (Pi 0.79.8 RPC parity)
// ---------------------------------------------------------------------------

/** Heuristic post-compact context size (Pi 0.79.8 `estimatedTokensAfter` parity). */
export function estimateTokensAfterCompress(
  contextTokensBefore: number | null | undefined,
  removedEstimate: number,
  summaryTokens: number,
): number | undefined {
  if (contextTokensBefore == null || contextTokensBefore <= 0) return undefined;
  return Math.max(
    0,
    Math.round(contextTokensBefore - removedEstimate + summaryTokens),
  );
}

/** Recompute `estimatedTokensAfter` after DCP enrichment extends the compaction summary. */
export function enrichCompactionResult<
  T extends {
    summary: string;
    tokensBefore: number;
    estimatedTokensAfter?: number;
  },
>(
  result: T,
  preparation: {
    tokensBefore: number;
    messagesToSummarize: readonly Message[];
  },
): T {
  const removedEstimate = preparation.messagesToSummarize.reduce(
    (sum, m) => sum + estimateTokens(m),
    0,
  );
  const summaryTokens = Math.ceil(result.summary.length / 4);
  const estimated = estimateTokensAfterCompress(
    preparation.tokensBefore,
    removedEstimate,
    summaryTokens,
  );
  if (estimated != null) {
    result.estimatedTokensAfter = estimated;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Compress tool registration
// ---------------------------------------------------------------------------

const COMPRESS_TOOL_DESCRIPTION = [
  "Collapse a range in the conversation into a detailed summary with structured fields.",
  "",
  "COMPRESSION MODES",
  '- "range" (default): Select a conversation range by start/end boundaries → replace with summary.',
  '- "message" (experimental): Use when sessions are dense with no clear phase boundaries.',
  "",
  "STRUCTURED FIELDS (PREFERRED)",
  "Provide these comma-separated fields to ensure critical context survives compression:",
  "- files_read: files you examined during this phase",
  "- files_modified: files you changed (write/edit)",
  "- decisions: key decisions made with rationale (e.g. 'Used X instead of Y because Z')",
  "- next_steps: what remains to be done after this phase",
  "",
  "These structured fields are merged into a persistent session summary that grows",
  "across compressions — you don't need to repeat prior context.",
  "",
  "THE SUMMARY",
  "The `summary` field is your prose narrative. It must be EXHAUSTIVE: capture file paths,",
  "function signatures, decisions made, constraints discovered, key findings — EVERYTHING",
  "that maintains context integrity. This is not a brief note — it is an authoritative record",
  "so faithful that the original conversation adds no value.",
  "",
  "Yet be LEAN. Strip away failed attempts, verbose tool outputs, back-and-forth exploration.",
  "What remains should be pure signal.",
  "",
  "WHEN TO USE",
  "- Research concluded and findings are clear",
  "- Implementation finished and verified",
  "- Exploration exhausted and patterns understood",
  "- A closed portion unlikely to be referenced immediately",
  "",
  "WHEN NOT TO USE",
  "- You may need exact code, error messages, or file contents in the immediate next steps",
  "- Work in that area is still active or likely to resume immediately",
].join("\n");

export function registerCompressTool(
  pi: ExtensionAPI,
  config: DCPConfig,
): void {
  if (config.compress.permission === "deny") return;

  pi.registerTool({
    name: "compress",
    label: "Compress Context",
    description: COMPRESS_TOOL_DESCRIPTION,
    promptSnippet:
      "Collapse a conversation range into a dense, exhaustive summary with structured fields.",
    promptGuidelines: [
      "Compress completed research or implementation phases to free context space.",
      "Before compressing, verify the range is truly closed — never compress work you may need exact details from.",
      "Use the structured fields (files_read, files_modified, decisions, next_steps) whenever possible.",
      "Write exhaustive summaries that capture file paths, function signatures, decisions, and constraints.",
    ],
    parameters: Type.Object({
      topic: Type.String({
        description:
          "Short label (3-5 words) — e.g., 'Auth System Exploration'",
      }),
      summary: Type.String({
        description:
          "Complete technical prose summary of the compressed range. Must be exhaustive.",
      }),
      // P0: Structured fields for Factory-style anchored summarization
      files_read: Type.Optional(
        Type.String({
          description: "Comma-separated files read during this phase",
        }),
      ),
      files_modified: Type.Optional(
        Type.String({
          description: "Comma-separated files modified during this phase",
        }),
      ),
      decisions: Type.Optional(
        Type.String({
          description:
            "Comma-separated key decisions made (e.g. 'Used X instead of Y because Z')",
        }),
      ),
      next_steps: Type.Optional(
        Type.String({ description: "Comma-separated next steps / task state" }),
      ),
      startId: Type.Optional(
        Type.String({
          description: "Start boundary description. Omit in batch mode.",
        }),
      ),
      endId: Type.Optional(
        Type.String({
          description: "End boundary description. Omit in batch mode.",
        }),
      ),
      mode: Type.Optional(
        Type.Union(
          [
            Type.Literal("range"),
            Type.Literal("message"),
            Type.Literal("batch"),
          ],
          {
            description:
              'Compression mode: "range" (default), "message" (experimental), or "batch" (auto-detect range).',
          },
        ),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        topic: string;
        summary: string;
        files_read?: string;
        files_modified?: string;
        decisions?: string;
        next_steps?: string;
        startId?: string;
        endId?: string;
        mode?: string;
      },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      if (!params.topic?.trim()) throw new Error("topic is required");
      if (!params.summary?.trim()) throw new Error("summary is required");

      const mode = params.mode ?? config.compress.mode;
      const sessionId = getDcpSessionId(ctx);

      // P0: Extract structured fields and narrative
      const { fields, narrative } = extractStructuredFields(
        params as Record<string, unknown>,
        config,
      );

      // Resolve start/end labels
      const startLabel =
        params.startId?.trim() ??
        (() => {
          const blocks = getBlocks(sessionId);
          const last = blocks[blocks.length - 1];
          return last
            ? `after "${last.topic}" (b${last.blockId})`
            : "beginning of session";
        })();
      const endLabel = params.endId?.trim() ?? "current state";

      // Store the compression block
      const block = addBlock(
        sessionId,
        params.topic.trim(),
        params.summary.trim(),
        startLabel,
        endLabel,
        {
          files_read: fields.files_read,
          files_modified: fields.files_modified,
          decisions: fields.decisions,
          next_steps: fields.next_steps,
          source: "compress_tool",
        },
      );

      // P0: Merge into persistent summary (anchored iterative summarization)
      mergeIntoPersistentSummary(sessionId, fields, block.topic, block.blockId);

      // Also append narrative to persistent summary
      const ps = getState(sessionId).persistentSummary;
      ps.narrative_parts.push({ text: narrative, block_id: block.blockId });

      // P1: Record compress event for quality tracking
      recordCompressEvent(sessionId, block.blockId, fields);
      pi.appendEntry(
        DCP_STATE_ENTRY_TYPE,
        makeDcpStateEntryPayload(sessionId, "compress_tool"),
      );

      // P1: Run probe-based evaluation
      if (config.probeEvaluation?.enabled) {
        const probeResult = evaluateCompressionProbes(
          fields,
          narrative,
          block.summaryTokens,
          config.probeEvaluation,
        );
        recordProbeResults(sessionId, probeResult);
      }

      // Build response with persistent summary preview
      const allBlocks = getBlocks(sessionId);
      const stats = getStats(sessionId);
      const contextUsage =
        typeof ctx.getContextUsage === "function"
          ? ctx.getContextUsage()
          : undefined;
      const contextTokensBefore = contextUsage?.tokens ?? undefined;

      const lines: string[] = [
        `[Compressed conversation section b${block.blockId}]`,
        `Topic: ${block.topic}`,
        `Mode: ${mode}`,
        `Range: ${startLabel} → ${endLabel}`,
        `Summary tokens: ~${block.summaryTokens}`,
        `Active compressions: ${allBlocks.length}`,
        `Total summary buffer: ~${stats.summaryTokens} tokens`,
        `Merged blocks: ${ps.merged_block_ids.join(", ")}`,
        "",
        "The following is the authoritative summary of the compressed range:",
        "",
        narrative,
      ];

      // Show any structured fields that were provided
      const structuredParts: string[] = [];
      if (fields.files_read.length > 0) {
        structuredParts.push(`Files read: ${fields.files_read.join(", ")}`);
      }
      if (fields.files_modified.length > 0) {
        structuredParts.push(
          `Files modified: ${fields.files_modified.join(", ")}`,
        );
      }
      if (fields.decisions.length > 0) {
        structuredParts.push(`Decisions: ${fields.decisions.join("; ")}`);
      }
      if (fields.next_steps.length > 0) {
        structuredParts.push(`Next steps: ${fields.next_steps.join("; ")}`);
      }
      if (structuredParts.length > 0) {
        lines.push("", "--- Structured fields ---");
        lines.push(...structuredParts);
      }

      // Show quality metrics if available
      const qualityStatus = getQualityStatus(sessionId);
      if (qualityStatus) {
        lines.push("", `Quality: ${qualityStatus}`);
      }

      // P1: Add probe results to response if configured
      if (
        config.probeEvaluation?.enabled &&
        config.probeEvaluation.showInResponse
      ) {
        const qm = getQualityMetrics(sessionId);
        if (qm.lastProbeResults) {
          const probeLines: string[] = [
            "",
            "--- Compression quality probes ---",
          ];
          for (const p of qm.lastProbeResults.probes) {
            const icon = p.pass ? "\uF00C" : "\uF071";
            probeLines.push(
              `  ${icon} ${p.name}: ${p.score}/100 — ${p.detail}`,
            );
          }
          const overallIcon = qm.lastProbeResults.allPassed
            ? "\uF00C"
            : "\uF071";
          probeLines.push(
            `  ${overallIcon} Overall: ${qm.lastProbeResults.overallScore}/100`,
          );
          lines.push(...probeLines);
        }
      }

      if (contextTokensBefore != null) {
        lines.push(
          "",
          `Context window usage before this compress: ~${contextTokensBefore} tokens`,
        );
        lines.push(
          "(Message-range stripping applies on the next LLM request; native `estimatedTokensAfter` is set when Pi runs session compaction.)",
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          blockId: block.blockId,
          topic: block.topic,
          mode,
          summaryTokens: block.summaryTokens,
          summaryBufferTokens: stats.summaryTokens,
          ...(contextTokensBefore != null ? { contextTokensBefore } : {}),
          files: fields,
          quality: getQualityMetrics(sessionId),
        },
      };
    },
  });
}
