/**
 * Safety Rules — Network Access Controls
 *
 * Detects outbound network commands and blocks dangerous targets such as
 * localhost, private subnets, cloud metadata endpoints, and unsafe URL schemes.
 */

import { block, confirm, rule, type RuleSet } from "../types.js";

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
	/\bnpm\s+install\b(?!\s)/, // bare `npm install` (no package name = local)
	/\bnpm\s+ci\b/,
	/\bnpm\s+run\b/,
	/\bnpm\s+test\b/,
	/\bnpx\s+tsc\b/,
	/\bnpx\s+vitest\b/,
	/\bnpx\s+jest\b/,
	/\bnpx\s+eslint\b/,
	/\bnpx\s+prettier\b/,
];

const URL_PATTERN = /https?:\/\/[^\s'"`<>]+/gi;
const BLOCKED_SCHEMES = new Set(["file:", "data:", "javascript:"]);
const BLOCKED_HOSTS = new Set([
	"0.0.0.0",
	"127.0.0.1",
	"169.254.169.254",
	"169.254.170.2",
	"100.100.100.200",
	"::1",
	"localhost",
	"metadata.google.internal",
	"metadata.google.internal.",
]);

function isNetworkCommand(cmd: string): boolean {
	return NETWORK_PATTERNS.some((p) => p.test(cmd));
}

function isAllowlisted(cmd: string): boolean {
	return ALLOWLIST.some((p) => p.test(cmd));
}

function parseBlockedHostPatterns(): string[] {
	const raw = process.env.PI_SAFETY_URL_BLOCKLIST ?? "";
	return raw
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

function isPrivateIpv4(hostname: string): boolean {
	const parts = hostname.split(".").map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return false;
	}
	const [a, b] = parts;
	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 169 && b === 254) return true;
	return false;
}

function isPrivateHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	const stripped = normalized.replace(/^\[/, "").replace(/\]$/, "");
	if (!stripped) return false;
	if (BLOCKED_HOSTS.has(stripped)) return true;
	if (stripped.endsWith(".internal") || stripped.endsWith(".local")) return true;
	if (stripped.includes(":")) return stripped === "::1" || stripped.startsWith("fc") || stripped.startsWith("fd");
	return isPrivateIpv4(stripped);
}

function classifyDangerousUrl(urlValue: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(urlValue);
	} catch {
		return null;
	}

	if (BLOCKED_SCHEMES.has(parsed.protocol)) {
		return `unsafe scheme ${parsed.protocol}`;
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return `unsupported scheme ${parsed.protocol}`;
	}

	if (isPrivateHostname(parsed.hostname)) {
		return `private or local host ${parsed.hostname}`;
	}

	const blockedPatterns = parseBlockedHostPatterns();
	const hostname = parsed.hostname.toLowerCase();
	for (const pattern of blockedPatterns) {
		if (hostname === pattern || hostname.endsWith(`.${pattern}`)) {
			return `blocked host ${parsed.hostname}`;
		}
	}

	return null;
}

function extractUrls(ctx: { command?: string; url?: string; urls?: readonly string[] }): string[] {
	const values = new Set<string>();
	if (ctx.url) values.add(ctx.url);
	for (const value of ctx.urls ?? []) {
		if (value) values.add(value);
	}
	for (const match of ctx.command?.match(URL_PATTERN) ?? []) {
		values.add(match);
	}
	return [...values];
}

export const networkRules: RuleSet = [
	rule({
		id: "block-dangerous-network-target",
		description: "Block internal metadata, localhost, and dangerous URL targets",
		severity: "critical",
		threat: "network-exfiltration",
		targets: ["*"],
		check: (ctx) => {
			for (const url of extractUrls(ctx)) {
				const reason = classifyDangerousUrl(url);
				if (!reason) continue;
				return block(
					"block-dangerous-network-target",
					"critical",
					"network-exfiltration",
					`Blocked network target (${reason}).\n\nURL: ${url}`,
				);
			}
			return null;
		},
	}),
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
			return confirm(
				"warn-network-access",
				"medium",
				"network-exfiltration",
				`Outbound network access detected. Verify this is intentional.\n\nCommand: ${cmd.slice(0, 100)}`,
			);
		},
	}),
];
