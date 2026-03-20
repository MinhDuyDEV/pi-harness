/**
 * Guardrails Extension — Code-Enforced Safety
 *
 * Intercepts dangerous operations BEFORE execution and blocks or prompts.
 * Upgrades SYSTEM.md behavioral rules to enforced code constraints.
 *
 * Inspired by oh-pi's safe-guard + git-guard pattern and
 * @aliou/pi-guardrails, adapted for pikit's constraint set.
 *
 * RULES ENFORCED:
 *   1. Never force push main/master
 *   2. Never `git reset --hard` without user approval
 *   3. Never `git checkout .` or `git clean -fd` without user approval
 *   4. Never `git add .` (must stage specific files)
 *   5. Never `rm -rf /` or equivalent catastrophic deletes
 *   6. Warn on `.env` file access
 *   7. Block credential exposure patterns
 *   8. Warn on TaskUpdate completion without verification commands
 *
 * WHAT THIS EXTENSION DOES:
 *   - Hooks into before_tool_call to inspect bash commands
 *   - Blocks hard-deny rules immediately with explanation
 *   - Prompts for confirmation on soft-deny rules
 *   - Logs all blocked/warned commands for audit
 *   - Registers /guardrails command for status
 *
 * DEPENDENCIES: None (pure event-based, no SQLite needed)
 */

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

type RuleAction = "block" | "warn";

interface GuardrailRule {
	id: string;
	description: string;
	action: RuleAction;
	/** Test if the command matches this rule */
	test: (cmd: string) => boolean;
	/** Message shown when rule triggers */
	message: string;
}

interface GuardrailInfoRule {
	id: string;
	description: string;
	action: RuleAction;
	message: string;
}

const BASH_RULES: GuardrailRule[] = [
	// --- BLOCK rules (hard deny, no override) ---
	{
		id: "no-force-push-main",
		description: "Never force push main/master",
		action: "block",
		test: (cmd) => {
			const forceFlag =
				/git\s+push(?:\s+\S+)*?\s+(-f|--force)(?!-with-lease)/.test(cmd) &&
				/\b(main|master)\b/.test(cmd);
			const forceRefspec = /git\s+push\s+.*\+(main|master)\b/.test(cmd);
			return forceFlag || forceRefspec;
		},
		message:
			"BLOCKED: Force push to main/master is forbidden. Use --force-with-lease on feature branches instead.",
	},
	{
		id: "no-push-mirror",
		description: "Block git push --mirror (rewrites all remote refs)",
		action: "block",
		test: (cmd) => /git\s+push\s+.*--mirror/.test(cmd),
		message:
			"BLOCKED: `git push --mirror` can overwrite all remote branches and tags, including main/master.",
	},
	{
		id: "no-catastrophic-rm",
		description: "Block rm -rf on root or home directories",
		action: "block",
		test: (cmd) => {
			// Match rm -rf / or rm -rf ~ or rm -rf $HOME
			if (
				!/\brm\s+.*-[a-zA-Z]*r[a-zA-Z]*f/.test(cmd) &&
				!/\brm\s+.*-[a-zA-Z]*f[a-zA-Z]*r/.test(cmd)
			) {
				return false;
			}
			return (
				/\brm\s+.*\s+\/\s*$/.test(cmd) ||
				/\brm\s+.*\s+\/[^a-zA-Z]/.test(cmd) ||
				/\brm\s+.*\s+~\/?\s*$/.test(cmd) ||
				/\brm\s+.*\$HOME/.test(cmd)
			);
		},
		message:
			"BLOCKED: Catastrophic delete detected. This would destroy critical system or user files.",
	},
	{
		id: "no-credential-echo",
		description: "Block echoing credentials to stdout/files",
		action: "block",
		test: (cmd) => {
			const lower = cmd.toLowerCase();
			const hasCredentialLikeName =
				/(^|[^a-z0-9])(api[_-]?key|secret|password|token|credential)([^a-z0-9]|$)/i.test(
					cmd,
				);
			const hasCredentialVariablePattern =
				/\$(?:\{)?[a-z0-9_]*(api[_-]?key|secret|password|token|credential)[a-z0-9_]*(?:\})?/i.test(
					cmd,
				);
			// Do not exempt `$...` variables: `echo $API_KEY` expands to the real secret.
			return (
				/\becho\b/i.test(cmd) &&
				(hasCredentialLikeName || hasCredentialVariablePattern) &&
				!lower.includes("example") &&
				!lower.includes("placeholder")
			);
		},
		message:
			"BLOCKED: Potential credential exposure. Never echo secrets to stdout or files.",
	},

	// --- WARN rules (soft deny, user can override) ---
	{
		id: "warn-git-reset-hard",
		description: "Warn on git reset --hard",
		action: "warn",
		test: (cmd) => /git\s+reset\s+--hard/.test(cmd),
		message:
			"WARNING: `git reset --hard` discards all uncommitted changes. This is destructive and irreversible.",
	},
	{
		id: "warn-git-checkout-dot",
		description: "Warn on git checkout . (discard all changes)",
		action: "warn",
		test: (cmd) => /git\s+checkout\s+(\.|-- \.)/.test(cmd),
		message:
			"WARNING: `git checkout .` discards all uncommitted changes in tracked files.",
	},
	{
		id: "warn-git-restore-dot",
		description: "Warn on git restore . (discard all changes)",
		action: "warn",
		test: (cmd) => /git\s+restore\s+(\.(\s|$)|.*--\s+\.(\s|$))/.test(cmd),
		message:
			"WARNING: `git restore .` discards uncommitted changes in tracked files.",
	},
	{
		id: "warn-git-clean",
		description: "Warn on git clean -fd (remove untracked files)",
		action: "warn",
		test: (cmd) => /git\s+clean\s+.*-[a-zA-Z]*f/.test(cmd),
		message:
			"WARNING: `git clean -f` permanently removes untracked files. They cannot be recovered.",
	},
	{
		id: "warn-git-add-all",
		description: "Warn on git add . (stage everything)",
		action: "warn",
		test: (cmd) => /git\s+add\s+(\.|--all|-A)(\b|$|\s)/.test(cmd),
		message:
			"WARNING: `git add .` stages everything including unintended files. Stage specific files instead.",
	},
	{
		id: "warn-env-write",
		description: "Warn on writing to .env files",
		action: "warn",
		test: (cmd) => {
			// Detect writing to .env files (cat > .env, echo >> .env, etc.)
			return /[>|]\s*\.env/.test(cmd) || /\btee\b.*\.env/.test(cmd);
		},
		message:
			"WARNING: Writing to .env files may expose or overwrite credentials.",
	},
	{
		id: "warn-bypass-hooks",
		description: "Warn on --no-verify flag",
		action: "warn",
		test: (cmd) => /git\s+.*--no-verify/.test(cmd),
		message:
			"WARNING: `--no-verify` bypasses git hooks. This may skip important checks.",
	},
];

const TASK_COMPLETION_VERIFICATION_RULE: GuardrailInfoRule = {
	id: "warn-complete-without-verification",
	description: "Warn when TaskUpdate marks completed before any verification command",
	action: "warn",
	message:
		"WARNING: Task marked as completed without evidence of verification in this session. Run tests/build/typecheck/lint before completing.",
};

const ALL_RULES: GuardrailInfoRule[] = [
	...BASH_RULES.map(({ id, description, action, message }) => ({
		id,
		description,
		action,
		message,
	})),
	TASK_COMPLETION_VERIFICATION_RULE,
];

const VERIFICATION_COMMAND_PATTERNS: RegExp[] = [
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

const MAX_VERIFICATION_COMMANDS_TRACKED = 10;
const MAX_VERIFICATION_SESSIONS_TRACKED = 50;
const verificationCommandsBySession = new Map<string, string[]>();

function isVerificationCommand(command: string): boolean {
	return VERIFICATION_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function recordVerificationCommand(sessionId: string, command: string): void {
	const isNewSession = !verificationCommandsBySession.has(sessionId);
	const existing = verificationCommandsBySession.get(sessionId) ?? [];
	existing.push(command.slice(0, 200));
	if (existing.length > MAX_VERIFICATION_COMMANDS_TRACKED) {
		existing.splice(0, existing.length - MAX_VERIFICATION_COMMANDS_TRACKED);
	}
	verificationCommandsBySession.set(sessionId, existing);

	if (isNewSession && verificationCommandsBySession.size > MAX_VERIFICATION_SESSIONS_TRACKED) {
		const sessionsToPrune = verificationCommandsBySession.size - MAX_VERIFICATION_SESSIONS_TRACKED;
		for (let i = 0; i < sessionsToPrune; i += 1) {
			const oldestSessionId = verificationCommandsBySession.keys().next().value;
			if (oldestSessionId === undefined) break;
			verificationCommandsBySession.delete(oldestSessionId);
		}
	}
}

function hasVerificationEvidence(sessionId: string): boolean {
	return (verificationCommandsBySession.get(sessionId)?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Audit log (in-memory, per-session)
// ---------------------------------------------------------------------------

interface AuditEntry {
	timestamp: number;
	ruleId: string;
	action: RuleAction;
	command: string;
	blocked: boolean;
}

const MAX_AUDIT_ENTRIES = 500;
const auditLog: AuditEntry[] = [];

function appendAudit(entry: AuditEntry): void {
	auditLog.push(entry);
	if (auditLog.length > MAX_AUDIT_ENTRIES) {
		auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function guardrailsExtension(pi: any): void {
	// Track verification commands that actually executed in each session.
	pi.on("tool_result", (event: any) => {
		const toolName = event?.name ?? event?.toolName;
		if (toolName !== "bash") return;

		const command = event?.input?.command ?? event?.params?.command ?? "";
		if (!command || typeof command !== "string") return;

		const normalized = command.replace(/\s+/g, " ").trim();
		if (!isVerificationCommand(normalized)) return;

		const sessionId = event?.sessionId ?? "default";
		recordVerificationCommand(sessionId, normalized);
	});

	// Intercept bash tool calls before execution
	pi.on("before_tool_call", (event: any) => {
		const toolName = event?.name ?? event?.toolName;
		if (toolName !== "bash") return;

		const command = event?.input?.command ?? event?.params?.command ?? "";
		if (!command || typeof command !== "string") return;

		// Normalize: collapse whitespace, trim
		const normalized = command.replace(/\s+/g, " ").trim();

		for (const rule of BASH_RULES) {
			if (!rule.test(normalized)) continue;

			appendAudit({
				timestamp: Date.now(),
				ruleId: rule.id,
				action: rule.action,
				command: normalized.slice(0, 200),
				blocked: rule.action === "block",
			});

			if (rule.action === "block") {
				// Hard block — prevent execution entirely
				return {
					blocked: true,
					message: `[guardrails] ${rule.message}\n\nRule: ${rule.id}\nCommand: ${normalized.slice(0, 100)}`,
				};
			}

			if (rule.action === "warn") {
				// Soft block — return warning, let pi's confirmation flow handle it
				return {
					confirm: true,
					message: `[guardrails] ${rule.message}\n\nCommand: ${normalized.slice(0, 100)}\n\nProceed anyway?`,
				};
			}
		}
	});

	// Warn when tasks are marked completed without verification evidence.
	pi.on("before_tool_call", (event: any) => {
		const toolName = event?.name ?? event?.toolName;
		if (typeof toolName !== "string") return;
		const normalizedToolName = toolName.trim().toLowerCase();
		if (normalizedToolName !== "taskupdate" && normalizedToolName !== "task_update") return;

		const statusRaw = event?.input?.status ?? event?.params?.status;
		const status = typeof statusRaw === "string" ? statusRaw.trim().toLowerCase() : "";
		if (status !== "completed") return;

		const sessionId = event?.sessionId ?? "default";
		if (hasVerificationEvidence(sessionId)) return;

		const taskId = event?.input?.taskId ?? event?.params?.taskId ?? "unknown";

		appendAudit({
			timestamp: Date.now(),
			ruleId: TASK_COMPLETION_VERIFICATION_RULE.id,
			action: TASK_COMPLETION_VERIFICATION_RULE.action,
			command: `TaskUpdate taskId=${taskId} status=completed`,
			blocked: false,
		});

		return {
			confirm: true,
			message:
				`[guardrails] ${TASK_COMPLETION_VERIFICATION_RULE.message}\n\nTask: ${taskId}\n` +
				"Hint: run at least one verification command first (e.g., npm test, npm run build, cargo test, pytest).\n\nProceed anyway?",
		};
	});

	// Also intercept write/edit to sensitive files
	pi.on("before_tool_call", (event: any) => {
		const toolName = event?.name ?? event?.toolName;
		if (toolName !== "write" && toolName !== "edit") return;

		const path = event?.input?.path ?? event?.params?.path ?? "";
		if (!path || typeof path !== "string") return;

		// Warn on sensitive file writes
		const sensitivePatterns = [/\.env($|\.)/, /\.ssh\//, /\.aws\/credentials/, /\.gitconfig/, /id_rsa/, /\.npmrc/];

		for (const pattern of sensitivePatterns) {
			if (pattern.test(path)) {
				appendAudit({
					timestamp: Date.now(),
					ruleId: "warn-sensitive-file",
					action: "warn",
					command: `${toolName} ${path}`,
					blocked: false,
				});

				return {
					confirm: true,
					message: `[guardrails] WARNING: Writing to sensitive file: ${path}\n\nThis file may contain credentials or security configuration. Proceed?`,
				};
			}
		}
	});

	// /guardrails command for status
	pi.registerCommand("guardrails", {
		description: "Show guardrails status and audit log",
		async handler(_args: any, ctx: any) {
			const sessionId = ctx?.sessionId ?? "default";
			const sessionVerificationCommands = verificationCommandsBySession.get(sessionId) ?? [];
			const recentBlocks = auditLog.filter((e) => e.blocked).slice(-5);
			const recentWarns = auditLog.filter((e) => !e.blocked).slice(-5);

			const lines = [
				"## Guardrails Status\n",
				`**Active rules**: ${ALL_RULES.length}`,
				`  Block rules: ${ALL_RULES.filter((r) => r.action === "block").length}`,
				`  Warn rules: ${ALL_RULES.filter((r) => r.action === "warn").length}`,
				"",
				`**Session verification commands**: ${sessionVerificationCommands.length}`,
				sessionVerificationCommands.length > 0
					? `  Last: ${sessionVerificationCommands[sessionVerificationCommands.length - 1]}`
					: "  Last: (none)",
				"",
				`**Audit log**: ${auditLog.length} events`,
				`  Blocked: ${auditLog.filter((e) => e.blocked).length}`,
				`  Warned: ${auditLog.filter((e) => !e.blocked).length}`,
			];

			if (recentBlocks.length > 0) {
				lines.push("", "### Recent Blocks");
				for (const entry of recentBlocks) {
					const time = new Date(entry.timestamp).toLocaleTimeString();
					lines.push(`  ${time} [${entry.ruleId}] ${entry.command.slice(0, 60)}`);
				}
			}

			if (recentWarns.length > 0) {
				lines.push("", "### Recent Warnings");
				for (const entry of recentWarns) {
					const time = new Date(entry.timestamp).toLocaleTimeString();
					lines.push(`  ${time} [${entry.ruleId}] ${entry.command.slice(0, 60)}`);
				}
			}

			lines.push("", "### Rules");
			for (const rule of ALL_RULES) {
				lines.push(`  [${rule.action.toUpperCase()}] ${rule.id}: ${rule.description}`);
			}

			const output = lines.join("\n");
			if (ctx?.ui) {
				ctx.ui.notify(output);
			}
			return output;
		},
	});
}
