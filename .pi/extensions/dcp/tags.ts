/**
 * DCP Extension — Monotonic Message Tagging (v2)
 *
 * Assigns incrementing tag IDs to tool results as they're processed.
 * Inspired by Magic Context's §N§ system for precise message references.
 *
 * Tags are persisted in SQLite and survive session restarts.
 * Used by the deferred drop queue for precise message references.
 */

import type { DCPConfig } from "./config.js";
import { assignTag, getNextTagId, getTagsForSession, getTagByToolCall, type MessageTag } from "./db.js";

// ---------------------------------------------------------------------------
// Tag Manager
// ---------------------------------------------------------------------------

export class TagManager {
	private sessionId: string;
	private nextTag: number;
	private enabled: boolean;

	constructor(sessionId: string, config: DCPConfig) {
		this.sessionId = sessionId;
		this.enabled = config.tagging.enabled;
		// Initialize from DB to maintain monotonicity across restarts
		this.nextTag = getNextTagId(sessionId);
	}

	/**
	 * Assign a new tag to a tool result.
	 * Returns the assigned tag ID, or -1 if tagging is disabled.
	 */
	assign(turn: number, toolName: string, paramsHash: string): number {
		if (!this.enabled) return -1;

		const tagId = assignTag(this.sessionId, turn, toolName, paramsHash);
		this.nextTag = tagId + 1;
		return tagId;
	}

	/**
	 * Get all tags for the current session.
	 */
	getAllTags(): MessageTag[] {
		if (!this.enabled) return [];
		return getTagsForSession(this.sessionId);
	}

	/**
	 * Find the latest tag for a specific tool call signature.
	 */
	findByToolCall(toolName: string, paramsHash: string): MessageTag | null {
		if (!this.enabled) return null;
		return getTagByToolCall(this.sessionId, toolName, paramsHash);
	}

	/**
	 * Get the next tag ID that will be assigned.
	 */
	getNextTag(): number {
		return this.nextTag;
	}

	/**
	 * Get total number of tags in this session.
	 */
	getCount(): number {
		if (!this.enabled) return 0;
		return this.getAllTags().length;
	}

	/**
	 * Reset the tag manager (e.g. after compaction).
	 */
	reset(): void {
		this.nextTag = getNextTagId(this.sessionId);
	}
}
