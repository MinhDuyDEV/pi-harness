/**
 * Sandbox Extension — OS-Level Security Enforcement
 *
 * Enforces filesystem and network restrictions on tool operations.
 * Generates macOS Seatbelt profiles for OS-level sandboxing.
 *
 * TWO LAYERS:
 *   1. Extension-level enforcement (before_tool_call interception)
 *      - Protected path detection for bash/write/edit tools
 *      - Network command detection for bash tool
 *      - Destructive bulk operation detection
 *
 *   2. OS-level sandbox (Seatbelt profile generation)
 *      - Generates .sb profiles for sandbox-exec
 *      - Provides /sandbox launch command
 *      - Can wrap entire pi process or individual commands
 *
 * MODES:
 *   read-only        — No writes from bash. write/edit tools blocked.
 *   workspace-write  — Writes only to cwd + tmpdir. Network denied. (DEFAULT)
 *   full-access      — Extension rules still apply for protected paths.
 *
 * PROTECTED PATHS (always enforced, all modes):
 *   .git/             — Git internals (use git commands instead)
 *   ~/.ssh/           — SSH keys
 *   ~/.gnupg/         — GPG keys
 *   ~/.aws/           — AWS credentials
 *   /etc/             — System config
 *
 * EXTENSION LOADING ORDER:
 *   This extension (sandbox) provides filesystem/network enforcement.
 *   guardrails.ts provides behavioral rules (force push, git add ., etc.).
 *   guardian.ts provides risk-tiered intent analysis.
 *   All three may match the same command — the first to return a response wins.
 *   Ensure rules don't conflict: sandbox blocks on policy, guardrails on git
 *   safety, guardian on destructive intent. Overlap is intentional defense-in-depth.
 *
 * DEPENDENCIES: None (pure event-based)
 */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SandboxMode = "read-only" | "workspace-write" | "full-access";

interface SandboxConfig {
	mode: SandboxMode;
	/** Additional writable paths beyond cwd (workspace-write mode) */
	additionalWritePaths: string[];
	/** Allow network access (overrides deny-by-default in workspace-write) */
	networkAccess: boolean;
	/** Extra protected paths beyond defaults */
	extraProtectedPaths: string[];
}

interface SandboxViolation {
	timestamp: number;
	tool: string;
	rule: string;
	command: string;
	action: "blocked" | "warned";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOME = homedir();

const DEFAULT_CONFIG: SandboxConfig = {
	mode: "workspace-write",
	additionalWritePaths: [],
	networkAccess: false,
	extraProtectedPaths: [],
};

/** Paths that should NEVER be written to by agent tools */
const PROTECTED_PATHS = [
	".git",
	`${HOME}/.ssh`,
	`${HOME}/.gnupg`,
	`${HOME}/.aws`,
	`${HOME}/.config/ssh`,
	"/etc",
	"/usr/local/bin",
	"/System",
	"/Library",
];

/** Additional paths to protect from deletion (but allow reads) */
const DELETE_PROTECTED_PATHS = [
	"node_modules", // accidental `rm -rf node_modules` in wrong dir
	".env",
	".env.local",
	".env.production",
];

/**
 * Network commands that should be blocked in workspace-write mode.
 * NOTE: These are checked per sub-command after splitting on shell operators.
 */
const NETWORK_COMMANDS = [
	/\bcurl\b/,
	/\bwget\b/,
	/\bnc\b/,
	/\bnetcat\b/,
	/\bncat\b/,
	/(?:^|\s)ssh\s/,  // ssh command (not ssh-keygen, ssh-add, ssh-agent, or paths)
	/\bscp\b/,
	/\brsync\b.*:/, // rsync to remote
	/\bftp\b/,
	/\bsftp\b/,
	/\bnpm\s+publish\b/,
	/\bnpx\b/, // npx downloads and executes remote code
	/\bcargo\s+publish\b/,
	/\bpip\s+install\b(?!.*--no-index)/, // pip install from PyPI
	/\bpython\s+-m\s+http\.server\b/,
	/\bphp\s+-S\b/,
	/\bruby\s+-run\s+httpd\b/,
	/\btelnet\b/,
	/\bopen\s+https?:\/\//,
];

/**
 * Network commands that are ALLOWED even in workspace-write mode.
 * NOTE: These are checked per sub-command after splitting on shell operators.
 * A sub-command must match an allowlist entry AND no blocklist entry to pass.
 */
const NETWORK_ALLOWLIST = [
	/^\s*(npm|pnpm|yarn|bun)\s+(install|ci|i|add)\b/, // dependency installation (anchored)
	/^\s*(npm|pnpm|yarn|bun)\s+run\b/,                // npm scripts (anchored)
	/^\s*git\s+(fetch|pull|clone)\b/,                  // git read operations (anchored)
	/^\s*git\s+push\b/,                                // git push (guarded by guardrails)
	/\bcurl\b.*\blocalhost\b/,                         // localhost requests
	/\bcurl\b.*\b127\.0\.0\.1\b/,                      // loopback
	/\bwget\b.*\blocalhost\b/,
	/\bwget\b.*\b127\.0\.0\.1\b/,
];

/** Patterns for destructive bulk operations */
const DESTRUCTIVE_PATTERNS = [
	{
		pattern: /\brm\s+.*-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+.*-[a-zA-Z]*f[a-zA-Z]*r/,
		extract: (cmd: string) => {
			const match = cmd.match(/\brm\s+(?:-[a-zA-Z]+\s+)*(.+)/);
			return match?.[1]?.trim() ?? "";
		},
		description: "Recursive force delete",
	},
	{
		pattern: /\bfind\b.*-delete/,
		extract: (cmd: string) => {
			const match = cmd.match(/\bfind\s+(\S+)/);
			return match?.[1]?.trim() ?? "";
		},
		description: "Find and delete",
	},
	{
		pattern: /\bchmod\s+.*777/,
		extract: () => "",
		description: "World-writable permissions",
	},
	{
		pattern: /\bchown\b/,
		extract: () => "",
		description: "Ownership change",
	},
	{
		pattern: /\bdd\s+/,
		extract: () => "",
		description: "Raw disk operation",
	},
	{
		pattern: /\bmkfs\b/,
		extract: () => "",
		description: "Filesystem format",
	},
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const MAX_VIOLATIONS = 500;
const violations: SandboxViolation[] = [];

function recordViolation(v: SandboxViolation): void {
	violations.push(v);
	if (violations.length > MAX_VIOLATIONS) {
		violations.splice(0, violations.length - MAX_VIOLATIONS);
	}
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Strip surrounding single or double quotes from a string */
function stripQuotes(s: string): string {
	if (s.length >= 2) {
		if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
			return s.slice(1, -1);
		}
	}
	return s;
}

/**
 * Sanitize a path for safe interpolation into Seatbelt SBPL profile.
 * Rejects paths containing double-quote characters to prevent injection.
 */
function sanitizeForSBPL(path: string): string {
	if (path.includes('"')) {
		throw new Error(`[sandbox] Path contains double-quote character, cannot safely embed in Seatbelt profile: ${path}`);
	}
	return path;
}

function normalizePath(p: string, cwd: string): string {
	if (!p) return "";
	// Strip quotes first
	const unquoted = stripQuotes(p.trim());
	// Expand ~ to home
	const expanded = unquoted.startsWith("~") ? join(HOME, unquoted.slice(1)) : unquoted;
	// Resolve relative paths
	const resolved = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
	// Resolve symlinks when possible for security-critical checks
	try {
		return realpathSync(resolved);
	} catch {
		// Path doesn't exist yet — fall back to lexical resolution
		return resolved;
	}
}

function isUnderProtectedPath(filePath: string, cwd: string, extraPaths: string[]): string | null {
	const normalized = normalizePath(filePath, cwd);
	const allProtected = [...PROTECTED_PATHS, ...extraPaths].map((p) =>
		normalizePath(p, cwd),
	);

	for (const protectedPath of allProtected) {
		if (
			normalized === protectedPath ||
			normalized.startsWith(protectedPath + "/")
		) {
			return protectedPath;
		}
	}
	return null;
}

function isOutsideWorkspace(filePath: string, cwd: string, additionalPaths: string[]): boolean {
	const normalized = normalizePath(filePath, cwd);
	const resolvedCwd = resolve(cwd);
	const tmpDir = process.env.TMPDIR || "/tmp";

	const allowedRoots = [
		resolvedCwd,
		resolve(tmpDir),
		resolve("/tmp"),
		resolve("/private/tmp"),
		...additionalPaths.map((p) => normalizePath(p, cwd)),
	];

	return !allowedRoots.some(
		(root) => normalized === root || normalized.startsWith(root + "/"),
	);
}

// ---------------------------------------------------------------------------
// Command analysis
// ---------------------------------------------------------------------------

/**
 * Split a shell command on operators (;, &&, ||, |) to get individual sub-commands.
 * This is a best-effort split — does not handle quoted strings containing operators.
 */
function splitSubCommands(command: string): string[] {
	// Split on ; && || | but not inside quotes (best-effort)
	return command
		.split(/\s*(?:;|&&|\|\||(?<![>12])\|)\s*/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Extract potential write targets from a bash command.
 * This is best-effort heuristic, not a parser.
 */
function extractWriteTargets(command: string): string[] {
	const targets: string[] = [];

	// Output redirection: > file, >> file (but NOT | pipe)
	const redirects = command.matchAll(/[12]?>>\s*(\S+)|(?<!\|)>\s*(\S+)/g);
	for (const match of redirects) {
		targets.push(stripQuotes(match[1] || match[2]));
	}

	// tee command targets — capture ALL targets (not just first)
	const teeMatch = command.match(/\btee\s+(?:-a\s+)?(.+?)(?:\s*[;|&>]|$)/);
	if (teeMatch) {
		const teeArgs = teeMatch[1].split(/\s+/).filter((t) => !t.startsWith("-"));
		targets.push(...teeArgs.map(stripQuotes));
	}

	// mv destination — capture LAST non-flag token (handles multiple sources)
	const mvMatch = command.match(/\bmv\s+(.+)/);
	if (mvMatch) {
		const args = mvMatch[1].split(/\s+/).filter((t) => !t.startsWith("-"));
		if (args.length >= 2) {
			targets.push(stripQuotes(args[args.length - 1]));
		}
	}

	// cp destination — capture LAST non-flag token (handles multiple sources)
	const cpMatch = command.match(/\bcp\s+(.+)/);
	if (cpMatch) {
		const args = cpMatch[1].split(/\s+/).filter((t) => !t.startsWith("-"));
		if (args.length >= 2) {
			targets.push(stripQuotes(args[args.length - 1]));
		}
	}

	// install command — last non-flag arg is destination
	const installMatch = command.match(/\binstall\s+(.+)/);
	if (installMatch) {
		const args = installMatch[1].split(/\s+/).filter((t) => !t.startsWith("-"));
		if (args.length >= 2) {
			targets.push(stripQuotes(args[args.length - 1]));
		}
	}

	// dd of=<path>
	const ddMatch = command.match(/\bdd\b.*\bof=(\S+)/);
	if (ddMatch) {
		targets.push(stripQuotes(ddMatch[1]));
	}

	// sed -i (in-place edit)
	const sedMatch = command.match(/\bsed\s+.*-i['"=]?\s*(?:\S+\s+)*.*\s+(\S+)$/);
	if (sedMatch) targets.push(stripQuotes(sedMatch[1]));

	// touch
	const touchMatch = command.match(/\btouch\s+(\S+)/);
	if (touchMatch) targets.push(stripQuotes(touchMatch[1]));

	// mkdir
	const mkdirMatch = command.match(/\bmkdir\s+(?:-[a-zA-Z]+\s+)*(\S+)/);
	if (mkdirMatch) targets.push(stripQuotes(mkdirMatch[1]));

	return targets.filter(Boolean);
}

function extractDeleteTargets(command: string): string[] {
	const targets: string[] = [];

	// rm targets (after flags)
	const rmMatch = command.match(/\brm\s+(?:-[a-zA-Z]+\s+)*(.+)/);
	if (rmMatch) {
		targets.push(
			...rmMatch[1].split(/\s+/).filter((t) => !t.startsWith("-")).map(stripQuotes),
		);
	}

	return targets.filter(Boolean);
}

/**
 * Check if a command accesses the network.
 * Splits compound commands (;, &&, ||, |) and checks each sub-command independently.
 * A sub-command passes ONLY if it matches an allowlist entry.
 */
function isNetworkCommand(command: string): { blocked: boolean; reason: string } | null {
	const subCommands = splitSubCommands(command);

	for (const sub of subCommands) {
		const trimmed = sub.trim();

		// Check if this sub-command matches any network blocklist pattern
		let matchedPattern: RegExp | null = null;
		for (const pattern of NETWORK_COMMANDS) {
			if (pattern.test(trimmed)) {
				matchedPattern = pattern;
				break;
			}
		}

		if (!matchedPattern) continue; // This sub-command doesn't touch network

		// Sub-command touches network — check if it's specifically allowed
		let allowed = false;
		for (const allow of NETWORK_ALLOWLIST) {
			if (allow.test(trimmed)) {
				allowed = true;
				break;
			}
		}

		if (!allowed) {
			return {
				blocked: true,
				reason: `Network access denied in sandbox mode. Sub-command matches: ${matchedPattern.source}\nFull command: ${command.slice(0, 150)}`,
			};
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Seatbelt Profile Generation
// ---------------------------------------------------------------------------

function generateSeatbeltProfile(
	mode: SandboxMode,
	cwd: string,
	config: SandboxConfig,
): string {
	const resolvedCwd = sanitizeForSBPL(resolve(cwd));
	const tmpDir = sanitizeForSBPL(resolve(process.env.TMPDIR || "/tmp"));
	const lines: string[] = [];

	lines.push("(version 1)");
	lines.push("");
	lines.push(";; Generated by pikit sandbox extension");
	lines.push(`;; Mode: ${mode}`);
	lines.push(`;; CWD: ${resolvedCwd}`);
	lines.push(`;; Generated: ${new Date().toISOString()}`);
	lines.push("");

	// Default deny
	lines.push("(deny default)");
	lines.push("");

	// Process operations (always needed)
	lines.push(";; === PROCESS ===");
	lines.push("(allow process*)");
	lines.push("(allow signal (target self))");
	lines.push("(allow sysctl-read)");
	lines.push("");

	// Mach/IPC (needed for Node.js, system libs)
	lines.push(";; === MACH/IPC ===");
	lines.push("(allow mach-lookup)");
	lines.push("(allow mach-register)");
	lines.push("(allow ipc-posix-shm-read-data)");
	lines.push("(allow ipc-posix-shm-write-data)");
	lines.push("(allow ipc-posix-shm-write-create)");
	lines.push("");

	// File reads (always allowed — agent needs to read code)
	lines.push(";; === FILE READ ===");
	lines.push("(allow file-read*)");
	lines.push("");

	// File writes
	lines.push(";; === FILE WRITE ===");

	if (mode === "read-only") {
		lines.push(";; Read-only mode: no file writes");
		lines.push("(deny file-write*)");
	} else if (mode === "workspace-write") {
		lines.push(";; Workspace-write mode: cwd + tmp only");
		lines.push(`(allow file-write* (subpath "${resolvedCwd}"))`);
		lines.push(`(allow file-write* (subpath "${tmpDir}"))`);
		lines.push('(allow file-write* (subpath "/tmp"))');
		lines.push('(allow file-write* (subpath "/private/tmp"))');
		lines.push('(allow file-write* (subpath "/var/folders"))');
		// /dev/null, /dev/tty for stdio
		lines.push('(allow file-write* (literal "/dev/null"))');
		lines.push('(allow file-write* (literal "/dev/tty"))');
		lines.push('(allow file-write* (regex #"^/dev/ttys[0-9]+$"))');
		lines.push('(allow file-write* (regex #"^/dev/fd/[0-9]+$"))');

		// Additional write paths
		for (const extra of config.additionalWritePaths) {
			const resolved = sanitizeForSBPL(normalizePath(extra, cwd));
			lines.push(`(allow file-write* (subpath "${resolved}"))`);
		}

		lines.push("");
		lines.push(";; Protected paths — deny even within workspace");
		lines.push(`(deny file-write* (subpath "${sanitizeForSBPL(join(resolvedCwd, ".git"))}") (with no-log))`);
	} else {
		// full-access
		lines.push(";; Full-access mode: all writes allowed");
		lines.push("(allow file-write*)");
	}

	lines.push("");

	// Network
	lines.push(";; === NETWORK ===");
	if (mode === "full-access" || config.networkAccess) {
		lines.push("(allow network*)");
	} else {
		lines.push(";; Network denied by default");
		lines.push("(deny network*)");
		// Allow localhost for dev servers (Seatbelt requires "localhost" not "127.0.0.1")
		lines.push('(allow network* (local ip "localhost:*"))');
		lines.push('(allow network* (remote ip "localhost:*"))');
	}

	lines.push("");
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function sandboxExtension(pi: any): void {
	const cwd = process.cwd();
	const configEnv = (process.env.PI_SANDBOX_MODE ?? "workspace-write") as SandboxMode;
	const validModes: SandboxMode[] = ["read-only", "workspace-write", "full-access"];
	const mode = validModes.includes(configEnv) ? configEnv : "workspace-write";
	const networkAccess = process.env.PI_SANDBOX_NETWORK === "true";

	const config: SandboxConfig = {
		...DEFAULT_CONFIG,
		mode,
		networkAccess,
	};

	console.debug(`[sandbox] Mode: ${config.mode}, Network: ${config.networkAccess ? "allowed" : "denied"}`);

	// -----------------------------------------------------------------------
	// Write the Seatbelt profile to disk
	// -----------------------------------------------------------------------

	const sandboxDir = join(cwd, ".pi", "sandbox");
	try {
		if (!existsSync(sandboxDir)) {
			mkdirSync(sandboxDir, { recursive: true });
		}

		const profile = generateSeatbeltProfile(config.mode, cwd, config);
		writeFileSync(join(sandboxDir, "profile.sb"), profile, "utf8");

		// Also write launch helper
		const launchScript = [
			"#!/usr/bin/env bash",
			"# Launch a command under pikit sandbox",
			"# Usage: ./launch.sh <command> [args...]",
			"#",
			'# Example: ./launch.sh bash -c "ls -la"',
			'# Example: ./launch.sh node -e "console.log(1)"',
			"#",
			`# Sandbox mode: ${config.mode}`,
			`# Generated: ${new Date().toISOString()}`,
			"",
			'set -euo pipefail',
			'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
			'PROFILE="${SCRIPT_DIR}/profile.sb"',
			"",
			'if [ ! -f "$PROFILE" ]; then',
			'  echo "Error: Seatbelt profile not found at $PROFILE" >&2',
			"  exit 1",
			"fi",
			"",
			'if ! command -v sandbox-exec &>/dev/null; then',
			'  echo "Warning: sandbox-exec not found (not macOS?). Running without sandbox." >&2',
			'  exec "$@"',
			"fi",
			"",
			'exec sandbox-exec -f "$PROFILE" "$@"',
			"",
		].join("\n");

		writeFileSync(join(sandboxDir, "launch.sh"), launchScript, {
			encoding: "utf8",
			mode: 0o755,
		});

		console.debug(`[sandbox] Profile written to ${sandboxDir}/profile.sb`);
	} catch (err) {
		console.debug(`[sandbox] Failed to write profile: ${err}`);
	}

	// -----------------------------------------------------------------------
	// Intercept bash tool calls
	// -----------------------------------------------------------------------

	pi.on("before_tool_call", (event: any) => {
		const toolName = event?.name ?? event?.toolName;
		if (toolName !== "bash") return;

		const command = event?.input?.command ?? event?.params?.command ?? "";
		if (!command || typeof command !== "string") return;

		const normalized = command.replace(/\s+/g, " ").trim();

		// ----- Protected path writes -----
		const writeTargets = extractWriteTargets(normalized);
		for (const target of writeTargets) {
			const protectedMatch = isUnderProtectedPath(target, cwd, config.extraProtectedPaths);
			if (protectedMatch) {
				recordViolation({
					timestamp: Date.now(),
					tool: "bash",
					rule: "protected-path-write",
					command: normalized.slice(0, 200),
					action: "blocked",
				});
				return {
					blocked: true,
					message: `[sandbox] BLOCKED: Write to protected path.\n\nTarget: ${target}\nProtected: ${protectedMatch}\nCommand: ${normalized.slice(0, 100)}\n\nProtected paths cannot be modified by agent tools. Use git commands for .git/ operations.`,
				};
			}
		}

		// ----- Protected path deletes -----
		const deleteTargets = extractDeleteTargets(normalized);
		for (const target of deleteTargets) {
			const protectedMatch = isUnderProtectedPath(target, cwd, config.extraProtectedPaths);
			if (protectedMatch) {
				recordViolation({
					timestamp: Date.now(),
					tool: "bash",
					rule: "protected-path-delete",
					command: normalized.slice(0, 200),
					action: "blocked",
				});
				return {
					blocked: true,
					message: `[sandbox] BLOCKED: Delete in protected path.\n\nTarget: ${target}\nProtected: ${protectedMatch}\nCommand: ${normalized.slice(0, 100)}`,
				};
			}

			// Check delete-protected paths (warn, don't block)
			const normalizedTarget = normalizePath(target, cwd);
			for (const dp of DELETE_PROTECTED_PATHS) {
				const dpNormalized = normalizePath(dp, cwd);
				if (normalizedTarget === dpNormalized || normalizedTarget.startsWith(dpNormalized + "/")) {
					recordViolation({
						timestamp: Date.now(),
						tool: "bash",
						rule: "delete-protected-warn",
						command: normalized.slice(0, 200),
						action: "warned",
					});
					return {
						confirm: true,
						message: `[sandbox] WARNING: Deleting sensitive path: ${target}\n\nCommand: ${normalized.slice(0, 100)}\n\nAre you sure?`,
					};
				}
			}
		}

		// ----- Workspace boundary (workspace-write mode) -----
		if (config.mode === "workspace-write") {
			for (const target of writeTargets) {
				if (isOutsideWorkspace(target, cwd, config.additionalWritePaths)) {
					recordViolation({
						timestamp: Date.now(),
						tool: "bash",
						rule: "workspace-boundary",
						command: normalized.slice(0, 200),
						action: "blocked",
					});
					return {
						blocked: true,
						message: `[sandbox] BLOCKED: Write outside workspace.\n\nTarget: ${target}\nWorkspace: ${cwd}\nMode: workspace-write\n\nSet PI_SANDBOX_MODE=full-access to allow writes outside workspace.`,
					};
				}
			}
		}

		// ----- Read-only mode -----
		if (config.mode === "read-only") {
			// Block any command that looks like it writes
			// NOTE: Only match > redirection, NOT | pipe (pipe is read-only data flow)
			const writePatterns = [
				/\b(rm|mv|cp|mkdir|touch|chmod|chown|install)\b/,
				/\bsed\s.*-i/,
				/\btee\b/,
				/[12]?>>?\s*\S+/,  // Only > and >> redirections, not | pipes
				/\bgit\s+(commit|push|reset|clean|checkout\s+\.)/,
				/\bnpm\s+(install|publish)\b/,
				/\bdd\s+/,
			];

			// Read-only allowlist — verification commands that are safe
			const readOnlyAllowlist = [
				/^\s*(npm|pnpm|yarn|bun)\s+run\s+(lint|typecheck|check|test|build)/,
				/^\s*(npm|pnpm|yarn|bun)\s+test\b/,
				/^\s*npx\s+(tsc|eslint|prettier|vitest|jest)\b/,
				/^\s*cargo\s+(check|clippy|test|build)\b/,
				/^\s*go\s+(vet|test|build)\b/,
				/^\s*(mypy|pyright|ruff|pytest)\b/,
			];

			// Check allowlist first
			let isAllowed = false;
			for (const allow of readOnlyAllowlist) {
				if (allow.test(normalized)) {
					isAllowed = true;
					break;
				}
			}

			if (!isAllowed) {
				for (const pattern of writePatterns) {
					if (pattern.test(normalized)) {
						recordViolation({
							timestamp: Date.now(),
							tool: "bash",
							rule: "read-only-violation",
							command: normalized.slice(0, 200),
							action: "blocked",
						});
						return {
							blocked: true,
							message: `[sandbox] BLOCKED: Write operation in read-only mode.\n\nCommand: ${normalized.slice(0, 100)}\nMode: read-only\n\nSet PI_SANDBOX_MODE=workspace-write to allow writes.`,
						};
					}
				}
			}
		}

		// ----- Network access -----
		if (!config.networkAccess && config.mode !== "full-access") {
			const networkResult = isNetworkCommand(normalized);
			if (networkResult) {
				recordViolation({
					timestamp: Date.now(),
					tool: "bash",
					rule: "network-denied",
					command: normalized.slice(0, 200),
					action: "warned",
				});
				return {
					confirm: true,
					message: `[sandbox] WARNING: ${networkResult.reason}\n\nAllow this network access?`,
				};
			}
		}

		// ----- Destructive bulk operations -----
		for (const { pattern, extract, description } of DESTRUCTIVE_PATTERNS) {
			if (pattern.test(normalized)) {
				const target = extract(normalized);
				// Only warn, don't block (guardrails handles the catastrophic cases)
				recordViolation({
					timestamp: Date.now(),
					tool: "bash",
					rule: "destructive-operation",
					command: normalized.slice(0, 200),
					action: "warned",
				});
				return {
					confirm: true,
					message: `[sandbox] WARNING: ${description} detected.\n\nTarget: ${target || "(multiple/complex)"}\nCommand: ${normalized.slice(0, 100)}\n\nThis is a destructive operation. Proceed?`,
				};
			}
		}
	});

	// -----------------------------------------------------------------------
	// Intercept write/edit tool calls for protected paths
	// -----------------------------------------------------------------------

	pi.on("before_tool_call", (event: any) => {
		const toolName = event?.name ?? event?.toolName;
		if (toolName !== "write" && toolName !== "edit") return;

		const filePath = event?.input?.path ?? event?.params?.path ?? "";
		if (!filePath || typeof filePath !== "string") return;

		// Read-only mode blocks all writes
		if (config.mode === "read-only") {
			recordViolation({
				timestamp: Date.now(),
				tool: toolName,
				rule: "read-only-violation",
				command: `${toolName} ${filePath}`,
				action: "blocked",
			});
			return {
				blocked: true,
				message: `[sandbox] BLOCKED: ${toolName} tool disabled in read-only mode.\n\nFile: ${filePath}\nMode: read-only`,
			};
		}

		// Protected path check
		const protectedMatch = isUnderProtectedPath(filePath, cwd, config.extraProtectedPaths);
		if (protectedMatch) {
			recordViolation({
				timestamp: Date.now(),
				tool: toolName,
				rule: "protected-path-write",
				command: `${toolName} ${filePath}`,
				action: "blocked",
			});
			return {
				blocked: true,
				message: `[sandbox] BLOCKED: Cannot ${toolName} to protected path.\n\nFile: ${filePath}\nProtected: ${protectedMatch}`,
			};
		}

		// Workspace boundary check
		if (config.mode === "workspace-write") {
			if (isOutsideWorkspace(filePath, cwd, config.additionalWritePaths)) {
				recordViolation({
					timestamp: Date.now(),
					tool: toolName,
					rule: "workspace-boundary",
					command: `${toolName} ${filePath}`,
					action: "blocked",
				});
				return {
					blocked: true,
					message: `[sandbox] BLOCKED: ${toolName} outside workspace.\n\nFile: ${filePath}\nWorkspace: ${cwd}`,
				};
			}
		}
	});

	// -----------------------------------------------------------------------
	// /sandbox command
	// -----------------------------------------------------------------------

	pi.registerCommand("sandbox", {
		description: "Show sandbox status, profile, and violations",
		async handler(_args: any, ctx: any) {
			const recentBlocked = violations.filter((v) => v.action === "blocked").slice(-5);
			const recentWarned = violations.filter((v) => v.action === "warned").slice(-5);

			const lines = [
				"## Sandbox Status\n",
				`**Mode**: ${config.mode}`,
				`**Network**: ${config.networkAccess ? "allowed" : "denied"}`,
				`**Workspace**: ${cwd}`,
				`**Protected paths**: ${PROTECTED_PATHS.length + config.extraProtectedPaths.length}`,
				"",
				`**Violations logged**: ${violations.length}`,
				`  Blocked: ${violations.filter((v) => v.action === "blocked").length}`,
				`  Warned: ${violations.filter((v) => v.action === "warned").length}`,
			];

			if (recentBlocked.length > 0) {
				lines.push("", "### Recent Blocks");
				for (const v of recentBlocked) {
					const time = new Date(v.timestamp).toLocaleTimeString();
					lines.push(`  ${time} [${v.rule}] ${v.tool}: ${v.command.slice(0, 60)}`);
				}
			}

			if (recentWarned.length > 0) {
				lines.push("", "### Recent Warnings");
				for (const v of recentWarned) {
					const time = new Date(v.timestamp).toLocaleTimeString();
					lines.push(`  ${time} [${v.rule}] ${v.tool}: ${v.command.slice(0, 60)}`);
				}
			}

			lines.push(
				"",
				"### Seatbelt Profile",
				`  Location: ${join(sandboxDir, "profile.sb")}`,
				`  Launcher: ${join(sandboxDir, "launch.sh")}`,
				"",
				"### Usage",
				"  Launch command under sandbox:",
				`    .pi/sandbox/launch.sh bash -c "your-command"`,
				"",
				"### Configuration (env vars)",
				"  PI_SANDBOX_MODE=read-only|workspace-write|full-access",
				"  PI_SANDBOX_NETWORK=true|false",
			);

			const output = lines.join("\n").trim();
			if (ctx?.ui) {
				ctx.ui.notify(output, "info");
			}
			return output;
		},
	});
}
