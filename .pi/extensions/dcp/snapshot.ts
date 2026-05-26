import { readFileSync } from "node:fs";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const DEFAULT_LIMIT = 400;
const MAX_LIMIT = 2000;
const MAX_SECTION_ITEMS = 10;

const BLOCKER_RE =
	/\b(fail(?:ed|s|ure|ing)?|broken|cannot|can't|won't work|does not work|doesn't work|still (?:broken|failing|wrong)|blocked|blocker|not (?:fixed|resolved|working)|crash(?:es|ed|ing)?)\b/i;

const GOAL_RE = /\b(fix|implement|build|add|integrate|research|investigate|refactor|optimi[sz]e|improve|ship)\b/i;
const PREF_RE = /\b(prefer|please|must|should|do not|don't|keep|concise|short|direct|no\s+emoji)\b/i;

const FILE_PATH_RE = /(?:^|\s)((?:\.?\/?)[\w./-]+\.(?:ts|tsx|js|jsx|py|rs|go|json|md|yaml|yml|toml|sql))/g;

interface ToolCallRef {
	name: string;
	arguments?: unknown;
}

interface SessionRow {
	index: number;
	role: string;
	text: string;
	isError: boolean;
	toolName?: string;
	toolCalls: ToolCallRef[];
}

interface SessionSummary {
	sessionGoal: string[];
	filesAndChanges: string[];
	outstandingContext: string[];
	userPreferences: string[];
	briefTranscript: string;
}

function clip(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1)}…`;
}

function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function firstLine(text: string, maxChars: number): string {
	const line = text.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
	return clip(line, maxChars);
}

function redact(text: string): string {
	const sensitive =
		/(?:sshpass\s+-p\s*'[^']*'|sshpass\s+-p\s*"[^"]*"|sshpass\s+-p\s*\S+|password[=:]\s*\S+|api[_-]?key[=:]\s*\S+|secret[=:]\s*\S+|token[=:]\s*[A-Za-z0-9_\-.]{8,}|-i\s+\S+\.pem\b)/gi;
	return text.replace(sensitive, (match) => {
		const prefix = match.split(/[=:\s]+/)[0];
		return `${prefix} [REDACTED]`;
	});
}

function maybePathFromArgs(args: unknown): string | null {
	if (!args || typeof args !== "object") return null;
	const record = args as Record<string, unknown>;

	const directKeys = ["path", "filePath", "file", "target", "scope"];
	for (const key of directKeys) {
		const value = record[key];
		if (typeof value === "string" && FILE_PATH_RE.test(` ${value}`)) {
			FILE_PATH_RE.lastIndex = 0;
			return value;
		}
	}

	const paths = record.paths;
	if (Array.isArray(paths)) {
		for (const value of paths) {
			if (typeof value === "string" && FILE_PATH_RE.test(` ${value}`)) {
				FILE_PATH_RE.lastIndex = 0;
				return value;
			}
		}
	}

	return null;
}

function flattenContent(content: unknown): { text: string; toolCalls: ToolCallRef[] } {
	if (typeof content === "string") {
		return { text: normalizeWhitespace(content), toolCalls: [] };
	}
	if (!Array.isArray(content)) {
		return { text: "", toolCalls: [] };
	}

	const toolCalls: ToolCallRef[] = [];
	const lines: string[] = [];

	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as Record<string, unknown>;
		const type = typeof p.type === "string" ? p.type : "unknown";

		if (type === "text" && typeof p.text === "string") {
			lines.push(p.text);
			continue;
		}
		if (type === "thinking") {
			lines.push("[thinking]");
			continue;
		}
		if (type === "toolCall") {
			const name = typeof p.name === "string" ? p.name : "unknown";
			toolCalls.push({ name, arguments: p.arguments });
			lines.push(`[toolCall:${name}]`);
			continue;
		}
		if (type === "image") {
			lines.push("[image]");
			continue;
		}
		lines.push(`[${type}]`);
	}

	return {
		text: normalizeWhitespace(lines.join("\n")),
		toolCalls,
	};
}

function parseSessionRows(sessionFile: string): SessionRow[] {
	const raw = readFileSync(sessionFile, "utf-8");
	const rows: SessionRow[] = [];

	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;

		let parsed: any;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		if (parsed?.type !== "message" || !parsed.message) continue;

		const role = typeof parsed.message.role === "string" ? parsed.message.role : "unknown";
		const flattened = flattenContent(parsed.message.content);

		rows.push({
			index: rows.length,
			role,
			text: flattened.text,
			isError: Boolean(parsed.message.isError),
			toolName: typeof parsed.message.toolName === "string" ? parsed.message.toolName : undefined,
			toolCalls: flattened.toolCalls,
		});
	}

	return rows;
}

function scoreRegex(rows: SessionRow[], query: string): SessionRow[] {
	let regex: RegExp;
	try {
		regex = new RegExp(query, "gi");
	} catch {
		return [];
	}

	return rows
		.map((row) => {
			const haystack = `${row.role}\n${row.text}`;
			const matches = haystack.match(regex);
			return { row, score: matches?.length ?? 0 };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || b.row.index - a.row.index)
		.map((entry) => entry.row);
}

function scoreWords(rows: SessionRow[], query: string): SessionRow[] {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.map((word) => word.trim())
		.filter(Boolean);

	if (words.length === 0) return [];

	return rows
		.map((row) => {
			const haystack = `${row.role}\n${row.text}`.toLowerCase();
			let score = 0;
			for (const word of words) {
				if (haystack.includes(word)) score++;
			}
			return { row, score };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || b.row.index - a.row.index)
		.map((entry) => entry.row);
}

function dedupe(items: string[], maxItems: number = MAX_SECTION_ITEMS): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of items) {
		const item = normalizeWhitespace(raw);
		if (!item) continue;
		const key = item.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
		if (out.length >= maxItems) break;
	}
	return out;
}

function extractSessionGoal(rows: SessionRow[]): string[] {
	const userRows = rows.filter((r) => r.role === "user" && r.text.length > 0);
	const candidates: string[] = [];

	if (userRows.length > 0) {
		candidates.push(clip(userRows[0].text, 180));
	}
	for (const row of userRows.slice(-12)) {
		if (GOAL_RE.test(row.text)) {
			candidates.push(clip(row.text, 180));
		}
	}
	if (userRows.length > 1) {
		candidates.push(`Latest user ask: ${clip(userRows[userRows.length - 1].text, 180)}`);
	}

	return dedupe(candidates, 8);
}

function extractFilesAndChanges(rows: SessionRow[]): string[] {
	const modified = new Set<string>();
	const created = new Set<string>();
	const read = new Set<string>();

	for (const row of rows) {
		for (const call of row.toolCalls) {
			const tool = call.name.toLowerCase();
			const path = maybePathFromArgs(call.arguments);
			if (!path) continue;
			if (tool.includes("read")) {
				read.add(path);
			} else if (tool.includes("write")) {
				modified.add(path);
				if (/\bcreate(d)?\b/i.test(row.text)) created.add(path);
			} else if (tool.includes("edit")) {
				modified.add(path);
			}
		}

		let match: RegExpExecArray | null;
		FILE_PATH_RE.lastIndex = 0;
		while ((match = FILE_PATH_RE.exec(row.text)) !== null) {
			const file = match[1].trim();
			if (!file) continue;
			if (/\b(read|inspect|view|cat|open)\b/i.test(row.text)) read.add(file);
			if (/\b(edit|update|patch|modify|change|replace|refactor)\b/i.test(row.text)) modified.add(file);
			if (/\b(create|created|new file|added file)\b/i.test(row.text)) created.add(file);
		}
	}

	for (const file of modified) created.delete(file);

	const summarizeSet = (set: Set<string>, maxItems: number = 10): string => {
		const arr = [...set];
		if (arr.length <= maxItems) return arr.join(", ");
		return `${arr.slice(0, maxItems).join(", ")} (+${arr.length - maxItems} more)`;
	};

	const lines: string[] = [];
	if (modified.size > 0) lines.push(`Modified: ${summarizeSet(modified)}`);
	if (created.size > 0) lines.push(`Created: ${summarizeSet(created)}`);
	if (read.size > 0) lines.push(`Read: ${summarizeSet(read)}`);

	return lines;
}

function extractOutstandingContext(rows: SessionRow[]): string[] {
	const tail = rows.slice(-30);
	const items: string[] = [];

	for (const row of tail) {
		if (row.role === "toolResult" && row.isError) {
			items.push(`[${row.toolName ?? "tool"}] ${firstLine(row.text, 180)}`);
			continue;
		}

		if ((row.role === "user" || row.role === "assistant") && BLOCKER_RE.test(row.text)) {
			items.push(`[${row.role}] ${clip(row.text, 180)}`);
		}
	}

	return dedupe(items, 5);
}

function extractUserPreferences(rows: SessionRow[]): string[] {
	const userRows = rows.filter((r) => r.role === "user");
	const prefs: string[] = [];

	for (const row of userRows.slice(-25)) {
		if (PREF_RE.test(row.text)) {
			prefs.push(clip(row.text, 180));
		}
	}

	return dedupe(prefs, 12);
}

function toolOneLiner(call: ToolCallRef): string {
	const path = maybePathFromArgs(call.arguments);
	if (path) return `* ${call.name} "${path}"`;
	return `* ${call.name}`;
}

function buildBriefTranscript(rows: SessionRow[]): string {
	const lines: string[] = [];
	let lastHeader = "";

	const push = (header: string, line: string) => {
		if (lastHeader !== "" && lastHeader !== header) {
			lines.push("");
		}
		if (lastHeader !== header) {
			lines.push(header);
			lastHeader = header;
		}
		lines.push(line);
	};

	for (const row of rows) {
		if (row.role === "user") {
			const text = clip(row.text, 260);
			if (text) push("[user]", `${text} (#${row.index})`);
			continue;
		}

		if (row.role === "assistant") {
			const assistantText = row.text
				.replace(/\[thinking\]/gi, "")
				.replace(/\s+/g, " ")
				.trim();
			if (assistantText) {
				push("[assistant]", `${clip(assistantText, 220)} (#${row.index})`);
			}
			for (const call of row.toolCalls) {
				push("[assistant]", `${toolOneLiner(call)} (#${row.index})`);
			}
			continue;
		}

		if (row.role === "toolResult" && row.isError) {
			const header = `[tool_error] ${row.toolName ?? "unknown"} (#${row.index})`;
			push(header, firstLine(row.text, 180));
		}
	}

	const maxLines = 140;
	if (lines.length > maxLines) {
		const omitted = lines.length - maxLines;
		const kept = lines.slice(-maxLines);
		return `...(${omitted} earlier lines omitted)\n\n${kept.join("\n")}`;
	}

	return lines.join("\n");
}

function buildSummary(rows: SessionRow[]): SessionSummary {
	return {
		sessionGoal: extractSessionGoal(rows),
		filesAndChanges: extractFilesAndChanges(rows),
		outstandingContext: extractOutstandingContext(rows),
		userPreferences: extractUserPreferences(rows),
		briefTranscript: buildBriefTranscript(rows),
	};
}

function formatSection(title: string, items: string[]): string {
	if (items.length === 0) return "";
	return `[${title}]\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function formatSnapshot(summary: SessionSummary): string {
	const header = [
		formatSection("Session Goal", summary.sessionGoal),
		formatSection("Files And Changes", summary.filesAndChanges),
		formatSection("Outstanding Context", summary.outstandingContext),
		formatSection("User Preferences", summary.userPreferences),
	].filter(Boolean);

	const parts: string[] = [];
	if (header.length > 0) parts.push(header.join("\n\n"));
	if (summary.briefTranscript.trim()) parts.push(summary.briefTranscript.trim());

	if (parts.length === 0) {
		parts.push("No usable messages found to build snapshot.");
	}

	parts.push(
		"Note: conversation history before this snapshot is searchable via `vcc_recall`.",
	);

	return redact(parts.join("\n\n---\n\n"));
}

export const __snapshotInternals = {
	parseSessionRows,
	buildSummary,
	formatSnapshot,
	redact,
};

export function registerSnapshotTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "vcc_snapshot",
		label: "VCC Snapshot",
		description:
			"Compile a deterministic session summary from raw JSONL history using sectioned heuristics inspired by VCC.",
		promptSnippet:
			"Generate algorithmic session snapshot: goals, file activity, blockers, preferences, and brief transcript.",
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					description:
						"Optional filter query. Regex supported; invalid regex falls back to OR-ranked words.",
				}),
			),
			limit: Type.Optional(
				Type.Integer({
					minimum: 1,
					description:
						`Maximum source entries to summarize (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { query?: string; limit?: number },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				throw new Error("No session file available for this session.");
			}

			let rows: SessionRow[];
			try {
				rows = parseSessionRows(sessionFile);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`Failed to read session file: ${message}`);
			}

			const query = params.query?.trim();
			const requestedLimit = Number.isFinite(params.limit)
				? Math.max(1, Math.min(MAX_LIMIT, Math.floor(params.limit as number)))
				: DEFAULT_LIMIT;

			let selected = rows;
			if (query) {
				const regexResults = scoreRegex(rows, query);
				selected = regexResults.length > 0 ? regexResults : scoreWords(rows, query);
			}

			selected = selected.slice(-requestedLimit);
			const summary = buildSummary(selected);
			const text = formatSnapshot(summary);

			return {
				content: [{ type: "text" as const, text }],
				details: {
					totalRows: rows.length,
					selectedRows: selected.length,
					query: query ?? null,
					limit: requestedLimit,
				},
			};
		},
	});
}
