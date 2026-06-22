/**
 * Memory extension configuration.
 *
 * After ADR-001 cleanup: dropped persona, scene, projectIndex, embedding,
 * vector, capture, distillation, dream, pipeline, curator, and featureFlags
 * sections. Scoring is now trivial (helpful_count - harmful_count) so it
 * needs no config. Pipeline, persona, scenes, and embedding subsystems were
 * deleted entirely; their config sections are removed.
 *
 * See: .pi/artifacts/DECISIONS.md#adr-001-memory-extension-cleanup
 */

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "low" | "medium" | "high";

export const VALID_OBSERVATION_TYPES = [
	"decision",
	"bugfix",
	"pattern",
	"feature",
	"discovery",
	"learning",
	"warning",
] as const;
export type ObservationType = (typeof VALID_OBSERVATION_TYPES)[number];

/** Row from the `observations` table. */
export interface ObservationRow {
	id: number;
	type: ObservationType;
	title: string;
	subtitle: string | null;
	facts: string | null;
	narrative: string;
	concepts: string;
	files_read: string;
	files_modified: string;
	confidence: ConfidenceLevel;
	bead_id: string | null;
	supersedes: number | null;
	superseded_by: number | null;
	valid_until: string | null;
	markdown_file: string | null;
	source: "manual" | "curator" | "imported";
	helpful_count: number;
	harmful_count: number;
	// Legacy columns (still present in DB for backward compat, no longer maintained)
	maturity?: string;
	feedback_events?: string | null;
	effective_score?: number;
	retrieval_count?: number;
	last_retrieved?: number;
	// Timestamps
	created_at: string;
	created_at_epoch: number;
	updated_at: string | null;
	updated_at_epoch: number | null;
}

/** Input shape for creating an observation. */
export interface ObservationInput {
	type: ObservationType;
	title: string;
	narrative: string;
	concepts?: string[];
	files_read?: string[];
	files_modified?: string[];
	subtitle?: string;
	facts?: string[];
	confidence?: ConfidenceLevel;
	bead_id?: string;
	supersedes?: number;
	valid_until?: string;
	source?: "manual" | "curator" | "imported";
}

/** Source of an observation. */
export type ObservationSource = "manual" | "curator" | "imported";

/** Result row from FTS5 search. */
export interface SearchIndexResult {
	id: number;
	type: ObservationType;
	title: string;
	snippet: string;
	created_at: string;
	relevance_score: number;
}

/** A markdown file stored in the memory DB. */
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

/** Single feedback event on an observation. */
export interface FeedbackEvent {
	type: "helpful" | "harmful";
	timestamp: number;
	reason?: string;
	session_id?: string;
}

/** Returned by `runFullMaintenance`. */
export interface MaintenanceStats {
	archived: number;
	vacuumed: boolean;
	checkpointed: boolean;
	freedBytes: number;
	dbSizeBefore: number;
	dbSizeAfter: number;
}

export interface ArchiveOptions {
	olderThanDays?: number;
	dryRun?: boolean;
	type?: ObservationType;
	includeSuperseded?: boolean;
}

// ---------------------------------------------------------------------------
// Configuration object
// ---------------------------------------------------------------------------

export const MEMORY_CONFIG = {
	fts: {
		tokenizer: "porter unicode61" as const,
		bm25Weights: {
			title: 5.0,
			narrative: 1.0,
			concepts: 2.0,
		},
	},
	injection: {
		enabled: true,
		maxTokens: 2000,
		recencyDecay: 0.95,
		topTerms: 5,
	},
	sanitization: {
		redactEmails: true,
		redactApiKeys: true,
		redactPaths: true,
	},
	maintenance: {
		autoArchiveDays: 365,
		archiveBatchSize: 100,
	},
	telemetry: {
		enabled: true,
	},
} as const;

// ---------------------------------------------------------------------------
// Default factories
// ---------------------------------------------------------------------------

/** Returns a fresh ObservationInput with sensible defaults. */
export function createDefaultObservationInput(
	overrides: Partial<ObservationInput>,
): ObservationInput {
	return {
		type: overrides.type ?? "pattern",
		title: overrides.title ?? "",
		narrative: overrides.narrative ?? "",
		concepts: overrides.concepts ?? [],
		files_read: overrides.files_read ?? [],
		files_modified: overrides.files_modified ?? [],
		confidence: overrides.confidence ?? "medium",
		source: overrides.source ?? "manual",
		...overrides,
	};
}
