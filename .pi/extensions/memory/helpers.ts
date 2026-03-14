/**
 * Memory system utilities: constants, formatting, file helpers.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ObservationType } from "./config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_TYPES: ObservationType[] = [
	"decision",
	"bugfix",
	"feature",
	"pattern",
	"discovery",
	"learning",
	"warning",
];

export const TYPE_ICONS: Record<string, string> = {
	decision: "⚖️",
	bugfix: "🪛",
	feature: "✨",
	pattern: "🔄",
	discovery: "🧭",
	learning: "📚",
	warning: "⚠️",
};

export const FILE_REF_PATTERNS = [
	/(?:^|\s)(\S+\.(?:ts|tsx|js|jsx|json|md|yaml|yml|toml|sql|sh|py|rs|go)):(\d+)/g,
	/`([^`]+\.(?:ts|tsx|js|jsx|json|md|yaml|yml|toml))`/g,
	/(?:^|\s)(src\/\S+)/gm,
	/(?:^|\s)(\.pi\/\S+)/gm,
];

// Compaction limits
export const MAX_SESSION_CONTEXT_CHARS = 3000;
export const MAX_PROJECT_FILES = 3;
export const MAX_PROJECT_FILE_CHARS = 900;
export const MAX_HANDOFF_CHARS = 2500;
export const MAX_BEADS = 8;
export const MAX_COMBINED_CONTEXT_CHARS = 10000;

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n...[truncated]`;
}

export function renderSection(title: string, body: string): string {
	if (!body.trim()) return "";
	return `## ${title}\n${body.trim()}`;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export async function safeReadFile(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, "utf-8");
	} catch {
		return "";
	}
}

export async function readProjectMemoryContext(
	memoryDir: string,
): Promise<string> {
	const projectDir = path.join(memoryDir, "project");
	let names: string[] = [];
	try {
		names = (await readdir(projectDir))
			.filter((n) => n.endsWith(".md"))
			.sort()
			.slice(0, MAX_PROJECT_FILES);
	} catch {
		return "";
	}

	const chunks: string[] = [];
	for (const name of names) {
		const content = (await safeReadFile(path.join(projectDir, name))).trim();
		if (!content) continue;
		chunks.push(
			`### ${name.replace(/\.md$/, "")}\n${truncate(content, MAX_PROJECT_FILE_CHARS)}`,
		);
	}
	return chunks.join("\n\n");
}

export async function readLatestHandoff(handoffDir: string): Promise<string> {
	let names: string[] = [];
	try {
		names = (await readdir(handoffDir)).filter((n) => n.endsWith(".md"));
	} catch {
		return "";
	}
	if (names.length === 0) return "";

	const withMtime = await Promise.all(
		names.map(async (name) => {
			const fullPath = path.join(handoffDir, name);
			try {
				return { name, fullPath, mtimeMs: (await stat(fullPath)).mtimeMs };
			} catch {
				return { name, fullPath, mtimeMs: 0 };
			}
		}),
	);
	withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

	const latest = withMtime[0];
	const content = (await safeReadFile(latest.fullPath)).trim();
	if (!content) return "";
	return `Source: ${latest.name}\n${truncate(content, MAX_HANDOFF_CHARS)}`;
}

// ---------------------------------------------------------------------------
// Observation & CSV helpers
// ---------------------------------------------------------------------------

export function autoDetectFiles(text: string): string[] {
	const files = new Set<string>();
	for (const pattern of FILE_REF_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match: RegExpExecArray | null;
		while ((match = regex.exec(text)) !== null) {
			files.add(match[1]);
		}
	}
	return [...files];
}

export function parseCSV(value: string | undefined): string[] | undefined {
	if (!value) return undefined;
	return value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function formatObservation(obs: {
	id: number;
	type: string;
	title: string;
	subtitle?: string | null;
	confidence?: string | null;
	concepts?: string | null;
	files_read?: string | null;
	files_modified?: string | null;
	facts?: string | null;
	narrative?: string | null;
	bead_id?: string | null;
	supersedes?: number | null;
	superseded_by?: number | null;
	source?: string | null;
	created_at?: string | null;
}): string {
	const icon = TYPE_ICONS[obs.type] ?? "📌";
	const lines = [`${icon} **#${obs.id}** [${obs.type}] ${obs.title}`];
	if (obs.subtitle) lines.push(`  _${obs.subtitle}_`);
	if (obs.confidence) lines.push(`  Confidence: ${obs.confidence}`);
	if (obs.source && obs.source !== "manual")
		lines.push(`  Source: ${obs.source}`);
	if (obs.concepts) lines.push(`  Concepts: ${obs.concepts}`);
	if (obs.files_read) lines.push(`  Files read: ${obs.files_read}`);
	if (obs.files_modified) lines.push(`  Files modified: ${obs.files_modified}`);
	if (obs.facts) lines.push(`  Facts: ${obs.facts}`);
	if (obs.bead_id) lines.push(`  Bead: ${obs.bead_id}`);
	if (obs.supersedes) lines.push(`  Supersedes: #${obs.supersedes}`);
	if (obs.superseded_by) lines.push(`  Superseded by: #${obs.superseded_by}`);
	if (obs.narrative) lines.push(`\n${obs.narrative}`);
	if (obs.created_at) lines.push(`\n  _Created: ${obs.created_at}_`);
	return lines.join("\n");
}
