import { relative, resolve, sep } from "node:path";

export type HarnessAgentRole = "planner" | "generator" | "evaluator";

export interface HarnessPolicy {
	allowDangerousCommands: boolean;
	verificationTimeoutMs: number;
	protectedPathPatterns: string[];
}

export const DEFAULT_HARNESS_POLICY: HarnessPolicy = {
	allowDangerousCommands: false,
	verificationTimeoutMs: 120_000,
	protectedPathPatterns: [
		".env",
		".env.*",
		".git/**",
		"**/.git/**",
		"**/*secret*",
		"**/*credential*",
		"**/*token*",
		"**/id_rsa",
		"**/id_ed25519",
	],
};

const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /(^|\s)rm\s+(-[A-Za-z]*[rf][A-Za-z]*|-[A-Za-z]*[fr][A-Za-z]*)\b/, reason: "recursive/force remove is blocked" },
	{ pattern: /\bgit\s+reset\b/, reason: "git reset is blocked" },
	{ pattern: /\bgit\s+clean\b/, reason: "git clean is blocked" },
	{ pattern: /\bgit\s+checkout\s+(--|\.)/, reason: "destructive git checkout is blocked" },
	{ pattern: /\bgit\s+restore\b/, reason: "git restore is blocked" },
	{ pattern: /\bgit\s+push\b.*\s--force(?:-with-lease)?\b/, reason: "force push is blocked" },
	{ pattern: /\bchmod\s+777\b/, reason: "world-writable chmod is blocked" },
	{ pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}/, reason: "fork bomb pattern is blocked" },
];

function pathMatchesPattern(relativePath: string, pattern: string): boolean {
	const normalized = relativePath.split(sep).join("/");
	if (pattern.endsWith("/**")) {
		const prefix = pattern.slice(0, -3);
		return normalized === prefix || normalized.startsWith(`${prefix}/`);
	}
	if (pattern.startsWith("**/")) {
		const suffix = pattern.slice(3);
		if (suffix.includes("*")) {
			const fragment = suffix.replace(/\*/g, "").toLowerCase();
			return normalized.toLowerCase().includes(fragment);
		}
		return normalized === suffix || normalized.endsWith(`/${suffix}`);
	}
	if (pattern.includes("*")) {
		const regex = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`);
		return regex.test(normalized);
	}
	return normalized === pattern;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isProtectedPath(projectRoot: string, targetPath: string, policy: HarnessPolicy = DEFAULT_HARNESS_POLICY): boolean {
	const root = resolve(projectRoot);
	const target = resolve(targetPath);
	const rel = relative(root, target);
	if (rel.startsWith("..") || rel === "") return rel.startsWith("..");
	return policy.protectedPathPatterns.some((pattern) => pathMatchesPattern(rel, pattern));
}

export function isCommandAllowed(command: string, policy: HarnessPolicy = DEFAULT_HARNESS_POLICY): { allowed: boolean; reason?: string } {
	if (policy.allowDangerousCommands) return { allowed: true };
	for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
		if (pattern.test(command)) return { allowed: false, reason };
	}
	return { allowed: true };
}

export function filterToolsForRole(tools: string[], role: HarnessAgentRole, agentName: string, warnings: string[]): string[] {
	const denied = role === "evaluator" ? new Set(["bash", "edit", "write"]) : role === "planner" ? new Set(["edit", "write"]) : new Set<string>();
	const filtered = tools.filter((tool) => !denied.has(tool));
	const removed = tools.filter((tool) => denied.has(tool));
	if (removed.length > 0) {
		warnings.push(`Agent "${agentName}" requested ${removed.join(", ")}; removed for ${role === "evaluator" ? "read-only evaluator" : "planner"} policy.`);
	}
	return filtered;
}
