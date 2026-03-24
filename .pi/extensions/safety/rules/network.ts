/**
 * Safety Rules — Network Access Controls
 *
 * Ported from sandbox.ts. Detects outbound network commands
 * (curl, wget, ssh, scp, nc, etc.) and requires confirmation.
 */

import { confirm, rule, type RuleSet } from "../types.js";

const NETWORK_PATTERNS: RegExp[] = [
	/\bcurl\b/,
	/\bwget\b/,
	/\bssh\b/,
	/\bscp\b/,
	/\bsftp\b/,
	/\bnc\b/,
	/\bncat\b/,
	/\bnetcat\b/,
	/\btelnet\b/,
	/\bftp\b/,
	/\brsync\b.*:/,
	/\bnpx\s/,
	/\bnpm\s+install\b/,
	/\bpip\s+install\b/,
	/\bcargo\s+install\b/,
	/\bgo\s+install\b/,
	/\bgem\s+install\b/,
];

/** Commands that are always allowed (local-only or safe). */
const ALLOWLIST: RegExp[] = [
	/\bcurl\s+.*\blocalhost\b/,
	/\bcurl\s+.*\b127\.0\.0\.1\b/,
	/\bcurl\s+.*\b\[::1\]\b/,
	/\bssh\s+.*\blocalhost\b/,
	/\bnpm\s+install\b(?!\s)/, // bare `npm install` (no package name = local)
	/\bnpm\s+ci\b/,
	/\bnpm\s+run\b/,
	/\bnpm\s+test\b/,
	/\bnpx\s+tilth\b/,
	/\bnpx\s+tsc\b/,
	/\bnpx\s+vitest\b/,
	/\bnpx\s+jest\b/,
	/\bnpx\s+eslint\b/,
	/\bnpx\s+prettier\b/,
];

function isNetworkCommand(cmd: string): boolean {
	return NETWORK_PATTERNS.some((p) => p.test(cmd));
}

function isAllowlisted(cmd: string): boolean {
	return ALLOWLIST.some((p) => p.test(cmd));
}

export const networkRules: RuleSet = [
	rule({
		id: "warn-network-access",
		description: "Confirm outbound network access",
		severity: "medium",
		threat: "network-exfiltration",
		targets: ["bash"],
		check: (ctx) => {
			const cmd = ctx.command!;
			if (!isNetworkCommand(cmd)) return null;
			if (isAllowlisted(cmd)) return null;
			return confirm("warn-network-access", "medium", "network-exfiltration",
				`Outbound network access detected. Verify this is intentional.\n\nCommand: ${cmd.slice(0, 100)}`);
		},
	}),
];
