/**
 * Hooks Extension
 *
 * Thin bridge between Pi lifecycle events and user-configurable shell scripts.
 *
 * Hook search order:
 *   1) ~/.pi/agent/hooks (global)
 *   2) ./.pi/hooks (project)
 *
 * Project hooks run after global hooks.
 */

import { execSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type HookScope = "global" | "project";
type HookFile =
	| "session-start.sh"
	| "pre-tool-use.sh"
	| "input.sh"
	| "pre-commit.sh";

interface HookDefinition {
	file: HookFile;
	event: "session_start" | "input" | "before_tool_call";
	canBlock: boolean;
}

interface ActiveHook {
	definition: HookDefinition;
	scope: HookScope;
	path: string;
}

interface HookRunResult {
	ok: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	error?: string;
}

const HOOK_TIMEOUT_MS = 3_000; // Keep short — execSync blocks the event loop
const HOOK_DEFINITIONS: HookDefinition[] = [
	{
		file: "session-start.sh",
		event: "session_start",
		canBlock: false,
	},
	{
		file: "pre-tool-use.sh",
		event: "before_tool_call",
		canBlock: true,
	},
	{
		file: "input.sh",
		event: "input",
		canBlock: false,
	},
	{
		file: "pre-commit.sh",
		event: "before_tool_call",
		canBlock: true,
	},
];

function debug(message: string): void {
	console.debug(`[hooks] ${message}`);
}

function toSafeString(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value === null || value === undefined) return "";
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function toJsonString(value: unknown): string {
	try {
		return JSON.stringify(value ?? {});
	} catch {
		return "{}";
	}
}

function discoverHooks(rootDir: string): ActiveHook[] {
	const discovered: ActiveHook[] = [];

	const hookRoots: Array<{ scope: HookScope; dir: string }> = [
		{ scope: "global", dir: join(homedir(), ".pi", "agent", "hooks") },
		{ scope: "project", dir: join(rootDir, ".pi", "hooks") },
	];

	for (const root of hookRoots) {
		if (!existsSync(root.dir)) {
			debug(`Hook directory not found (${root.scope}): ${root.dir}`);
			continue;
		}

		let isDir = false;
		try {
			isDir = statSync(root.dir).isDirectory();
		} catch {
			isDir = false;
		}
		if (!isDir) {
			debug(`Hook path exists but is not a directory (${root.scope}): ${root.dir}`);
			continue;
		}

		for (const definition of HOOK_DEFINITIONS) {
			const candidate = join(root.dir, definition.file);
			if (!existsSync(candidate)) continue;

			let isFile = false;
			try {
				isFile = statSync(candidate).isFile();
			} catch {
				isFile = false;
			}
			if (!isFile) continue;

			// Check executable permission — skip with warning if not executable
			let isExecutable = false;
			try {
				accessSync(candidate, constants.X_OK);
				isExecutable = true;
			} catch {
				isExecutable = false;
			}
			if (!isExecutable) {
				debug(
					`Hook ${definition.file} (${root.scope}) exists but is not executable: ${candidate}. Run: chmod +x ${candidate}`,
				);
				continue;
			}

			discovered.push({
				definition,
				scope: root.scope,
				path: candidate,
			});
			debug(`Registered ${definition.file} (${root.scope}) at ${candidate}`);
		}
	}

	return discovered;
}

function extractOutput(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
	if (value == null) return "";
	return String(value).trim();
}

function runHookScript(hook: ActiveHook, env: Record<string, string>): HookRunResult {
	debug(`Executing ${hook.definition.file} (${hook.scope}) → ${hook.path}`);
	try {
		const stdout = execSync(hook.path, {
			env: { ...process.env, ...env },
			encoding: "utf8",
			timeout: HOOK_TIMEOUT_MS,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const cleaned = extractOutput(stdout);
		if (cleaned) {
			debug(`Output from ${hook.definition.file}: ${cleaned}`);
		}
		return {
			ok: true,
			exitCode: 0,
			stdout: cleaned,
			stderr: "",
		};
	} catch (error: any) {
		const stdout = extractOutput(error?.stdout);
		const stderr = extractOutput(error?.stderr);
		const exitCode = typeof error?.status === "number" ? error.status : 1;
		const message = extractOutput(error?.message);
		debug(
			`Hook failed ${hook.definition.file} (${hook.scope}) exit=${exitCode} stdout="${stdout}" stderr="${stderr}" error="${message}"`,
		);
		return {
			ok: false,
			exitCode,
			stdout,
			stderr,
			error: message,
		};
	}
}

function getEventToolName(event: any): string {
	return toSafeString(event?.name ?? event?.toolName ?? "").trim();
}

function getEventToolArgs(event: any): any {
	return event?.input ?? event?.params ?? {};
}

function getEventSessionId(event: any): string {
	return toSafeString(event?.sessionId ?? "default") || "default";
}

function isGitCommitCommand(toolName: string, args: any): boolean {
	if (toolName !== "bash") return false;
	const command = toSafeString(args?.command ?? "").trim();
	if (!command) return false;
	return /^git\s+commit\b/.test(command);
}

function extractCommitMessage(command: string): string {
	const normalized = command.trim();

	// Handle combined short flags like -am, -vm, -sam etc.
	// The -m flag can be combined with other single-char flags (e.g., git commit -am "msg")
	const combinedFlagMatch = normalized.match(
		/(?:\s|^)-[a-ln-zA-LN-Z]*m\s+(?:"([^"]*)"|'([^']*)'|([^\s]+))/,
	);
	if (combinedFlagMatch) {
		return combinedFlagMatch[1] ?? combinedFlagMatch[2] ?? combinedFlagMatch[3] ?? "";
	}

	// Handle standalone -m flag
	const flagMatch = normalized.match(/(?:\s|^)-m\s+(?:"([^"]*)"|'([^']*)'|([^\s]+))/);
	if (flagMatch) {
		return flagMatch[1] ?? flagMatch[2] ?? flagMatch[3] ?? "";
	}

	const longFlagMatch = normalized.match(/--message=(?:"([^"]*)"|'([^']*)'|([^\s]+))/);
	if (longFlagMatch) {
		return longFlagMatch[1] ?? longFlagMatch[2] ?? longFlagMatch[3] ?? "";
	}

	return "";
}

function getStagedFiles(cwd: string): string {
	try {
		const output = execSync("git diff --cached --name-only", {
			cwd,
			encoding: "utf8",
			timeout: 2_000,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return extractOutput(output);
	} catch {
		return "";
	}
}

function buildBlockResponse(reason: string) {
	const message = reason.trim() || "Hook blocked this operation.";
	return {
		blocked: true,
		message: `[hooks] ${message}`,
	};
}

export default function hooksExtension(pi: any): void {
	const rootDir = process.cwd();
	const activeHooks = discoverHooks(rootDir);

	const hooksByFile = new Map<HookFile, ActiveHook[]>();
	for (const hook of activeHooks) {
		const existing = hooksByFile.get(hook.definition.file) ?? [];
		existing.push(hook);
		hooksByFile.set(hook.definition.file, existing);
	}

	const runSeries = (hooks: ActiveHook[] | undefined, env: Record<string, string>, allowBlocking: boolean) => {
		if (!hooks || hooks.length === 0) return undefined;
		for (const hook of hooks) {
			const result = runHookScript(hook, env);
			if (!result.ok) {
				if (allowBlocking) {
					const reason = result.stdout || result.stderr || result.error || `${hook.definition.file} failed.`;
					return buildBlockResponse(reason);
				}
				continue;
			}
		}
		return undefined;
	};

	const sessionStartHooks = hooksByFile.get("session-start.sh") ?? [];
	if (sessionStartHooks.length > 0) {
		pi.on("session_start", (event: any) => {
			const env = {
				PI_SESSION_ID: getEventSessionId(event),
				PI_CWD: toSafeString(event?.cwd ?? rootDir),
			};
			runSeries(sessionStartHooks, env, false);
		});
	}

	const inputHooks = hooksByFile.get("input.sh") ?? [];
	if (inputHooks.length > 0) {
		pi.on("input", (event: any) => {
			const userInput =
				typeof event === "string"
					? event
					: toSafeString(event?.text ?? event?.content ?? event?.input ?? "");
			const env = {
				PI_USER_INPUT: userInput,
				PI_SESSION_ID: getEventSessionId(event),
			};
			runSeries(inputHooks, env, false);
		});
	}

	const preToolHooks = hooksByFile.get("pre-tool-use.sh") ?? [];
	const preCommitHooks = hooksByFile.get("pre-commit.sh") ?? [];
	if (preToolHooks.length > 0 || preCommitHooks.length > 0) {
		pi.on("before_tool_call", (event: any) => {
			const toolName = getEventToolName(event);
			const args = getEventToolArgs(event);
			const sessionId = getEventSessionId(event);

			if (preToolHooks.length > 0) {
				const preToolResult = runSeries(
					preToolHooks,
					{
						PI_TOOL_NAME: toolName,
						PI_TOOL_ARGS: toJsonString(args),
						PI_SESSION_ID: sessionId,
					},
					true,
				);
				if (preToolResult) return preToolResult;
			}

			if (preCommitHooks.length === 0 || !isGitCommitCommand(toolName, args)) {
				return;
			}

			const command = toSafeString(args?.command ?? "").trim();
			const preCommitResult = runSeries(
				preCommitHooks,
				{
					PI_COMMIT_MSG: extractCommitMessage(command),
					PI_FILES: getStagedFiles(rootDir),
					PI_SESSION_ID: sessionId,
				},
				true,
			);
			if (preCommitResult) return preCommitResult;
		});
	}

	pi.registerCommand("hooks", {
		description: "List active shell hooks and their paths",
		async handler(_args: any, ctx: any) {
			const lines = ["## Active Hooks\n"];

			if (activeHooks.length === 0) {
				lines.push("No hooks detected.");
				lines.push(`- Global path: ${join(homedir(), ".pi", "agent", "hooks")}`);
				lines.push(`- Project path: ${join(rootDir, ".pi", "hooks")}`);
			} else {
				lines.push(`Total hooks: ${activeHooks.length}`);
				lines.push("");
				for (const definition of HOOK_DEFINITIONS) {
					const hooks = hooksByFile.get(definition.file) ?? [];
					if (hooks.length === 0) continue;
					lines.push(
						`### ${definition.file} (${definition.event})${definition.canBlock ? " — can block" : ""}`,
					);
					for (const hook of hooks) {
						lines.push(`- [${hook.scope}] ${hook.path}`);
					}
					lines.push("");
				}
			}

			const output = lines.join("\n").trim();
			if (ctx?.ui) {
				ctx.ui.notify(output, "info");
			}
			return output;
		},
	});
}
