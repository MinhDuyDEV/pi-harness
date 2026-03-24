/**
 * Safety Rules — Verification Tracking
 *
 * Ported from guardrails.ts. Warns when tasks are marked completed
 * without evidence of running verification commands.
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

/**
 * Stateful verification tracker. Must be shared with the extension
 * so tool_result events can record evidence.
 */
export class VerificationTracker {
	private evidence = new Map<string, string[]>();
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

	hasEvidence(sessionId: string): boolean {
		return (this.evidence.get(sessionId)?.length ?? 0) > 0;
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
				// Only trigger on status=completed
				if (!ctx.command?.includes("status=completed")) return null;
				if (tracker.hasEvidence(ctx.sessionId)) return null;

				return confirm("warn-complete-without-verification", "medium", "unverified-completion",
					"Task marked as completed without evidence of verification. Run tests/build/typecheck/lint first.");
			},
		}),
	];
}
