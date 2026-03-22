/**
 * Guardian Extension — AI-Informed Safety Gate
 *
 * Detects high-risk operations and provides detailed risk analysis
 * via confirmation prompts. Enhances guardrails beyond pattern matching
 * with structured risk assessment.
 *
 * RISK TIERS:
 *   CRITICAL — Blocked outright (irreversible system-level damage)
 *   HIGH     — Confirmation with detailed risk analysis
 *   MEDIUM   — Confirmation with brief warning
 *
 * EXTENSION LOADING ORDER:
 *   sandbox.ts  — filesystem/network policy enforcement
 *   guardrails.ts — behavioral rules (force push, git add ., etc.)
 *   guardian.ts — risk-tiered intent analysis (this file)
 *   All three may match the same command — the first to return wins.
 *   Guardian focuses on *intent-level* risks that regex can't catch well.
 *
 * DEPENDENCIES: None
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RiskTier = "critical" | "high" | "medium";

interface RiskRule {
	id: string;
	tier: RiskTier;
	description: string;
	test: (cmd: string, toolName: string) => boolean;
	/** Generate risk analysis message for this specific command */
	analyze: (cmd: string) => string;
}

interface GuardianDecision {
	timestamp: number;
	ruleId: string;
	tier: RiskTier;
	command: string;
	decision: "blocked" | "prompted";
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RISK_RULES: RiskRule[] = [
	// === CRITICAL (blocked) ===
	{
		id: "pipe-to-shell",
		tier: "critical",
		description: "Download and execute pattern (pipe to interpreter)",
		test: (cmd) => {
			// curl/wget piped to bash/sh/zsh/python/node/ruby/perl
			return /\b(curl|wget)\b.*\|\s*(bash|sh|zsh|python[23]?|node|ruby|perl|php)\b/.test(cmd);
		},
		analyze: (cmd) =>
			`Remote code execution detected. This downloads and executes untrusted code.\n\nPattern: curl/wget | interpreter\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "eval-remote",
		tier: "critical",
		description: "Evaluate remotely-fetched content",
		test: (cmd) => {
			return /\beval\b.*\$\((curl|wget)/.test(cmd) ||
				/\b(bash|sh|zsh)\b.*<\((curl|wget)/.test(cmd);
		},
		analyze: (cmd) =>
			`Remote code evaluation detected. This fetches and evaluates untrusted code.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "sudo-command",
		tier: "critical",
		description: "Privilege escalation via sudo",
		test: (cmd) => /\bsudo\b/.test(cmd),
		analyze: (cmd) =>
			`Privilege escalation detected. Agent should not run commands as root.\n\nCommand: ${cmd.slice(0, 100)}`,
	},

	// === HIGH (confirmation with detailed analysis) ===
	{
		id: "bulk-delete-src",
		tier: "high",
		description: "Recursive delete of source directories",
		test: (cmd) => {
			if (!/\brm\s+.*-[a-zA-Z]*r/.test(cmd)) return false;
			// Deleting common source directories
			return /\b(src|lib|app|pages|components|modules|packages|dist|build)\b/.test(cmd);
		},
		analyze: (cmd) => {
			const dirMatch = cmd.match(
				/\b(src|lib|app|pages|components|modules|packages|dist|build)\b/,
			);
			const dir = dirMatch?.[1] ?? "source";
			return `Recursive delete targeting '${dir}/' directory. This could destroy significant project code.\n\nThis is a high-risk operation that may be difficult to recover from.\nConsider: git stash or backup before proceeding.\n\nCommand: ${cmd.slice(0, 100)}`;
		},
	},
	{
		id: "npm-publish",
		tier: "high",
		description: "Publishing packages to public registry",
		test: (cmd) => /\b(npm|pnpm|yarn)\s+publish\b/.test(cmd),
		analyze: (cmd) =>
			`Package publish detected. This pushes code to a public registry — it cannot be easily unpublished.\n\nVerify: correct version, correct registry, correct package name.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "cargo-publish",
		tier: "high",
		description: "Publishing Rust crate to crates.io",
		test: (cmd) => /\bcargo\s+publish\b/.test(cmd),
		analyze: (cmd) =>
			`Crate publish detected. Once published to crates.io, versions cannot be removed.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "docker-system-prune",
		tier: "high",
		description: "Docker system-wide cleanup",
		test: (cmd) => /\bdocker\s+(system\s+prune|volume\s+prune|container\s+prune)\b/.test(cmd),
		analyze: (cmd) =>
			`Docker prune detected. This removes stopped containers, dangling images, and/or unused volumes.\n\nData in unnamed volumes will be permanently lost.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "database-drop",
		tier: "high",
		description: "Database drop operations",
		test: (cmd) => {
			return /\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i.test(cmd) ||
				/\bpsql\b.*\bdrop\b/i.test(cmd) ||
				/\bmysql\b.*\bdrop\b/i.test(cmd);
		},
		analyze: (cmd) =>
			`Database DROP detected. This permanently destroys data.\n\nEnsure you have a backup before proceeding.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "kill-process",
		tier: "high",
		description: "Process termination commands",
		test: (cmd) => {
			// kill -9, killall, pkill (but allow kill of specific PIDs from test runners)
			return /\bkill\s+-9\b/.test(cmd) ||
				/\bkillall\b/.test(cmd) ||
				/\bpkill\b/.test(cmd);
		},
		analyze: (cmd) =>
			`Force process kill detected. This may terminate critical processes.\n\nkill -9 does not allow graceful shutdown.\n\nCommand: ${cmd.slice(0, 100)}`,
	},

	// === MEDIUM (brief confirmation) ===
	{
		id: "chmod-dangerous",
		tier: "medium",
		description: "Dangerous permission changes",
		test: (cmd) => {
			if (!/\bchmod\b/.test(cmd)) return false;
			// Only flag actually dangerous permissions:
			// - world-writable (xx7, xx6 where x is group)
			// - setuid/setgid (+s)
			// - recursive world-writable (-R ... 777)
			return /\bchmod\s+(-R\s+)?(777|776|767|766|o\+w|a\+w)\b/.test(cmd) ||
				/\bchmod\s+.*\+[xs]\b/.test(cmd);
		},
		analyze: (cmd) =>
			`Dangerous permission change detected. World-writable or setuid/setgid permissions create security risks.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "env-mutation",
		tier: "medium",
		description: "Modifying shell profile files",
		test: (cmd) => {
			return />>?\s*~?\/?\.?(bash_profile|bashrc|zshrc|profile|zprofile|zshenv)\b/.test(cmd);
		},
		analyze: (cmd) =>
			`Shell profile modification detected. This affects all future shell sessions.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "git-rebase-interactive",
		tier: "medium",
		description: "Interactive rebase (history rewrite)",
		test: (cmd) => /\bgit\s+rebase\s+(-i|--interactive)\b/.test(cmd),
		analyze: (cmd) =>
			`Interactive rebase detected. This rewrites git history.\n\nIf this branch has been pushed, others may have based work on the existing history.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "git-branch-delete",
		tier: "medium",
		description: "Branch deletion",
		test: (cmd) => /\bgit\s+(branch|push)\s+.*(-[dD]|--delete)\b/.test(cmd),
		analyze: (cmd) =>
			`Branch deletion detected.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
	{
		id: "stash-drop-clear",
		tier: "medium",
		description: "Stash drop or clear",
		test: (cmd) => /\bgit\s+stash\s+(drop|clear)\b/.test(cmd),
		analyze: (cmd) =>
			`Git stash deletion detected. Dropped stashes cannot be easily recovered.\n\nCommand: ${cmd.slice(0, 100)}`,
	},
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const MAX_DECISIONS = 500;
const decisions: GuardianDecision[] = [];

function recordDecision(d: GuardianDecision): void {
	decisions.push(d);
	if (decisions.length > MAX_DECISIONS) {
		decisions.splice(0, decisions.length - MAX_DECISIONS);
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function guardianExtension(pi: any): void {
	pi.on("before_tool_call", (event: any) => {
		const toolName = event?.name ?? event?.toolName ?? "";
		if (toolName !== "bash") return;

		const command = event?.input?.command ?? event?.params?.command ?? "";
		if (!command || typeof command !== "string") return;

		const normalized = command.replace(/\s+/g, " ").trim();

		for (const rule of RISK_RULES) {
			if (!rule.test(normalized, toolName)) continue;

			const analysis = rule.analyze(normalized);

			if (rule.tier === "critical") {
				recordDecision({
					timestamp: Date.now(),
					ruleId: rule.id,
					tier: rule.tier,
					command: normalized.slice(0, 200),
					decision: "blocked",
				});
				return {
					blocked: true,
					message: `[guardian] BLOCKED (${rule.tier.toUpperCase()}): ${rule.description}\n\n${analysis}\n\nThis operation is not allowed. If you need to do this, ask the user to run it manually.`,
				};
			}

			// HIGH and MEDIUM: confirmation with risk analysis
			recordDecision({
				timestamp: Date.now(),
				ruleId: rule.id,
				tier: rule.tier,
				command: normalized.slice(0, 200),
				decision: "prompted",
			});

			const prefix = rule.tier === "high" ? "HIGH RISK" : "CAUTION";
			return {
				confirm: true,
				message: `[guardian] ${prefix}: ${rule.description}\n\n${analysis}\n\nProceed?`,
			};
		}
	});

	// -----------------------------------------------------------------------
	// /guardian command
	// -----------------------------------------------------------------------

	pi.registerCommand("guardian", {
		description: "Show guardian safety gate status and decision log",
		async handler(_args: any, ctx: any) {
			const blocked = decisions.filter((d) => d.decision === "blocked");
			const prompted = decisions.filter((d) => d.decision === "prompted");

			const lines = [
				"## Guardian Status\n",
				`**Rules active**: ${RISK_RULES.length}`,
				`  Critical: ${RISK_RULES.filter((r) => r.tier === "critical").length}`,
				`  High: ${RISK_RULES.filter((r) => r.tier === "high").length}`,
				`  Medium: ${RISK_RULES.filter((r) => r.tier === "medium").length}`,
				"",
				`**Decisions**: ${decisions.length}`,
				`  Blocked: ${blocked.length}`,
				`  Prompted: ${prompted.length}`,
			];

			if (blocked.length > 0) {
				lines.push("", "### Recent Blocks");
				for (const d of blocked.slice(-5)) {
					const time = new Date(d.timestamp).toLocaleTimeString();
					lines.push(`  ${time} [${d.ruleId}] ${d.command.slice(0, 60)}`);
				}
			}

			if (prompted.length > 0) {
				lines.push("", "### Recent Prompts");
				for (const d of prompted.slice(-5)) {
					const time = new Date(d.timestamp).toLocaleTimeString();
					lines.push(`  ${time} [${d.ruleId}] ${d.command.slice(0, 60)}`);
				}
			}

			lines.push("", "### Rules");
			for (const rule of RISK_RULES) {
				lines.push(`  [${rule.tier.toUpperCase()}] ${rule.id}: ${rule.description}`);
			}

			const output = lines.join("\n").trim();
			if (ctx?.ui) {
				ctx.ui.notify(output, "info");
			}
			return output;
		},
	});
}
