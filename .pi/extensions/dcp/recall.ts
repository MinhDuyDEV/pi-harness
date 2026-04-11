import { readFileSync } from "node:fs";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const DEFAULT_RECENT = 25;
const MAX_RESULTS = 50;
const PREVIEW_MAX_CHARS = 240;

interface MessageRow {
	index: number;
	role: string;
	preview: string;
	full: string;
}

function flattenContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((part: any) => {
			if (!part || typeof part !== "object") return "";
			if (part.type === "text" && typeof part.text === "string") return part.text;
			if (part.type === "thinking") return "[thinking]";
			if (part.type === "toolCall") {
				const name = typeof part.name === "string" ? part.name : "unknown";
				return `[toolCall:${name}]`;
			}
			if (part.type === "image") return "[image]";
			return `[${String(part.type ?? "unknown")}]`;
		})
		.filter(Boolean)
		.join("\n");
}

function toPreview(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= PREVIEW_MAX_CHARS) return normalized;
	return `${normalized.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}

function parseSessionMessages(sessionFile: string): MessageRow[] {
	const raw = readFileSync(sessionFile, "utf-8");
	const rows: MessageRow[] = [];

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
		const full = flattenContent(parsed.message.content);
		const preview = toPreview(full);

		rows.push({
			index: rows.length,
			role,
			preview,
			full,
		});
	}

	return rows;
}

function scoreRegex(rows: MessageRow[], query: string): MessageRow[] {
	let regex: RegExp;
	try {
		regex = new RegExp(query, "gi");
	} catch {
		return [];
	}

	const scored = rows
		.map((row) => {
			const haystack = `${row.role}\n${row.full}`;
			const matches = haystack.match(regex);
			const score = matches?.length ?? 0;
			return { row, score };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || b.row.index - a.row.index)
		.slice(0, MAX_RESULTS)
		.map((entry) => entry.row);

	return scored;
}

function scoreWords(rows: MessageRow[], query: string): MessageRow[] {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.map((word) => word.trim())
		.filter(Boolean);

	if (words.length === 0) return [];

	return rows
		.map((row) => {
			const haystack = `${row.role}\n${row.full}`.toLowerCase();
			let score = 0;
			for (const word of words) {
				if (haystack.includes(word)) score++;
			}
			return { row, score };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || b.row.index - a.row.index)
		.slice(0, MAX_RESULTS)
		.map((entry) => entry.row);
}

function formatBrief(rows: MessageRow[], query?: string): string {
	const lines: string[] = [];
	if (query?.trim()) {
		lines.push(`[vcc_recall] query: ${query.trim()}`);
	} else {
		lines.push("[vcc_recall] recent messages");
	}
	lines.push("");

	for (const row of rows) {
		const preview = row.preview || "(no text content)";
		lines.push(`[${row.index}] ${row.role}: ${preview}`);
	}

	if (rows.length === 0) {
		lines.push("No matching message entries.");
	}

	return lines.join("\n");
}

function formatExpanded(rows: MessageRow[], indices: number[]): string {
	const lines: string[] = ["[vcc_recall] expanded entries", ""];

	for (const idx of indices) {
		const row = rows.find((r) => r.index === idx);
		if (!row) continue;
		lines.push(`[${row.index}] ${row.role}`);
		lines.push(row.full || "(no text content)");
		lines.push("---");
	}

	if (lines.length === 2) {
		lines.push(`No entries found for indices: ${indices.join(", ")}`);
	}

	return lines.join("\n");
}

export function registerRecallTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "vcc_recall",
		label: "VCC Recall",
		description:
			"Search full conversation history in this session, including compacted parts. " +
			"Use without query to see recent brief history. Supports regex queries and OR-ranked multi-word search.",
		promptSnippet:
			"Search full session history from raw JSONL, including content before compaction.",
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					description:
						"Search query. Regex supported (e.g. 'hook|inject'). Multi-word queries use OR ranking.",
				}),
			),
			expand: Type.Optional(
				Type.Array(Type.Number(), {
					description: "Entry indices to return full content for.",
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { query?: string; expand?: number[] },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				return {
					content: [{ type: "text" as const, text: "No session file available." }],
					details: undefined,
				};
			}

			let rows: MessageRow[];
			try {
				rows = parseSessionMessages(sessionFile);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Failed to read session file: ${message}` }],
					details: undefined,
				};
			}

			const expand = (params.expand ?? []).filter((n) => Number.isInteger(n) && n >= 0);
			const query = params.query?.trim();

			if (expand.length > 0 && !query) {
				const unique = [...new Set(expand)].sort((a, b) => a - b);
				return {
					content: [{ type: "text" as const, text: formatExpanded(rows, unique) }],
					details: undefined,
				};
			}

			if (!query) {
				const recent = rows.slice(-DEFAULT_RECENT);
				return {
					content: [{ type: "text" as const, text: formatBrief(recent) }],
					details: undefined,
				};
			}

			const regexResults = scoreRegex(rows, query);
			const results = regexResults.length > 0 ? regexResults : scoreWords(rows, query);

			return {
				content: [{ type: "text" as const, text: formatBrief(results, query) }],
				details: undefined,
			};
		},
	});
}
