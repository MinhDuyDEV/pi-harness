/**
 * Safety Rules — Verification Tracking
 *
 * Ported from guardrails.ts. Warns when tasks are marked completed
 * without evidence of running verification commands.
 * Extended: parses verification command output for structured metrics.
 */

import { confirm, rule, type RuleSet } from "../types.js";

const VERIFICATION_PATTERNS: RegExp[] = [
	/\b(npm|pnpm|yarn|bun)\s+test\b/i,
	/\b(npm|pnpm|yarn|bun)\s+run\s+[^\s]*(test|build|lint|typecheck|check)[^\s]*/i,
	/\bcargo\s+(test|check|clippy|build)\b/i,
	/\bpytest\b/i,
	/\bgo\s+(test|vet)\b/i,
	/\b(mypy|pyright)\b/i,
	/\bruff\s+check\b/i,
	/\btsc\b/i,
	/\b(vitest|jest)\b/i,
];

/** Structured result from parsing verification command output. */
export interface VerificationResult {
	type: "test" | "build" | "lint" | "typecheck";
	passed: boolean;
	command: string;
	/** Number of passing tests (test type only) */
	passCount?: number;
	/** Number of failing tests (test type only) */
	failCount?: number;
	/** Number of skipped tests (test type only) */
	skipCount?: number;
	/** Number of errors (lint/typecheck) */
	errorCount?: number;
	/** Number of warnings (lint/typecheck) */
	warningCount?: number;
	/** Exit code if available */
	exitCode?: number;
	timestamp: number;
}

/** Patterns to extract test counts from common runners. */
const TEST_RESULT_PATTERNS: Array<{ pattern: RegExp; extract: (m: RegExpMatchArray, fullText?: string) => Partial<VerificationResult> }> = [
	// Jest/Vitest: "Tests: 2 failed, 14 passed, 16 total" or "Tests:  14 passed, 14 total"
	{
		pattern: /Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(\d+)\s+passed,\s+(\d+)\s+total/i,
		extract: (m) => ({ passCount: +m[3], failCount: m[1] ? +m[1] : 0, skipCount: m[2] ? +m[2] : 0, passed: !m[1] || m[1] === "0" }),
	},
	// cargo test: "test result: ok. 10 passed; 0 failed; 0 ignored" (before generic fallback — uses semicolons)
	{
		pattern: /test result:\s*(ok|FAILED)\.\s*(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/i,
		extract: (m) => ({ passCount: +m[2], failCount: +m[3], skipCount: +m[4], passed: m[1].toLowerCase() === "ok" }),
	},
	// Jest/Vitest: "X passed" / "X failed" on separate lines (fallback)
	{
		pattern: /(\d+)\s+passed.*?(\d+)\s+failed/is,
		extract: (m) => ({ passCount: +m[1], failCount: +m[2], passed: m[2] === "0" }),
	},
	// pytest: "5 passed, 2 failed" or "5 passed"
	{
		pattern: /(\d+)\s+passed(?:,\s+(\d+)\s+failed)?/i,
		extract: (m) => ({ passCount: +m[1], failCount: m[2] ? +m[2] : 0, passed: !m[2] || m[2] === "0" }),
	},
	// go test: "ok" or "FAIL" with optional package path
	{
		pattern: /^(ok|FAIL)\s+\S+/m,
		extract: (m) => ({ passed: m[1] === "ok" }),
	},
];

/** Patterns to extract lint/typecheck error counts. */
const LINT_RESULT_PATTERNS: Array<{ pattern: RegExp; extract: (m: RegExpMatchArray, fullText?: string) => Partial<VerificationResult> }> = [
	// ESLint: "X problems (Y errors, Z warnings)"
	{
		pattern: /(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/i,
		extract: (m) => ({ errorCount: +m[2], warningCount: +m[3], passed: m[2] === "0" }),
	},
	// tsc: "Found X errors"
	{
		pattern: /Found\s+(\d+)\s+errors?/i,
		extract: (m) => ({ errorCount: +m[1], passed: m[1] === "0" }),
	},
	// tsc: "error TS" count
	{
		pattern: /error TS\d+/g,
		extract: (_m, fullText?: string) => {
			const count = (fullText ?? "").match(/error TS\d+/g)?.length ?? 0;
			return { errorCount: count, passed: count === 0 };
		},
	},
	// ruff: "Found X errors" or "All checks passed"
	{
		pattern: /Found\s+(\d+)\s+errors?|All checks passed/i,
		extract: (m) => {
			if (m[0].includes("All checks passed")) return { errorCount: 0, passed: true };
			return { errorCount: +m[1], passed: m[1] === "0" };
		},
	},
	// mypy/pyright: "Found X errors in Y files" or "Success" (standalone, not part of another word)
	{
		pattern: /Found\s+(\d+)\s+errors?\s+in\s+\d+\s+files?|^Success$/im,
		extract: (m) => {
			if (m[0] === "Success") return { errorCount: 0, passed: true };
			return { errorCount: +m[1], passed: m[1] === "0" };
		},
	},
	// cargo clippy: "warning:" or "error:" counts
	{
		pattern: /(?:warning|error)\[[\w-]+\]/g,
		extract: (_m, fullText?: string) => {
			const errors = (fullText ?? "").match(/error\[[\w-]+\]/g)?.length ?? 0;
			const warnings = (fullText ?? "").match(/warning\[[\w-]+\]/g)?.length ?? 0;
			return { errorCount: errors, warningCount: warnings, passed: errors === 0 };
		},
	},
];

/** Classify a verification command by type. */
function classifyCommand(command: string): VerificationResult["type"] {
	const cmd = command.toLowerCase();
	if (/\b(test|pytest|vitest|jest)\b/.test(cmd)) return "test";
	if (/\b(lint|eslint|clippy|ruff\s+check)\b/.test(cmd)) return "lint";
	if (/\b(typecheck|tsc|mypy|pyright)\b/.test(cmd)) return "typecheck";
	return "build";
}

/** Parse verification command output into structured result. */
function parseVerificationOutput(command: string, output: string, exitCode?: number): VerificationResult {
	const type = classifyCommand(command);
	const result: VerificationResult = {
		type,
		passed: exitCode === 0,
		command: command.slice(0, 200),
		exitCode,
		timestamp: Date.now(),
	};

	const patterns = type === "test" ? TEST_RESULT_PATTERNS : LINT_RESULT_PATTERNS;

	for (const { pattern, extract } of patterns) {
		const match = output.match(pattern);
		if (match) {
			const extracted = extract(match, output);
			Object.assign(result, extracted);
			break;
		}
	}

	// If no regex matched and no exit code, mark as unknown (not false)
	if (result.passed === undefined) {
		result.passed = false; // conservative default — no evidence of success
	}

	return result;
}

/**
 * Stateful verification tracker. Must be shared with the extension
 * so tool_result events can record evidence.
 */
export class VerificationTracker {
	private evidence = new Map<string, string[]>();
	private results = new Map<string, VerificationResult[]>();
	private readonly maxPerSession = 10;
	private readonly maxSessions = 50;

	isVerificationCommand(command: string): boolean {
		return VERIFICATION_PATTERNS.some((p) => p.test(command));
	}

	recordEvidence(sessionId: string, command: string): void {
		const isNew = !this.evidence.has(sessionId);
		const cmds = this.evidence.get(sessionId) ?? [];
		cmds.push(command.slice(0, 200));
		if (cmds.length > this.maxPerSession) {
			cmds.splice(0, cmds.length - this.maxPerSession);
		}
		this.evidence.set(sessionId, cmds);

		if (isNew && this.evidence.size > this.maxSessions) {
			const oldest = this.evidence.keys().next().value;
			if (oldest !== undefined) this.evidence.delete(oldest);
		}
	}

	/** Record structured verification result from parsed command output. */
	recordResult(sessionId: string, command: string, output: string, exitCode?: number): VerificationResult {
		const result = parseVerificationOutput(command, output, exitCode);
		const results = this.results.get(sessionId) ?? [];
		results.push(result);
		if (results.length > this.maxPerSession) {
			results.splice(0, results.length - this.maxPerSession);
		}
		this.results.set(sessionId, results);

		if (this.results.size > this.maxSessions) {
			const oldest = this.results.keys().next().value;
			if (oldest !== undefined) this.results.delete(oldest);
		}

		return result;
	}

	/** Get the latest verification result for a session. */
	getLatestResult(sessionId: string): VerificationResult | undefined {
		const results = this.results.get(sessionId);
		return results?.[results.length - 1];
	}

	/** Check if the latest verification result is a successful gate. */
	hasPassingResult(sessionId: string): boolean {
		const latest = this.getLatestResult(sessionId);
		return latest?.passed === true;
	}
}

export function verificationRules(tracker: VerificationTracker): RuleSet {
	return [
		rule({
			id: "warn-complete-without-verification",
			description: "Warn when task completed without verification evidence",
			severity: "medium",
			threat: "unverified-completion",
			targets: ["taskupdate"],
			check: (ctx) => {
				if (!ctx.command?.includes("status=completed")) return null;
				if (tracker.hasPassingResult(ctx.sessionId)) return null;

				const latest = tracker.getLatestResult(ctx.sessionId);
				const message = latest
					? `Task marked as completed after failed verification: ${latest.command}. Fix failures before completing.`
					: "Task marked as completed without passing verification evidence. Run tests/build/typecheck/lint first.";
				return confirm("warn-complete-without-verification", "medium", "unverified-completion", message);
			},
		}),
	];
}
