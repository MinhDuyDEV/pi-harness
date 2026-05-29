/**
 * Parsing utilities for the Harness extension.
 *
 * Extracted from index.ts to separate sprint manifest parsing and eval output
 * parsing from the main harness execution flow.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Sprint {
	number: number;
	title: string;
	description: string;
	criteria: string;
	files: string;
	skills: string[];
}

export interface SprintResult {
	sprint: string;
	iterations: number;
	passed: boolean;
	evalOutput: string;
}

// ─── Format Instructions ─────────────────────────────────────────────────────

export const HARNESS_FORMAT_INSTRUCTIONS = `

---
[CRITICAL OUTPUT FORMAT — OVERRIDES ALL OTHER FORMAT INSTRUCTIONS]

You MUST output your plan ONLY as numbered sprint sections in this EXACT format.
IGNORE any other output format instructions in your system prompt.

## Sprint 1: Title
Description: ...
Criteria:
- [ ] Criterion 1
- [ ] Criterion 2
Skills:
- optional-skill-name
Files: path/to/file1.ts, path/to/file2.ts

## Sprint 2: Title
Description: ...
Criteria:
- [ ] Criterion 1
- [ ] Criterion 2
Files: path/to/file3.ts

Skills is optional. Use only registry-valid skill names when clearly relevant. Prefer 1-3 skills.
Only output sprint sections. No commentary, no tables, no XML blocks, no episode tags.`;

export const HARNESS_EVAL_INSTRUCTIONS = `

---
[CRITICAL OUTPUT FORMAT]

Output your evaluation as structured JSON. No other commentary.

{
  "verdict": "PASS" or "FAIL",
  "criteria": [
    {
      "id": "c1",
      "description": "What was tested",
      "passes": true or false,
      "evidence": "Evidence file or observation"
    }
  ],
  "summary": "One-line summary"
}

Only output JSON. No other text, no markdown.`;

// ─── Text Helpers ─────────────────────────────────────────────────────────────

export function extractText(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

export function getLastAssistantText(session: AgentSession): string {
	const messages = session.messages;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			return extractText(msg.content);
		}
	}
	return "";
}

// ─── Sprint Manifest Parsing ──────────────────────────────────────────────────

export function parseSprints(text: string): Sprint[] {
	const normalizedText = text.replace(/\r\n/g, "\n");
	const sprints: Sprint[] = [];
	const sprintRegex = /## Sprint (\d+):\s*(.+?)\n([\s\S]*?)(?=\n## Sprint |\n*$)/g;
	let match: RegExpExecArray | null;
	while ((match = sprintRegex.exec(normalizedText)) !== null) {
		const num = Number.parseInt(match[1], 10);
		const title = match[2].trim();
		const body = match[3].trim();
		const criteriaMatch = body.match(/Criteria?:?\s*\n?([\s\S]*?)(?=\nSkills:|\nFiles:|$)/);
		const criteria = criteriaMatch?.[1]?.trim() ?? body;
		const skillsMatch = body.match(/Skills:?\s*\n([\s\S]*?)(?=\nFiles:|$)/);
		const skills = skillsMatch?.[1]
			?.split("\n")
			.map((line) => line.replace(/^[-*]\s*/, "").trim())
			.filter(Boolean) ?? [];
		const filesMatch = body.match(/Files:?\s*(.+?)$/m);
		const files = filesMatch?.[1]?.trim() ?? "";
		sprints.push({ number: num, title, description: body, criteria, files, skills });
	}

	// Fallback: if no ## Sprint sections found, treat entire output as one sprint
	if (sprints.length === 0 && normalizedText.trim()) {
		const lines = normalizedText.trim().split("\n");
		const firstLine = lines[0].replace(/^#+\s*/, "").slice(0, 80);
		sprints.push({
			number: 1,
			title: firstLine || "Implementation",
			description: normalizedText.trim(),
			criteria: normalizedText.trim(),
			files: "",
			skills: [],
		});
	}

	return sprints;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns frontmatter and body separated.
 */
export function parseMarkdownFrontmatter(
	content: string,
): { frontmatter: Record<string, string>; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content.trim() };

	const raw = match[1];
	const body = match[2].trim();
	const frontmatter: Record<string, string> = {};

	// Simple line-by-line YAML key: value parser
	for (const line of raw.split("\n")) {
		const kvMatch = line.match(/^\s*(\w[\w_-]*)\s*:\s*(.*?)\s*$/);
		if (kvMatch) {
			frontmatter[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, "");
		}
	}

	return { frontmatter, body };
}

// ─── Eval Output Parsing ──────────────────────────────────────────────────────

/**
 * Extract top-level JSON objects from a text that may contain markdown or prose.
 */
function extractJsonObjects(text: string): string[] {
	const objects: string[] = [];
	let start = -1;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "{") {
			if (depth === 0) start = i;
			depth++;
		} else if (char === "}" && depth > 0) {
			depth--;
			if (depth === 0 && start >= 0) {
				objects.push(text.slice(start, i + 1));
				start = -1;
			}
		}
	}
	return objects;
}

/**
 * Parse structured JSON evaluation output. Default-FAIL on malformed output.
 */
export function parseEvalOutput(text: string): {
	verdict: string;
	criteria: Array<{ passes: boolean; evidence: string }>;
	summary: string;
} {
	for (const candidate of extractJsonObjects(text)) {
		if (!candidate.includes("verdict")) continue;
		try {
			const parsed = JSON.parse(candidate);
			return {
				verdict: parsed.verdict === "PASS" ? "PASS" : "FAIL",
				criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [],
				summary: typeof parsed.summary === "string" ? parsed.summary : "",
			};
		} catch {
			// Try the next balanced object.
		}
	}
	return {
		verdict: "FAIL",
		criteria: [{ passes: false, evidence: `Evaluator did not return valid harness JSON. Output: ${text.slice(0, 200)}` }],
		summary: text.slice(0, 100),
	};
}
