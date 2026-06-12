/**
 * Memory system types and configuration.
 * No external dependencies — this is the foundation for all memory modules.
 */

// ---------------------------------------------------------------------------
// Confidence & Observation Types
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "high" | "medium" | "low";

export type ObservationType =
  | "decision"
  | "bugfix"
  | "feature"
  | "pattern"
  | "discovery"
  | "learning"
  | "warning";

export type ObservationSource = "manual" | "curator" | "imported";

export type MaturityState =
  | "candidate"
  | "established"
  | "proven"
  | "deprecated";

export interface FeedbackEvent {
  type: "helpful" | "harmful";
  timestamp: number;
  reason?: string;
  session_id?: string;
}

// ---------------------------------------------------------------------------
// Row types (database)
// ---------------------------------------------------------------------------

export interface ObservationRow {
  id: number;
  type: ObservationType;
  title: string;
  subtitle: string | null;
  facts: string | null;
  narrative: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  confidence: ConfidenceLevel;
  bead_id: string | null;
  supersedes: number | null;
  superseded_by: number | null;
  valid_until: string | null;
  markdown_file: string | null;
  source: ObservationSource;
  maturity: MaturityState;
  helpful_count: number;
  harmful_count: number;
  feedback_events: string | null; // JSON array of FeedbackEvent
  effective_score: number;
  retrieval_count: number;
  last_retrieved: number | null;
  created_at: string;
  created_at_epoch: number;
  updated_at: string | null;
}

export interface ObservationInput {
  type: ObservationType;
  title: string;
  subtitle?: string;
  facts?: string[];
  narrative?: string;
  concepts?: string[];
  files_read?: string[];
  files_modified?: string[];
  confidence?: ConfidenceLevel;
  bead_id?: string;
  supersedes?: number;
  markdown_file?: string;
  source?: ObservationSource;
}

export interface SearchIndexResult {
  id: number;
  type: ObservationType;
  title: string;
  snippet: string;
  created_at: string;
  relevance_score: number;
}

export interface MemoryFileRow {
  id: number;
  file_path: string;
  content: string;
  mode: "replace" | "append";
  created_at: string;
  created_at_epoch: number;
  updated_at: string | null;
  updated_at_epoch: number | null;
}

export interface TemporalMessageRow {
  id: number;
  session_id: string;
  message_id: string;
  role: string;
  content: string;
  token_estimate: number;
  time_created: number;
  distillation_id: number | null;
  created_at: string;
  tool_name: string | null;
  tool_call_id: string | null;
  status: string | null;
  is_error: number;
  raw_json: string | null;
}

export interface TemporalMessageInput {
  session_id: string;
  message_id: string;
  role: string;
  content: string;
  token_estimate: number;
  time_created: number;
  tool_name?: string | null;
  tool_call_id?: string | null;
  status?: string | null;
  is_error?: boolean | number | null;
  raw_json?: string | null;
}

export interface DistillationRow {
  id: number;
  session_id: string;
  content: string;
  terms: string;
  message_count: number;
  compression_ratio: number;
  time_start: number;
  time_end: number;
  time_created: number;
  meta_distillation_id: number | null;
  created_at: string;
}

export interface DistillationInput {
  session_id: string;
  content: string;
  terms: string[];
  message_count: number;
  compression_ratio: number;
  time_start: number;
  time_end: number;
  meta_distillation_id?: number;
}

export interface DistillationSearchResult {
  id: number;
  session_id: string;
  snippet: string;
  message_count: number;
  created_at: string;
  relevance_score: number;
}

export interface MaintenanceStats {
  archived: number;
  vacuumed: boolean;
  checkpointed: boolean;
  prunedMarkdown: number;
  purgedMessages: number;
  freedBytes: number;
  dbSizeBefore: number;
  dbSizeAfter: number;
}

export interface ArchiveOptions {
  olderThanDays?: number;
  includeSuperseded?: boolean;
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const MEMORY_CONFIG = {
  capture: {
    enabled: true,
    maxContentLength: 4000,
    maxRawJsonLength: 8000,
    maxMessages: 1000,
    maxAgeDays: 180,
  },
  distillation: {
    enabled: true,
    minMessages: 10,
    maxMessages: 50,
    compressionTarget: 0.2,
    topTerms: 30,
  },
  dream: {
    enabled: true,
    auto: true,
    interval_days: 1,
    minMessagesPerSession: 5,
    maxMessages: 200,
    topTerms: 10,
    maxSessions: 5,
  },
  pipeline: {
    /** Run distillation every N conversation turns. 0 = every turn. */
    everyNConversations: 5,
    /** Trigger L1 after user has been idle for this many seconds. 0 = disabled. */
    l1IdleTimeoutSeconds: 600,
    /** Warm-up: triggers from turn 1, doubling each time up to everyNConversations. */
    enableWarmup: true,
    /** Min interval between pipeline passes within same session. */
    l1MinIntervalSeconds: 300,
  },
  curator: {
    enabled: true,
    minDistillations: 3,
    defaultConfidence: "medium" as ConfidenceLevel,
  },
  scene: {
    /** Enable L2 scene detection (clustering observations into work patterns) */
    enabled: true,
    /** Minimum Jaccard similarity to merge observations */
    minJaccard: 0.3,
    /** Max days between observations in the same scene */
    maxDaysBetween: 7,
    /** Minimum observations to form a scene */
    minClusterSize: 2,
    /** Max scenes to persist */
    maxScenes: 20,
  },
  injection: {
    enabled: true,
    tokenBudget: 2000,
    recencyDecay: 0.95,
    minScore: 0.1,
    topTerms: 30,
  },
  scoring: {
    /** Half-life in days for feedback decay */
    decayHalfLifeDays: 90,
    /** Harmful events are weighted this many times more than helpful */
    harmfulMultiplier: 4,
    /** Helpful events needed to promote candidate → established */
    establishedThreshold: 3,
    /** Helpful events needed to promote established → proven */
    provenThreshold: 8,
    /** Harmful ratio to auto-deprecate (with >= minEvents) */
    deprecateRatio: 0.3,
    /** Minimum feedback events before auto-deprecation */
    deprecateMinEvents: 3,
  },
  sanitization: {
    enabled: true,
  },
  maintenance: {
    minIntervalMs: 5 * 60 * 1000,
  },
  fts: {
    tokenizer: "porter unicode61",
  },
  embedding: {
    /** Embedding dimensions (all-MiniLM-L6-v2 = 384) */
    dimensions: 384,
    /** Model name for local embeddings */
    model: "Xenova/all-MiniLM-L6-v2",
    /** Max entries in embedding LRU cache */
    cacheSize: 1000,
    /** Enable/disable embedding generation */
    enabled: true,
    /** TurboQuant quantization (optional, replaces sqlite-vec) */
    quantization: {
      /** Enable TurboQuant compression for embedding storage */
      enabled: true,
      /** Bits per coordinate (2, 3, or 4). 4 = 8x compression */
      bitWidth: 4 as 2 | 3 | 4,
      /** Minimum vectors before TQ+ calibration is fitted */
      calibrationMinSamples: 1000,
    },
  },
  vector: {
    /** Weight for vector similarity in hybrid search (0.0-1.0) */
    weight: 0.4,
    /** Weight for FTS5 text search in hybrid search (0.0-1.0) */
    textWeight: 0.6,
  },
  telemetry: {
    /** Emit health telemetry every N maintenance cycles (0 = disabled) */
    everyNCycles: 10,
  },
} as const;
