/**
 * Safety Module — Context Normalization
 *
 * Single point that converts raw pi events into typed ToolCallContext.
 * Handles bash, write, edit, and TaskUpdate tools.
 */

import type { ToolCallContext } from "./types.js";

/**
 * Build a ToolCallContext from a raw pi before_tool_call event.
 * Returns null if the event is malformed or irrelevant.
 */
export function contextFromEvent(event: unknown, cwd: string): ToolCallContext | null {
	if (!event || typeof event !== "object") return null;

	const e = event as Record<string, unknown>;
	const toolName = String(e.name ?? e.toolName ?? "").trim();
	if (!toolName) return null;

	const input = (e.input ?? e.params ?? {}) as Record<string, unknown>;
	const sessionId = String(e.sessionId ?? "default");

	if (toolName === "bash") {
		const command = String(input.command ?? "").replace(/\s+/g, " ").trim();
		if (!command) return null;
		return { tool: "bash", command, cwd, sessionId };
	}

	if (toolName === "write" || toolName === "edit") {
		const path = String(input.path ?? "").trim();
		if (!path) return null;

		// Extract content for injection scanning
		let content: string | undefined;
		if (toolName === "write") {
			const raw = input.content;
			if (typeof raw === "string") content = raw;
		} else {
			// edit tool: join all newText from edits array
			const edits = input.edits;
			if (Array.isArray(edits)) {
				const parts = edits
					.map((e: any) => typeof e?.newText === "string" ? e.newText : "")
					.filter(Boolean);
				if (parts.length > 0) content = parts.join("\n");
			}
		}

		return { tool: toolName, path, content, cwd, sessionId };
	}

	// TaskUpdate — for unverified-completion rule
	const normalized = toolName.toLowerCase();
	if (normalized === "taskupdate" || normalized === "task_update") {
		const status = String(input.status ?? "").trim().toLowerCase();
		const taskId = String(input.taskId ?? "unknown");
		return {
			tool: "taskupdate",
			command: `TaskUpdate taskId=${taskId} status=${status}`,
			cwd,
			sessionId,
		};
	}

	return null;
}
