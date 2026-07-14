import type { DurableSessionState } from "./storage.js";

export const DCP_STATE_ENTRY_TYPE = "dcp_state";

/**
 * Current version of the DCP state entry payload format.
 * Increment when the payload shape changes (migration handled in restore).
 */
export const DCP_STATE_CURRENT_VERSION = 3 as const;

/** V1: Original format (before branch-safe filtering). */
export interface DcpStateEntryPayloadV1 {
  version: 1;
  reason: string;
  snapshot: DurableSessionState;
  createdAt: number;
}

/**
 * V2: Added `sessionId` for active-branch-safe restoration.
 * Identifies which Pi session branch this state belongs to.
 */
export interface DcpStateEntryPayloadV2 {
  version: 2;
  sessionId: string;
  reason: string;
  snapshot: DurableSessionState;
  createdAt: number;
}

/**
 * V3 snapshots include provenance and quarantine data through DurableSessionState.
 */
export interface DcpStateEntryPayloadV3 {
  version: 3;
  sessionId: string;
  reason: string;
  snapshot: DurableSessionState;
  createdAt: number;
}

export type DcpStateEntryPayload =
  DcpStateEntryPayloadV1 | DcpStateEntryPayloadV2 | DcpStateEntryPayloadV3;

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

export const READ_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "multi_grep",
  "web_fetch",
  "context7",
]);

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
  /** V3: provenance metadata captured at block creation time */
  provenance?: DcpProvenanceV2;
  /** V3+: explicit user attestation for legacy blocks without provenance */
  attestation?: LegacyAttestationMetadata;
}

export interface ToolOp {
  messageIndex: number;
  contentIndex: number;
  type: "call" | "result";
  toolName: string;
  toolCallId: string;
  isError: boolean;
}

/**
 * Provenance counters for the shared protection policy.
 * Records why messages were retained during compression.
 */
export interface ProtectionProvenance {
  /** Messages protected because their tool name was in protectedTools  */
  protectedTools: number;
  /** Messages protected because a path-like argument matched protectedFilePatterns */
  protectedFiles: number;
  /** Messages protected because they fall within the recentTurns window */
  protectedRecentTurns: number;
  /** User messages protected because protectUserMessages is true */
  protectedUserMessages: number;
}

/**
 * Provenance metadata captured at DCP block creation time.
 * Enables cross-session validation and quarantine detection.
 */
export interface DcpProvenanceV2 {
  /** Format version for provenance (currently 2) */
  version: 2;
  /** Session ID at block creation time */
  sessionId: string;
  /** Leaf entry ID at block creation time (null if no entries) */
  leafId: string | null;
  /** Entry IDs covered by this block (from active branch ancestry at creation) */
  coveredEntryIds: string[];
  /** Block creation timestamp */
  createdAt: number;
  /** Protection provenance if available */
  protectionProvenance?: ProtectionProvenance;
  /** Description of the summary source */
  summarySource?: string;
}

/**
 * Metadata recorded when a user explicitly attests to a legacy block
 * that lacks provenance. The attestation binds to the current session
 * ancestry without claiming original creation coverage.
 */
export interface LegacyAttestationMetadata {
  readonly actor: "user-command";
  readonly confirmation: "interactive" | "explicit-yes";
  readonly attestedAt: number;
  /** Leaf entry ID at attestation time (null if session has no entries yet) */
  readonly attestationLeafId: string | null;
  /** SHA-256 hex digest of the block summary at attestation time */
  readonly summaryHash: string;
}

/**
 * A block that was quarantined due to provenance validation failure
 * or explicit user quarantine.
 * Kept for diagnostic display but excluded from context injection.
 */
export interface QuarantinedBlock {
  /** Original block ID */
  id: string;
  /** Original block summary */
  summary: string;
  /** Human-readable reason for quarantine */
  reason: string;
  /** When the block was quarantined */
  quarantinedAt: number;
  /** Original block creation timestamp */
  createdAt: number;
  /** Actor who quarantined the block (user-command or system) */
  actor?: "user-command" | "system";
  /** Confirmation mode used for the quarantine action */
  confirmation?: "interactive" | "explicit-yes" | "auto";
  /** SHA-256 hex digest of the block summary at quarantine time */
  summaryHash?: string;
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
  /** V3: Quarantined blocks that failed provenance validation */
  quarantinedBlocks: QuarantinedBlock[];
}
