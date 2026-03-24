/**
 * Safety Rules — Credential & Sensitive File Protection
 *
 * Ported from guardrails.ts. 2 rules: credential echo block,
 * sensitive file write warning.
 */

import { block, confirm, rule, type RuleSet } from "../types.js";

export const credentialRules: RuleSet = [
	rule({
		id: "no-credential-echo",
		description: "Block echoing credentials to stdout/files",
		severity: "critical",
		threat: "credential-exposure",
		targets: ["bash"],
		check: (ctx) => {
			const cmd = ctx.command!;
			const lower = cmd.toLowerCase();
			if (!/\becho\b/i.test(cmd)) return null;
			if (lower.includes("example") || lower.includes("placeholder")) return null;

			const hasCredentialName =
				/(^|[^a-z0-9])(api[_-]?key|secret|password|token|credential)([^a-z0-9]|$)/i.test(cmd);
			const hasCredentialVar =
				/\$(?:\{)?[a-z0-9_]*(api[_-]?key|secret|password|token|credential)[a-z0-9_]*(?:\})?/i.test(cmd);

			return hasCredentialName || hasCredentialVar
				? block("no-credential-echo", "critical", "credential-exposure",
					"Potential credential exposure. Never echo secrets to stdout or files.")
				: null;
		},
	}),
	rule({
		id: "warn-sensitive-file",
		description: "Warn on writing to sensitive files",
		severity: "medium",
		threat: "credential-exposure",
		targets: ["write", "edit"],
		check: (ctx) => {
			const path = ctx.path ?? "";
			const patterns = [/\.env($|\.)/, /\.ssh\//, /\.aws\/credentials/, /\.gitconfig/, /id_rsa/, /\.npmrc/];
			return patterns.some((p) => p.test(path))
				? confirm("warn-sensitive-file", "medium", "credential-exposure",
					`Writing to sensitive file: ${path}. This file may contain credentials or security configuration.`)
				: null;
		},
	}),
	rule({
		id: "warn-env-write-bash",
		description: "Warn on writing to .env files via bash",
		severity: "medium",
		threat: "credential-exposure",
		targets: ["bash"],
		check: (ctx) => {
			const cmd = ctx.command!;
			return /[>|]\s*\.env/.test(cmd) || /\btee\b.*\.env/.test(cmd)
				? confirm("warn-env-write-bash", "medium", "credential-exposure",
					"Writing to .env files may expose or overwrite credentials.")
				: null;
		},
	}),
];
