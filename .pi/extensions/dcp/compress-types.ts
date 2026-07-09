import type { DurableSessionState } from "./storage.js";

export const DCP_STATE_ENTRY_TYPE = "dcp_state";

export interface DcpStateEntryPayload {
  version: 1;
  reason: string;
  snapshot: DurableSessionState;
  createdAt: number;
}

export interface DCPCompressedSummaryMessage {
  role: "custom";
  customType: "dcp-compressed-summary";
  content: string;
  display: boolean;
  timestamp: number;
}

export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
}

export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
}

export interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
}

export interface StructuredSummaryFields {
  files_read: string[];
  files_modified: string[];
  decisions: string[];
  next_steps: string[];
}

export interface PersistentSessionSummary {
  files_read: string[];
  files_modified: string[];
  decisions: Array<{ text: string; block_id: number; timestamp: number }>;
  narrative_parts: Array<{ text: string; block_id: number }>;
  next_steps: Array<{ text: string; block_id: number; timestamp: number }>;
  last_updated: number;
  merged_block_ids: number[];
  topic: string;
}

export interface ArtifactTrackerEntry {
  lastSeen: number;
  accessCount: number;
  toolName: string;
  wasCompressed: boolean;
}

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
      "multi_grep",
]);

export function isCompactableTool(toolName: string): boolean {
  return COMPACTABLE_TOOLS.has(toolName);
}

export const READ_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
      "multi_grep",
      "web_fetch",
      "context7",
    ]);

export const MODIFY_TOOLS = new Set(["write", "edit"]);

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

export interface CompressionBlock {
  blockId: number;
  topic: string;
  summary: string;
  startLabel: string;
  endLabel: string;
  summaryTokens: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ToolOp {
  messageIndex: number;
  contentIndex: number;
  type: "call" | "result";
  toolName: string;
  toolCallId: string;
  isError: boolean;
}

export interface SessionState {
  blocks: CompressionBlock[];
  nextBlockId: number;
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
  reReadSeenKeys: Set<string>;
}
