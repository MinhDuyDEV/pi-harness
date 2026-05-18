/**
 * Time-decay scoring and maturity state machine for observations.
 * Inspired by CASS memory system's scoring model.
 *
 * Key concepts:
 * - Feedback events (helpful/harmful) decay exponentially over time
 * - effectiveScore = decayedHelpful - (4 × decayedHarmful)
 * - Maturity auto-promotes: candidate → established → proven
 * - Auto-deprecates when harmful ratio exceeds threshold
 */

import {
	type FeedbackEvent,
	type MaturityState,
	MEMORY_CONFIG,
	type ObservationRow,
} from "./config.js";
import { getMemoryDB } from "./db.js";

const { scoring } = MEMORY_CONFIG;

// ---------------------------------------------------------------------------
// Time-Decay Calculation
// ---------------------------------------------------------------------------

/**
 * Compute decay weight for a feedback event based on age.
 * Uses exponential decay with configurable half-life.
 * weight = 0.5 ^ (ageDays / halfLifeDays)
 */
function decayWeight(eventTimestamp: number, now: number): number {
	const ageDays = (now - eventTimestamp) / 86_400_000;
	if (ageDays <= 0) return 1.0;
	return 0.5 ** (ageDays / scoring.decayHalfLifeDays);
}

/**
 * Compute effective score from feedback events with time decay.
 * Returns: decayedHelpful - (harmfulMultiplier × decayedHarmful)
 */
export function computeEffectiveScore(events: FeedbackEvent[]): number {
	const now = Date.now();
	let helpfulSum = 0;
	let harmfulSum = 0;

	for (const event of events) {
		const weight = decayWeight(event.timestamp, now);
		if (event.type === "helpful") {
			helpfulSum += weight;
		} else {
			harmfulSum += weight;
		}
	}

	return helpfulSum - scoring.harmfulMultiplier * harmfulSum;
}

// ---------------------------------------------------------------------------
// Maturity State Machine
// ---------------------------------------------------------------------------

/**
 * Determine the next maturity state based on feedback history.
 *
 * candidate → established (>= establishedThreshold helpful)
 * established → proven (>= provenThreshold helpful)
 * any → deprecated (harmful ratio > deprecateRatio with >= deprecateMinEvents)
 */
export function computeMaturity(
	currentMaturity: MaturityState,
	events: FeedbackEvent[],
): MaturityState {
	if (currentMaturity === "deprecated") return "deprecated"; // terminal unless manually revived

	const helpfulCount = events.filter((e) => e.type === "helpful").length;
	const harmfulCount = events.filter((e) => e.type === "harmful").length;
	const totalCount = helpfulCount + harmfulCount;

	// Check for auto-deprecation
	if (
		totalCount >= scoring.deprecateMinEvents &&
		harmfulCount / totalCount > scoring.deprecateRatio
	) {
		return "deprecated";
	}

	// Check for promotion
	if (
		helpfulCount >= scoring.provenThreshold &&
		currentMaturity !== "proven"
	) {
		return "proven";
	}
	if (
		helpfulCount >= scoring.establishedThreshold &&
		currentMaturity === "candidate"
	) {
		return "established";
	}

	return currentMaturity;
}

// ---------------------------------------------------------------------------
// Feedback Recording
// ---------------------------------------------------------------------------

/**
 * Record a feedback event on an observation and update its scores.
 * Returns updated observation state.
 */
export function recordFeedback(
	observationId: number,
	feedbackType: "helpful" | "harmful",
	reason?: string,
	sessionId?: string,
): {
	success: boolean;
	effectiveScore: number;
	maturity: MaturityState;
	helpfulCount: number;
	harmfulCount: number;
	error?: string;
} {
	const db = getMemoryDB();

	const row = db
		.prepare("SELECT * FROM observations WHERE id = ?")
		.get(observationId) as unknown as ObservationRow | undefined;

	if (!row) {
		return {
			success: false,
			effectiveScore: 0,
			maturity: "candidate",
			helpfulCount: 0,
			harmfulCount: 0,
			error: `Observation #${observationId} not found`,
		};
	}

	// Parse existing feedback events
	let events: FeedbackEvent[] = [];
	try {
		events = row.feedback_events ? JSON.parse(row.feedback_events) : [];
	} catch {
		events = [];
	}

	// Append new event
	const newEvent: FeedbackEvent = {
		type: feedbackType,
		timestamp: Date.now(),
		reason,
		session_id: sessionId,
	};
	events.push(newEvent);

	// Recompute scores
	const effectiveScore = computeEffectiveScore(events);
	const helpfulCount =
		feedbackType === "helpful" ? row.helpful_count + 1 : row.helpful_count;
	const harmfulCount =
		feedbackType === "harmful" ? row.harmful_count + 1 : row.harmful_count;
	const maturity = computeMaturity(
		row.maturity as MaturityState,
		events,
	);

	// Persist
	db.prepare(
		`UPDATE observations SET
			helpful_count = ?,
			harmful_count = ?,
			feedback_events = ?,
			effective_score = ?,
			maturity = ?,
			updated_at = ?
		WHERE id = ?`,
	).run(
		helpfulCount,
		harmfulCount,
		JSON.stringify(events),
		effectiveScore,
		maturity,
		new Date().toISOString(),
		observationId,
	);

	return { success: true, effectiveScore, maturity, helpfulCount, harmfulCount };
}

// ---------------------------------------------------------------------------
// Batch Score Refresh
// ---------------------------------------------------------------------------

/**
 * Recompute effective_score and maturity for all observations.
 * Useful after changing scoring config or on periodic maintenance.
 */
export function refreshAllScores(): { updated: number; deprecated: number } {
	const db = getMemoryDB();
	const rows = db
		.prepare(
			"SELECT id, maturity, feedback_events FROM observations WHERE superseded_by IS NULL",
		)
		.all() as Array<{
		id: number;
		maturity: string;
		feedback_events: string | null;
	}>;

	const update = db.prepare(
		`UPDATE observations SET effective_score = ?, maturity = ?, updated_at = ? WHERE id = ?`,
	);

	let updated = 0;
	let deprecated = 0;
	const now = new Date().toISOString();

	for (const row of rows) {
		let events: FeedbackEvent[] = [];
		try {
			events = row.feedback_events ? JSON.parse(row.feedback_events) : [];
		} catch {
			events = [];
		}

		const score = computeEffectiveScore(events);
		const maturity = computeMaturity(
			row.maturity as MaturityState,
			events,
		);

		update.run(score, maturity, now, row.id);
		updated++;
		if (maturity === "deprecated") deprecated++;
	}

	return { updated, deprecated };
}
