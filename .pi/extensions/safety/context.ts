/**
 * Safety Module — Context Normalization
 *
 * Single point that converts raw pi events into typed ToolCallContext.
 * Handles bash, write, edit, and TaskUpdate tools.
 */

import type { ToolCallContext } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEventUrls(
	input: Record<string, unknown>,
): { url?: string; urls?: string[] } {
	const url = typeof input.url === "string" ? input.url.trim() : undefined;
	const urls = Array.isArray(input.urls)
		? input.urls
			.map((entry) => typeof entry === "string" ? entry.trim() : "")
			.filter(Boolean)
		: undefined;
	return { url, urls };
}

function extractFileContent(
	input: Record<string, unknown>,
	toolName: string,
): string | undefined {
	if (toolName === "write") {
		const raw = input.content;
		return typeof raw === "string" ? raw : undefined;
	}
	// edit tool: join all newText from edits array
	const edits = input.edits;
	if (!Array.isArray(edits)) return undefined;
	const parts = edits
		.map((e: any) => typeof e?.newText === "string" ? e.newText : "")
		.filter(Boolean);
	return parts.length > 0 ? parts.join("\n") : undefined;
}

function isTaskUpdate(toolName: string): boolean {
	const normalized = toolName.toLowerCase();
	return normalized === "taskupdate" || normalized === "task_update";
}

function buildBashContext(
	input: Record<string, unknown>,
	url: string | undefined,
	urls: string[] | undefined,
	cwd: string,
	sessionId: string,
): ToolCallContext | null {
	const command = String(input.command ?? "").replace(/\s+/g, " ").trim();
	if (!command) return null;
	return { tool: "bash", command, url, urls, cwd, sessionId };
}

function buildFileContext(
	input: Record<string, unknown>,
	toolName: string,
	url: string | undefined,
	urls: string[] | undefined,
	cwd: string,
	sessionId: string,
): ToolCallContext | null {
	const path = String(input.path ?? "").trim();
	if (!path) return null;
	const content = extractFileContent(input, toolName);
	return { tool: toolName, path, content, url, urls, cwd, sessionId };
}

function buildTaskUpdateContext(
	input: Record<string, unknown>,
	sessionId: string,
	cwd: string,
): ToolCallContext {
	const status = String(input.status ?? "").trim().toLowerCase();
	const taskId = String(input.taskId ?? "unknown");
	return {
		tool: "taskupdate",
		command: `TaskUpdate taskId=${taskId} status=${status}`,
		cwd,
		sessionId,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a ToolCallContext from a raw pi before_tool_call event.
 * Returns null if the event is malformed or irrelevant.
 */
export function contextFromEvent(
	event: unknown,
	cwd: string,
): ToolCallContext | null {
	if (!event || typeof event !== "object") return null;

	const e = event as Record<string, unknown>;
	const toolName = String(e.name ?? e.toolName ?? "").trim();
	if (!toolName) return null;

	const input = (e.input ?? e.params ?? {}) as Record<string, unknown>;
	const sessionId = String(e.sessionId ?? "default");
	const { url, urls } = getEventUrls(input);

	if (toolName === "bash") {
		return buildBashContext(input, url, urls, cwd, sessionId);
	}

	if (toolName === "write" || toolName === "edit") {
		return buildFileContext(input, toolName, url, urls, cwd, sessionId);
	}

	if (isTaskUpdate(toolName)) {
		return buildTaskUpdateContext(input, sessionId, cwd);
	}

	if (url || (urls && urls.length > 0)) {
		return {
			tool: toolName,
			url,
			urls,
			cwd,
			sessionId,
		};
	}

	return null;
}
