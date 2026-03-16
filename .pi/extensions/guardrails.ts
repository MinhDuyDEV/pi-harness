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

const RULES: GuardrailRule[] = [
	// --- BLOCK rules (hard deny, no override) ---
	{
		id: "no-force-push-main",
		description: "Never force push main/master",
		action: "block",
		test: (cmd) => {
			const forceFlag = /git\s+push(?:\s+\S+)*?\s+(-f|--force)(?!-with-lease)/.test(cmd) && /\b(main|master)\b/.test(cmd);
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
			if (!/\brm\s+.*-[a-zA-Z]*r[a-zA-Z]*f/.test(cmd) &&
				!/\brm\s+.*-[a-zA-Z]*f[a-zA-Z]*r/.test(cmd)) {
				return false;
			}
			return /\brm\s+.*\s+\/\s*$/.test(cmd) ||
				/\brm\s+.*\s+\/[^a-zA-Z]/.test(cmd) ||
				/\brm\s+.*\s+~\/?\s*$/.test(cmd) ||
				/\brm\s+.*\$HOME/.test(cmd);
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
			return (
				/\becho\b.*\b(api[_-]?key|secret|password|token|credential)\b/i.test(cmd) &&
				!lower.includes("$") && // Allow variable references (they're redacted)
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
		test: (cmd) => /git\s+restore\s+.*(\.|--\s+\.)/.test(cmd),
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
		test: (cmd) =>
			/git\s+add\s+(\.|--all|-A)(\b|$|\s)/.test(cmd),
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
	// Intercept bash tool calls before execution
	pi.on("before_tool_call", (event: any) => {
		const toolName = event?.name ?? event?.toolName;
		if (toolName !== "bash") return;

		const command = event?.input?.command ?? event?.params?.command ?? "";
		if (!command || typeof command !== "string") return;

		// Normalize: collapse whitespace, trim
		const normalized = command.replace(/\s+/g, " ").trim();

		for (const rule of RULES) {
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

	// Also intercept write/edit to sensitive files
	pi.on("before_tool_call", (event: any) => {
		const toolName = event?.name ?? event?.toolName;
		if (toolName !== "write" && toolName !== "edit") return;

		const path = event?.input?.path ?? event?.params?.path ?? "";
		if (!path || typeof path !== "string") return;

		// Warn on sensitive file writes
		const sensitivePatterns = [
			/\.env($|\.)/,
			/\.ssh\//,
			/\.aws\/credentials/,
			/\.gitconfig/,
			/id_rsa/,
			/\.npmrc/,
		];

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
			const recentBlocks = auditLog
				.filter((e) => e.blocked)
				.slice(-5);
			const recentWarns = auditLog
				.filter((e) => !e.blocked)
				.slice(-5);

			const lines = [
				"## Guardrails Status\n",
				`**Active rules**: ${RULES.length}`,
				`  Block rules: ${RULES.filter((r) => r.action === "block").length}`,
				`  Warn rules: ${RULES.filter((r) => r.action === "warn").length}`,
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
			for (const rule of RULES) {
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
