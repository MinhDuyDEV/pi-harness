/**
 * Safety Extension — Unified Entry Point
 *
 * Replaces guardrails.ts + guardian.ts + sandbox.ts with a single
 * composable safety module. One tool_call hook, one audit log,
 * one /safety command.
 *
 * RULES: 30 rules across 9 categories:
 *   git (8), destructive (7), credentials (5), publish (3), workspace (3),
 *   injection (1), network (1), system (1), verification (1)
 *
 * These counts are asserted by `safety.test.ts` — the header used to claim
 * "26 rules across 7 categories" with every per-category number wrong, because
 * nothing checked it.
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

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { AuditLog, type AuditEntry } from "./audit.js";
import { describe, exclude } from "./compose.js";
import { contextFromEvent } from "./context.js";
import { evaluate } from "./evaluate.js";
import type { RuleSet, Verdict } from "./types.js";
import { defaultRules } from "./rules/presets.js";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readExtensionGate, type HarnessSettings } from "../lib/harness-settings.js";

/**
 * Durable audit trail. The in-memory ring holds 500 entries and dies with the
 * process — meaning the sessions someone actually needs to reconstruct (the
 * ones that crashed, or that a user reports days later) were exactly the ones
 * with no audit left. Failures are counted, never thrown: auditing must not
 * take down the tool call it is auditing.
 */
class JsonlAuditSink {
	private ready = false;
	failures = 0;

	constructor(private readonly path: string) {}

	append(entry: AuditEntry): void {
		try {
			if (!this.ready) {
				mkdirSync(dirname(this.path), { recursive: true });
				this.ready = true;
			}
			appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
		} catch {
			this.failures += 1;
		}
	}
}

type BlockResult = { block: true; reason: string };

type TextPart = { type: string; text?: unknown };

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
	blockerId: string,
	pi: ExtensionAPI,
	ctx?: ExtensionContext,
): BlockResult | undefined | Promise<BlockResult | undefined> {
	const confirm = ctx?.ui?.confirm;
	if (typeof confirm !== "function") {
		return makeBlockResult(`${message}\n\nNo confirmation UI available; blocked by default.`);
	}
	try { pi.events.emit("herdr:blocked", { active: true, blockerId, label: "Safety confirmation" }); } catch {}
	return Promise.resolve(confirm("Safety confirmation", message))
		.then((ok) => ok ? undefined : makeBlockResult(message))
		.finally(() => {
			try { pi.events.emit("herdr:blocked", { active: false, blockerId, label: "Safety confirmation" }); } catch {}
		});
}

export default function safetyExtension(
	pi: ExtensionAPI,
	settingsSource?: string | HarnessSettings,
): void {
	if (!readExtensionGate(settingsSource, "safety", true)) return;
	const cwd = process.cwd();
	const audit = new AuditLog();
	// PI_SAFETY_AUDIT_DIR relocates the durable audit (tests point it at a temp
	// dir); it cannot disable it.
	const auditDirectory = process.env.PI_SAFETY_AUDIT_DIR || join(cwd, ".pi", "artifacts");
	const auditSink = new JsonlAuditSink(join(auditDirectory, "safety-audit.jsonl"));

	// 1. Build the ruleset
	const { rules: baseRules, tracker } = defaultRules();

	// 2. Apply disabled rules from env (comma-separated) — with a severity
	// floor. `exclude` filtered by id alone, so the same undocumented env that
	// reasonably mutes a medium nuisance rule could also switch off
	// force-push protection or credential blocking. Critical rules are the
	// reason this extension exists; they do not come off via an env var.
	let rules: RuleSet = baseRules;
	const disabledEnv = process.env.PI_SAFETY_DISABLED_RULES;
	const requestedDisabledIds = disabledEnv?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
	const criticalIds = new Set(
		baseRules.filter((r) => r.severity === "critical").map((r) => r.id),
	);
	const refusedDisabledIds = requestedDisabledIds.filter((id) => criticalIds.has(id));
	const disabledRuleIds = requestedDisabledIds.filter((id) => !criticalIds.has(id));
	if (disabledRuleIds.length > 0) {
		rules = exclude(rules, ...disabledRuleIds);
	}
	if (refusedDisabledIds.length > 0) {
		// Refusing silently would look exactly like the rule being disabled.
		pi.on("session_start", (_event, ctx) => {
			ctx.ui?.notify?.(
				`[safety] PI_SAFETY_DISABLED_RULES cannot disable critical rules; ` +
					`still active: ${refusedDisabledIds.join(", ")}`,
				"warning",
			);
		});
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
		let verdict: Verdict | null;
		let firedVerdicts: ReadonlyArray<Verdict>;
		let toolContext: ReturnType<typeof contextFromEvent>;
		try {
			toolContext = contextFromEvent(event, cwd);
			if (!toolContext) return;
			({ verdict, fired: firedVerdicts } = evaluate(rules, toolContext, "highest-severity"));
		} catch (error) {
			// The policy check itself failed. What Pi does with a throwing hook
			// is not ours to assume, so do not let it throw: an unevaluated call
			// is not an approved call.
			return makeBlockResult(
				`[safety] BLOCKED: the policy check failed and cannot approve this call: ` +
					`${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// Audit all fired rules — in memory for /safety, on disk for forensics,
		// and on the bus for anything correlating safety with other signals.
		for (const v of firedVerdicts) {
			const entry = {
				timestamp: Date.now(),
				ruleId: v.ruleId,
				severity: v.severity,
				threat: v.threat,
				kind: v.kind,
				tool: toolContext.tool,
				detail: (toolContext.command ?? toolContext.path ?? "").slice(0, 200),
				sessionId: toolContext.sessionId,
			};
			audit.append(entry);
			auditSink.append(entry);
			try {
				pi.events?.emit?.("pi-harness:safety:verdict:v1", { version: 1, ...entry });
			} catch {
				// A bus listener must never be able to break the policy hook.
			}
		}

		if (!verdict) return;

		const message = formatVerdict(verdict);
		if (verdict.kind === "block") return makeBlockResult(message);
		if (verdict.kind === "confirm") return confirmVerdict(`${message}\n\nProceed?`, `safety:${verdict.ruleId}`, pi, hookCtx);
	});

	// 5. Unified /safety command
	pi.registerCommand("safety", {
		description: "Show active safety rules, audit log, and posture",
		async handler(_args: unknown, ctx: ExtensionCommandContext) {
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

			if (refusedDisabledIds.length > 0) {
				lines.push(
					"",
					"### Disable Requests REFUSED (critical severity)",
					...refusedDisabledIds.map((id) => `  ${id}`),
				);
			}

			if (auditSink.failures > 0) {
				lines.push("", `**Audit persistence failures**: ${auditSink.failures}`);
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
		},
	});
}
