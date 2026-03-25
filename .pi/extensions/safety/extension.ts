/**
 * Safety Extension — Unified Entry Point
 *
 * Replaces guardrails.ts + guardian.ts + sandbox.ts with a single
 * composable safety module. One before_tool_call hook, one audit log,
 * one /safety command.
 *
 * RULES: 26 deduplicated rules across 7 categories:
 *   git (11), credentials (3), destructive (6), publish (4),
 *   system (2), workspace (2), verification (1)
 *
 * CAPABILITIES PRESERVED:
 *   - Block (hard deny) for critical threats
 *   - Confirm (soft deny with prompt) for high/medium threats
 *   - Bash command interception
 *   - File write/edit interception
 *   - Task completion verification tracking
 *   - Protected path enforcement
 *   - Unified audit trail
 *
 * DEPENDENCIES: None (pure event-based, no SQLite needed)
 */

import { AuditLog } from "./audit.js";
import { describe, exclude } from "./compose.js";
import { contextFromEvent } from "./context.js";
import { evaluate } from "./evaluate.js";
import type { RuleSet } from "./types.js";
import { defaultRules } from "./rules/presets.js";

export default function safetyExtension(pi: any): void {
	const cwd = process.cwd();
	const audit = new AuditLog();

	// 1. Build the ruleset
	const { rules: baseRules, tracker } = defaultRules();

	// 2. Apply disabled rules from env (comma-separated)
	let rules: RuleSet = baseRules;
	const disabledEnv = process.env.PI_SAFETY_DISABLED_RULES;
	if (disabledEnv) {
		const ids = disabledEnv.split(",").map((s) => s.trim()).filter(Boolean);
		rules = exclude(rules, ...ids);
	}

	// 3. Track verification commands from tool_result events
	pi.on("tool_result", (event: any) => {
		const toolName = event?.name ?? event?.toolName;
		if (toolName !== "bash") return;

		const command = String(event?.input?.command ?? event?.params?.command ?? "").trim();
		if (!command) return;

		const normalized = command.replace(/\s+/g, " ").trim();
		if (!tracker.isVerificationCommand(normalized)) return;

		const sessionId = event?.sessionId ?? "default";
		tracker.recordEvidence(sessionId, normalized);

		// Parse structured verification output
		const output = String(event?.output ?? event?.result ?? "");
		const exitCode = event?.exitCode ?? event?.exit_code;
		if (output) {
			tracker.recordResult(sessionId, normalized, output, typeof exitCode === "number" ? exitCode : undefined);
		}
	});

	// 4. Single before_tool_call hook — replaces 3 separate hooks
	pi.on("before_tool_call", (event: any) => {
		const ctx = contextFromEvent(event, cwd);
		if (!ctx) return;

		const { verdict, fired } = evaluate(rules, ctx, "first-match");

		// Audit all fired rules
		for (const v of fired) {
			audit.append({
				timestamp: Date.now(),
				ruleId: v.ruleId,
				severity: v.severity,
				threat: v.threat,
				kind: v.kind,
				tool: ctx.tool,
				detail: (ctx.command ?? ctx.path ?? "").slice(0, 200),
				sessionId: ctx.sessionId,
			});
		}

		if (!verdict) return;

		if (verdict.kind === "block") {
			return {
				blocked: true,
				message: `[safety] BLOCKED (${verdict.severity.toUpperCase()}): ${verdict.message}\n\nRule: ${verdict.ruleId}\nThreat: ${verdict.threat}`,
			};
		}

		if (verdict.kind === "confirm") {
			return {
				confirm: true,
				message: `[safety] ${verdict.severity.toUpperCase()}: ${verdict.message}\n\nRule: ${verdict.ruleId}\nThreat: ${verdict.threat}\n\nProceed?`,
			};
		}
	});

	// 5. Unified /safety command
	pi.registerCommand("safety", {
		description: "Show active safety rules, audit log, and posture",
		async handler(_args: any, ctx: any) {
			const allRules = describe(rules);
			const stats = audit.stats();
			const recentBlocks = audit.query({ kind: "block" }).slice(-5);
			const recentConfirms = audit.query({ kind: "confirm" }).slice(-5);

			const lines = [
				"## Safety Status\n",
				`**Active rules**: ${allRules.length}`,
				`  Critical: ${allRules.filter((r) => r.severity === "critical").length}`,
				`  High: ${allRules.filter((r) => r.severity === "high").length}`,
				`  Medium: ${allRules.filter((r) => r.severity === "medium").length}`,
				`  Low: ${allRules.filter((r) => r.severity === "low").length}`,
				"",
				`**Audit log**: ${stats.total} events`,
				`  Blocked: ${stats.blocked}`,
				`  Confirmed: ${stats.confirmed}`,
			];

			if (recentBlocks.length > 0) {
				lines.push("", "### Recent Blocks");
				for (const e of recentBlocks) {
					const time = new Date(e.timestamp).toLocaleTimeString();
					lines.push(`  ${time} [${e.severity}] ${e.ruleId}: ${e.detail.slice(0, 60)}`);
				}
			}

			if (recentConfirms.length > 0) {
				lines.push("", "### Recent Confirmations");
				for (const e of recentConfirms) {
					const time = new Date(e.timestamp).toLocaleTimeString();
					lines.push(`  ${time} [${e.severity}] ${e.ruleId}: ${e.detail.slice(0, 60)}`);
				}
			}

			lines.push("", "### Rules");
			for (const r of allRules) {
				lines.push(`  [${r.severity.toUpperCase()}] ${r.id}: ${r.description} (${r.threat})`);
			}

			const output = lines.join("\n").trim();
			if (ctx?.ui) {
				ctx.ui.notify(output, "info");
			}
			return output;
		},
	});
}
