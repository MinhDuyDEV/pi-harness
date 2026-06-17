/**
 * Observation scoring — minimal version.
 *
 * Score = (helpful_count - harmful_count) * recencyMultiplier
 *
 * No time decay, no 4-state maturity machine, no harmful multiplier.
 * Per the Syntax #976 thesis: "Code is truth, bash is all you need."
 * The previous 4-state machine ran on feedback data we never collected.
 */

import type { ObservationRow } from "./config.js";
import { getMemoryDB } from "./db.js";

const RECENCY_HALF_LIFE_DAYS = 90;

/**
 * Compute a simple observation score: net helpful votes, dampened by age.
 * Newer observations get a small recency bonus that fades over 90 days.
 */
export function computeScore(row: ObservationRow, now: number = Date.now()): number {
	const helpful = (row as any).helpful_count ?? 0;
	const harmful = (row as any).harmful_count ?? 0;
	const createdAt = (row as any).created_at_epoch;
	const ageDays = createdAt
		? (now - createdAt) / 86_400_000
		: 0;
	const recency = ageDays <= 0 ? 1 : 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
	return (helpful - harmful) * recency;
}

/**
 * Record helpful/harmful feedback on an observation.
 * Increments the count and updates `updated_at` / `updated_at_epoch`.
 * No maturity promotion, no effective score column maintained
 * (just helpful_count - harmful_count).
 */
export function recordFeedback(
	observationId: number,
	feedbackType: "helpful" | "harmful",
): { success: boolean; error?: string; helpfulCount: number; harmfulCount: number } {
	const db = getMemoryDB();

	const row = db
		.prepare("SELECT id FROM observations WHERE id = ?")
		.get(observationId) as { id: number } | undefined;

	if (!row) {
		return {
			success: false,
			error: `Observation #${observationId} not found`,
			helpfulCount: 0,
			harmfulCount: 0,
		};
	}

	const column = feedbackType === "helpful" ? "helpful_count" : "harmful_count";
	const nowMs = Date.now();
	const nowIso = new Date(nowMs).toISOString();
	const rowAfter = db
		.prepare(
			`UPDATE observations
				SET ${column} = ${column} + 1,
				    updated_at = ?,
				    updated_at_epoch = ?
				WHERE id = ?
				RETURNING helpful_count, harmful_count`,
		)
		.get(nowIso, nowMs, observationId) as
		| { helpful_count: number; harmful_count: number }
		| undefined;

	return {
		success: true,
		helpfulCount: rowAfter?.helpful_count ?? 0,
		harmfulCount: rowAfter?.harmful_count ?? 0,
	};
}
