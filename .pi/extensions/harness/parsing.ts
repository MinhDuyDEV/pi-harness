/**
 * Parsing utilities for the Harness extension.
 *
 * Extracted from index.ts to separate sprint manifest parsing and eval output
 * parsing from the main harness execution flow.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";

export type HarnessRiskLane = "tiny" | "normal" | "high-risk";

/**
 * Sprint result verdict:
 *   PASS         — verification commands ran and passed
 *   FAIL         — verification commands failed OR evaluator said FAIL
 *   ATTESTED     — no verification commands, but LLM evaluator said PASS
 *   UNVERIFIABLE — no verification commands and no evaluator ran (pipeline mode)
 */
export type SprintVerdict = "PASS" | "FAIL" | "ATTESTED" | "UNVERIFIABLE";

export type EvalConfidence = "high" | "medium" | "low";

export interface Sprint {
	number: number;
	title: string;
	description: string;
	riskLane: HarnessRiskLane;
	riskFlags: string[];
	contextNeeded: string[];
	proofRequired: string[];
	criteria: string;
	files: string;
	ownedFiles: string[];
	skills: string[];
	verificationCommands: string[];
	verificationRequired: boolean;
	dependencies: number[];
}

export interface SprintResult {
	sprint: string;
	iterations: number;
	passed: boolean;
	verdict: SprintVerdict;
	confidence: EvalConfidence;
	evalOutput: string;
	verification?: VerificationSummary;
}

export interface VerificationCommandResult {
	command: string;
	allowed: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	reason?: string;
}

export interface VerificationSummary {
	status: "passed" | "failed" | "skipped" | "unverifiable";
	results: VerificationCommandResult[];
}

export interface EvalCriterionResult {
	description?: string;
	passes: boolean;
	evidence: string;
	confidence?: EvalConfidence;
}

export const HARNESS_FORMAT_INSTRUCTIONS = `

---
[ENFORCED OUTPUT CONTRACT]

This harness enforces a strict sprint manifest format. If you do not follow it, your output will be rejected.

Required fields per sprint: Description, Lane, Risk Flags, Context Needed, Proof Required, Criteria, Verification Commands, Files.

Every sprint MUST include at least one deterministic verification command (test, typecheck, lint, build, or equivalent). If the sprint truly has no feasible deterministic check, use a command that documents manual verification (e.g. \`echo "manually verified: see criteria"\`).

Use Lane: tiny, normal, or high-risk. Risk Flags, Context Needed, Proof Required, and Skills may be bullet lists or comma-separated inline values.

Start with \`## Sprint 1:\`. Output only sprint sections. No commentary.`;

export const HARNESS_EVAL_INSTRUCTIONS = `

---
[CRITICAL OUTPUT FORMAT]

Output your evaluation as structured JSON. No other commentary.

{
  "verdict": "PASS" or "FAIL",
  "confidence": "high" or "medium" or "low",
  "criteria": [
    {
      "id": "c1",
      "description": "What was tested",
      "passes": true or false,
      "evidence": "Specific file:line or command evidence",
      "confidence": "high" or "medium" or "low"
    }
  ],
  "summary": "One-line summary"
}

Only output JSON. No other text, no markdown.

Confidence rules:
- high: evidence is deterministic (test output, typecheck, verified command exit codes)
- medium: evidence is structural (code inspection, diff review, file:line references)
- low: evidence is speculative (looks correct, seems fine, no concrete verification)

A PASS requires every sprint criterion to appear in criteria with passes=true and non-empty evidence.`;

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

export function parseCriteriaItems(criteria: string): string[] {
	return criteria
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.replace(/^[-*]\s*/, "").replace(/^\[[ xX]\]\s*/, "").trim())
		.filter(Boolean);
}

function parseTextSection(body: string, label: string, stopLabels: string[]): string {
	const stops = stopLabels.map((item) => `\\n${item}:`).join("|");
	const regex = new RegExp(`${label}:?\\s*([\\s\\S]*?)(?=${stops}|$)`);
	return body.match(regex)?.[1]?.trim() ?? "";
}

function parseListSection(body: string, label: string, stopLabels: string[]): string[] {
	return parseTextSection(body, label, stopLabels)
		.split(/\n|,/)
		.map((line) => line.replace(/^[-*]\s*/, "").trim())
		.filter((line) => Boolean(line) && !["none", "n/a", "na"].includes(line.toLowerCase()));
}

function parseRiskLane(value: string): HarnessRiskLane | null {
	const normalized = value.trim().toLowerCase().replace(/_/g, "-");
	if (normalized === "tiny") return "tiny";
	if (normalized === "normal") return "normal";
	if (normalized === "high-risk" || normalized === "high risk") return "high-risk";
	return null;
}

function hasSection(body: string, label: string): boolean {
	return new RegExp(`(^|\\n)${label}:`, "i").test(body);
}

export function parseSprints(text: string): Sprint[] {
	const normalizedText = text.replace(/\r\n/g, "\n");
	const sprints: Sprint[] = [];
	const sprintRegex = /## Sprint (\d+):\s*(.+?)\n([\s\S]*?)(?=\n## Sprint |\n*$)/g;
	let match: RegExpExecArray | null;
	while ((match = sprintRegex.exec(normalizedText)) !== null) {
		const num = Number.parseInt(match[1], 10);
		const title = match[2].trim();
		const body = match[3].trim();
		const stopLabels = ["Description", "Lane", "Risk Flags", "Context Needed", "Proof Required", "Criteria", "Skills", "Verification Commands", "Dependencies", "Files"];
		const requiredSections = ["Description", "Lane", "Risk Flags", "Context Needed", "Proof Required", "Criteria", "Files"];
		if (!requiredSections.every((label) => hasSection(body, label))) continue;
		const description = parseTextSection(body, "Description", stopLabels);
		const criteriaMatch = body.match(/Criteria?:?\s*\n?([\s\S]*?)(?=\nLane:|\nRisk Flags:|\nContext Needed:|\nProof Required:|\nSkills:|\nVerification Commands:|\nFiles:|$)/);
		const criteria = criteriaMatch?.[1]?.trim() ?? "";
		const riskLane = parseRiskLane(parseTextSection(body, "Lane", stopLabels));
		const riskFlags = parseListSection(body, "Risk Flags", stopLabels);
		const contextNeeded = parseListSection(body, "Context Needed", stopLabels);
		const proofRequired = parseListSection(body, "Proof Required", stopLabels);
		const skills = parseListSection(body, "Skills", ["Verification Commands", "Files"]);
		const verificationCommands = parseListSection(body, "Verification Commands", ["Dependencies", "Files"]);
		const dependenciesRaw = parseListSection(body, "Dependencies", ["Files"]);
		const dependencies = dependenciesRaw.map((item) => Number.parseInt(item, 10)).filter((n) => Number.isFinite(n) && n !== num);
		const filesMatch = body.match(/Files:?\s*(.+?)$/m);
		const files = filesMatch?.[1]?.trim() ?? "";
		if (!description || !criteria || !riskLane || !files) continue;
		const ownedFiles = files.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
		// verificationRequired means the sprint needs verification per policy (lane, proof type).
		// Sprint.verificationCommands.length > 0 determines if commands were actually declared.
		const verificationRequired = riskLane === "high-risk" || proofRequired.some((item) => !/^(manual|manual review|review|none|n\/?a)$/i.test(item.trim()));
		sprints.push({ number: num, title, description, riskLane, riskFlags, contextNeeded, proofRequired, criteria, files, ownedFiles, skills, verificationCommands, verificationRequired, dependencies });
	}

	return sprints;
}

export { parseMarkdownFrontmatter } from "../lib/util.js";

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

function normalizeExpectedCriteria(expectedCriteria?: readonly string[] | string): string[] {
	if (!expectedCriteria) return [];
	if (typeof expectedCriteria === "string") return parseCriteriaItems(expectedCriteria);
	return expectedCriteria.map((item) => item.trim()).filter(Boolean);
}

function normalizeEvalCriteria(value: unknown): EvalCriterionResult[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => {
		if (typeof item !== "object" || item === null) return { passes: false, evidence: "Malformed criterion" };
		const record = item as Record<string, unknown>;
		const description = typeof record.description === "string"
			? record.description
			: typeof record.criterion === "string"
				? record.criterion
				: typeof record.id === "string"
					? record.id
					: undefined;
		const confidenceRaw = record.confidence;
		let confidence: "high" | "medium" | "low" | undefined;
		if (confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low") confidence = confidenceRaw;
		return {
			description,
			passes: record.passes === true,
			evidence: typeof record.evidence === "string" ? record.evidence.trim() : "",
			confidence,
		};
	});
}

function failEval(criteria: EvalCriterionResult[], summary: string, evidence: string, confidence: EvalConfidence = "low"): { verdict: "FAIL"; confidence: EvalConfidence; criteria: EvalCriterionResult[]; summary: string } {
	return {
		verdict: "FAIL",
		confidence,
		criteria: [...criteria, { passes: false, evidence }],
		summary,
	};
}

function averageConfidence(criteria: EvalCriterionResult[]): EvalConfidence {
	if (criteria.length === 0) return "low";
	const scores = criteria.map((c) => {
		if (c.confidence === "high") return 3;
		if (c.confidence === "medium") return 2;
		return 1; // low or undefined
	});
	const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
	if (avg >= 2.5) return "high";
	if (avg >= 1.5) return "medium";
	return "low";
}

/**
 * Parse structured JSON evaluation output. Default-FAIL on malformed output or
 * weak PASS evidence.
 */
export function parseEvalOutput(text: string, expectedCriteria?: readonly string[] | string): {
	verdict: "PASS" | "FAIL";
	confidence: EvalConfidence;
	criteria: EvalCriterionResult[];
	summary: string;
} {
	const expected = normalizeExpectedCriteria(expectedCriteria);
	for (const candidate of extractJsonObjects(text)) {
		if (!candidate.includes("verdict")) continue;
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>;
			const criteria = normalizeEvalCriteria(parsed.criteria);
			const summary = typeof parsed.summary === "string" ? parsed.summary : "";
			const rawConfidence = parsed.confidence;
			const evalConfidence: EvalConfidence = rawConfidence === "high" || rawConfidence === "medium" || rawConfidence === "low"
				? rawConfidence
				: averageConfidence(criteria);
			if (parsed.verdict !== "PASS") return { verdict: "FAIL", confidence: evalConfidence, criteria, summary };
			if (criteria.length === 0) return failEval(criteria, summary, "Evaluator returned PASS with no criteria evidence.");
			if (expected.length > 0 && criteria.length < expected.length) {
				return failEval(criteria, summary, `Evaluator returned PASS but covered ${criteria.length}/${expected.length} expected criteria.`);
			}
			const weak = criteria.find((criterion) => !criterion.passes || criterion.evidence.length === 0);
			if (weak) return failEval(criteria, summary, "Evaluator returned PASS with failing or missing-evidence criteria.");
			return { verdict: "PASS", confidence: evalConfidence, criteria, summary };
		} catch {
			// Try the next balanced object.
		}
	}
	return {
		verdict: "FAIL",
		confidence: "low",
		criteria: [{ passes: false, evidence: `Evaluator did not return valid harness JSON. Output: ${text.slice(0, 200)}` }],
		summary: text.slice(0, 100),
	};
}
