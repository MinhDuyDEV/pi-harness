/**
 * Safety Module — Context Normalization
 *
 * Single point that converts raw pi events into typed ToolCallContext.
 * bash, read, write, edit, and TaskUpdate get specialized contexts; EVERY
 * other tool gets a generic one carrying its serialized input.
 *
 * The generic fallback is the policy boundary. This module used to return
 * null for any tool it did not recognize, and the extension treats null as
 * "nothing to evaluate" — so every MCP tool, and every tool Pi grows later,
 * bypassed all rules including the ones registered with `targets: ["*"]`.
 * A safety layer that only sees five tool names is a safety layer for
 * exactly five tool names.
 */

import type { ToolCallContext } from "./types.js";

/**
 * Bound on serialized input fed to rules for unknown tools. Rules run on
 * every tool call; an unbounded payload turns the policy check into the
 * slowest part of the call. Truncation only narrows scanning for inputs
 * this large, and the size is recorded so the audit shows it happened.
 */
const MAX_SERIALIZED_INPUT = 16_384;

function serializeInput(input: Record<string, unknown>): string {
	let raw: string;
	try {
		raw = JSON.stringify(input) ?? "";
	} catch {
		// Circular or hostile input. Fall back to the values that stringify.
		const parts: string[] = [];
		for (const [key, value] of Object.entries(input)) {
			try {
				parts.push(`${key}=${JSON.stringify(value)}`);
			} catch {
				parts.push(`${key}=[unserializable]`);
			}
		}
		raw = parts.join(" ");
	}
	return raw.length > MAX_SERIALIZED_INPUT
		? `${raw.slice(0, MAX_SERIALIZED_INPUT)}…[truncated ${raw.length - MAX_SERIALIZED_INPUT} chars]`
		: raw;
}

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
	if (toolName !== "edit") return undefined;

	const edits = input.edits;
	if (!Array.isArray(edits)) return undefined;
	const parts: string[] = [];
	for (const edit of edits) {
		if (!edit || typeof edit !== "object") continue;
		const newText = (edit as Record<string, unknown>).newText;
		if (typeof newText === "string" && newText.length > 0) parts.push(newText);
	}
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

/**
 * Build a ToolCallContext from a raw pi tool_call event.
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

	// A specialized builder returning null means the event was missing its
	// primary field (no command, no path) — fall through to the generic
	// context rather than skipping evaluation: the rest of the input may
	// still contain something a wildcard rule cares about.
	if (toolName === "bash") {
		const bashContext = buildBashContext(input, url, urls, cwd, sessionId);
		if (bashContext) return bashContext;
	}

	if (toolName === "read" || toolName === "write" || toolName === "edit") {
		const fileContext = buildFileContext(input, toolName, url, urls, cwd, sessionId);
		if (fileContext) return fileContext;
	}

	if (isTaskUpdate(toolName)) {
		return buildTaskUpdateContext(input, sessionId, cwd);
	}

	// Every other tool: evaluate by default. The serialized input goes into
	// `command` so wildcard rules that scan text (URL extraction, credential
	// patterns) see nested parameters, not just a top-level `url` field.
	const serialized = serializeInput(input);
	return {
		tool: toolName,
		command: serialized || undefined,
		url,
		urls,
		cwd,
		sessionId,
	};
}
