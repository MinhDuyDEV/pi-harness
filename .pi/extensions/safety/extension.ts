/**
 * Safety Extension — Unified Entry Point
 *
 * Replaces guardrails.ts + guardian.ts + sandbox.ts with a single
 * composable safety module. One tool_call hook, one audit log,
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
import type { RuleSet, Verdict } from "./types.js";
import { defaultRules } from "./rules/presets.js";

type BlockResult = { block: true; reason: string };

type TextPart = { type: string; text?: unknown };

type ExtensionContext = {
	ui?: {
		confirm?: (title: string, message: string) => boolean | Promise<boolean>;
		notify?: (message: string, level: "info") => void;
	};
};

type SafetyCommandContext = {
	ui?: {
		notify?: (message: string, level: "info") => void;
	};
};

type ExtensionAPI = {
	on(event: "tool_call" | "tool_result", handler: (event: unknown, ctx?: ExtensionContext) => unknown): void;
	registerCommand(name: string, options: {
		description: string;
		handler: (args: unknown, ctx: SafetyCommandContext) => Promise<string>;
	}): void;
};

function readTextContent(value: unknown): string {
	if (!Array.isArray(value)) return "";
	return value
		.filter((part: unknown): part is TextPart =>
			Boolean(part) && typeof part === "object" && (part as TextPart).type === "text" && typeof (part as TextPart).text === "string")
		.map((part) => String(part.text))
		.join("\n");
}

function makeBlockResult(message: string): BlockResult {
	return { block: true, reason: message };
}

function formatVerdict(verdict: Verdict): string {
	const prefix = verdict.kind === "block" ? "[safety] BLOCKED" : "[safety]";
	return `${prefix} (${verdict.severity.toUpperCase()}): ${verdict.message}\n\nRule: ${verdict.ruleId}\nThreat: ${verdict.threat}`;
}

function confirmVerdict(
	message: string,
	ctx?: ExtensionContext,
): BlockResult | undefined | Promise<BlockResult | undefined> {
	const confirm = ctx?.ui?.confirm;
	if (typeof confirm !== "function") {
		return makeBlockResult(`${message}\n\nNo confirmation UI available; blocked by default.`);
	}
	return Promise.resolve(confirm("Safety confirmation", message)).then((ok) => ok ? undefined : makeBlockResult(message));
}

export default function safetyExtension(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const audit = new AuditLog();

	// 1. Build the ruleset
	const { rules: baseRules, tracker } = defaultRules();

	// 2. Apply disabled rules from env (comma-separated)
	let rules: RuleSet = baseRules;
	const disabledEnv = process.env.PI_SAFETY_DISABLED_RULES;
	const disabledRuleIds = disabledEnv?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
	if (disabledRuleIds.length > 0) {
		rules = exclude(rules, ...disabledRuleIds);
	}

	// 3. Track verification commands from tool_result events
	pi.on("tool_result", (event: unknown) => {
		const e = event && typeof event === "object" ? event as Record<string, unknown> : {};
		const toolName = e.name ?? e.toolName;
		if (toolName !== "bash") return;

		const input = e.input && typeof e.input === "object" ? e.input as Record<string, unknown> : {};
		const params = e.params && typeof e.params === "object" ? e.params as Record<string, unknown> : {};
		const command = String(input.command ?? params.command ?? "").trim();
		if (!command) return;

		const normalized = command.replace(/\s+/g, " ").trim();
		if (!tracker.isVerificationCommand(normalized)) return;

		const sessionId = String(e.sessionId ?? "default");
		tracker.recordEvidence(sessionId, normalized);

		const contentText = readTextContent(e.content);
		const legacyResult = e.result;
		const legacy = legacyResult && typeof legacyResult === "object" ? legacyResult as Record<string, unknown> : {};
		const legacyText =
			typeof legacyResult === "string"
				? legacyResult
				: readTextContent(legacy.content) ||
					(typeof legacy.content === "string" ? legacy.content : String(e.output ?? ""));
		const output = contentText || legacyText;
		const details = e.details && typeof e.details === "object" ? e.details as Record<string, unknown> : {};
		const exitCode =
			typeof details.exitCode === "number"
				? details.exitCode
				: typeof details.exit_code === "number"
					? details.exit_code
					: typeof e.exitCode === "number"
						? e.exitCode
						: typeof e.exit_code === "number"
							? e.exit_code
							: undefined;
		tracker.recordResult(sessionId, normalized, output, exitCode);
	});

	// 4. Single tool_call hook — replaces 3 separate hooks
	pi.on("tool_call", (event: unknown, hookCtx?: ExtensionContext) => {
		const ctx = contextFromEvent(event, cwd);
		if (!ctx) return;

		const { verdict, fired } = evaluate(rules, ctx, "highest-severity");

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

		const message = formatVerdict(verdict);
		if (verdict.kind === "block") return makeBlockResult(message);
		if (verdict.kind === "confirm") return confirmVerdict(`${message}\n\nProceed?`, hookCtx);
	});

	// 5. Unified /safety command
	pi.registerCommand("safety", {
		description: "Show active safety rules, audit log, and posture",
		async handler(_args: unknown, ctx: SafetyCommandContext) {
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

			if (disabledRuleIds.length > 0) {
				lines.push(
					"",
					"### Disabled Rules",
					...disabledRuleIds.map((id) => `  ${id}`),
				);
			}

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
			ctx.ui?.notify?.(output, "info");
			return output;
		},
	});
}
