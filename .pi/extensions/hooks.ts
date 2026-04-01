/**
 * Hooks Extension
 *
 * Pi-native shell hook bridge inspired by Codex hooks, but adapted to pi's
 * extension events and safety model.
 *
 * Features:
 * - Multiple hook phases beyond startup/pre-tool/input
 * - Structured JSON event payload on stdin for every hook
 * - Backward-compatible environment variables for existing shell scripts
 * - Structured JSON stdout for input/tool-call/tool-result control
 * - Configurable timeout via PI_HOOK_TIMEOUT_MS
 * - Legacy hook directory fallback (`hooks/`) for migration compatibility
 *
 * Hook search order per scope:
 *   1) ~/.pi/agent/shell-hooks
 *   2) ~/.pi/agent/hooks              (legacy fallback)
 *   3) ./.pi/shell-hooks
 *   4) ./.pi/hooks                    (legacy fallback)
 *
 * Global hooks run before project hooks.
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	AgentEndEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	TurnEndEvent,
	UserBashEvent,
	UserBashEventResult,
} from "@mariozechner/pi-coding-agent";

type HookScope = "global" | "project";
type HookEvent =
	| "session_start"
	| "before_agent_start"
	| "input"
	| "tool_call"
	| "tool_result"
	| "user_bash"
	| "agent_end"
	| "turn_end"
	| "session_shutdown";
type HookBehavior = "passive" | "input" | "tool_call" | "tool_result" | "before_agent_start" | "user_bash";
type HookFile =
	| "session-start.sh"
	| "before-agent-start.sh"
	| "input.sh"
	| "pre-tool-use.sh"
	| "pre-commit.sh"
	| "post-tool-use.sh"
	| "user-bash.sh"
	| "agent-end.sh"
	| "turn-end.sh"
	| "session-stop.sh";

interface HookDefinition {
	file: HookFile;
	event: HookEvent;
	behavior: HookBehavior;
	canBlock: boolean;
}

interface HookRoot {
	scope: HookScope;
	dir: string;
	legacy: boolean;
}

interface ActiveHook {
	definition: HookDefinition;
	scope: HookScope;
	path: string;
	rootDir: string;
	legacy: boolean;
}

interface HookRunResult {
	ok: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	parsed: unknown;
	error?: string;
}

type HookCustomMessage = NonNullable<BeforeAgentStartEventResult["message"]>;

const DEFAULT_HOOK_TIMEOUT_MS = 10_000;
const MAX_HOOK_TIMEOUT_MS = 60_000;
const HOOK_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_ENV_TEXT_LENGTH = 16_000;
const DEBUG = process.env.PI_HOOKS_DEBUG === "1";

const HOOK_DEFINITIONS: HookDefinition[] = [
	{
		file: "session-start.sh",
		event: "session_start",
		behavior: "passive",
		canBlock: false,
	},
	{
		file: "before-agent-start.sh",
		event: "before_agent_start",
		behavior: "before_agent_start",
		canBlock: false,
	},
	{
		file: "input.sh",
		event: "input",
		behavior: "input",
		canBlock: false,
	},
	{
		file: "pre-tool-use.sh",
		event: "tool_call",
		behavior: "tool_call",
		canBlock: true,
	},
	{
		file: "pre-commit.sh",
		event: "tool_call",
		behavior: "tool_call",
		canBlock: true,
	},
	{
		file: "post-tool-use.sh",
		event: "tool_result",
		behavior: "tool_result",
		canBlock: false,
	},
	{
		file: "user-bash.sh",
		event: "user_bash",
		behavior: "user_bash",
		canBlock: true,
	},
	{
		file: "agent-end.sh",
		event: "agent_end",
		behavior: "passive",
		canBlock: false,
	},
	{
		file: "turn-end.sh",
		event: "turn_end",
		behavior: "passive",
		canBlock: false,
	},
	{
		file: "session-stop.sh",
		event: "session_shutdown",
		behavior: "passive",
		canBlock: false,
	},
];

function debug(message: string): void {
	if (DEBUG) console.debug(`[hooks] ${message}`);
}

function toSafeString(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
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

function extractOutput(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
	if (value == null) return "";
	return String(value).trim();
}

function truncateForEnv(value: string, maxLength = MAX_ENV_TEXT_LENGTH): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getHookRoots(rootDir: string): HookRoot[] {
	return [
		{ scope: "global", dir: join(homedir(), ".pi", "agent", "shell-hooks"), legacy: false },
		{ scope: "global", dir: join(homedir(), ".pi", "agent", "hooks"), legacy: true },
		{ scope: "project", dir: join(rootDir, ".pi", "shell-hooks"), legacy: false },
		{ scope: "project", dir: join(rootDir, ".pi", "hooks"), legacy: true },
	];
}

function isExecutableFile(path: string): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function discoverHooks(rootDir: string): { activeHooks: ActiveHook[]; roots: HookRoot[] } {
	const roots = getHookRoots(rootDir);
	const activeHooks: ActiveHook[] = [];

	for (const scope of ["global", "project"] as const) {
		const scopeRoots = roots.filter((root) => root.scope === scope);

		for (const definition of HOOK_DEFINITIONS) {
			let selected: ActiveHook | undefined;

			for (const root of scopeRoots) {
				if (!existsSync(root.dir)) {
					debug(`Hook directory not found (${scope}${root.legacy ? ", legacy" : ""}): ${root.dir}`);
					continue;
				}

				try {
					if (!statSync(root.dir).isDirectory()) {
						debug(`Hook path exists but is not a directory: ${root.dir}`);
						continue;
					}
				} catch {
					continue;
				}

				const candidate = join(root.dir, definition.file);
				if (!existsSync(candidate)) continue;

				if (!isExecutableFile(candidate)) {
					debug(
						`Hook ${definition.file} exists but is not executable: ${candidate}. Run: chmod +x ${candidate}`,
					);
					continue;
				}

				selected = {
					definition,
					scope,
					path: candidate,
					rootDir: root.dir,
					legacy: root.legacy,
				};
				break;
			}

			if (selected) {
				activeHooks.push(selected);
				debug(
					`Registered ${definition.file} (${scope}${selected.legacy ? ", legacy" : ""}) at ${selected.path}`,
				);
			}
		}
	}

	return { activeHooks, roots };
}

function getHookTimeoutMs(): number {
	const raw = Number.parseInt(process.env.PI_HOOK_TIMEOUT_MS || "", 10);
	if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HOOK_TIMEOUT_MS;
	return Math.min(raw, MAX_HOOK_TIMEOUT_MS);
}

function parseStructuredOutput(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) return undefined;

	try {
		return JSON.parse(trimmed);
	} catch {
		const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
		const lastLine = lines.at(-1);
		if (!lastLine) return undefined;
		try {
			return JSON.parse(lastLine);
		} catch {
			return undefined;
		}
	}
}

function runHookScript(
	hook: ActiveHook,
	payload: Record<string, unknown>,
	env: Record<string, string>,
	cwd: string,
): HookRunResult {
	const timeoutMs = getHookTimeoutMs();
	debug(`Executing ${hook.definition.file} (${hook.scope}) → ${hook.path}`);

	try {
		const result = spawnSync(hook.path, [], {
			cwd,
			env: { ...process.env, ...env },
			input: `${toJsonString(payload)}\n`,
			encoding: "utf8",
			timeout: timeoutMs,
			maxBuffer: HOOK_MAX_BUFFER_BYTES,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const stdout = extractOutput(result.stdout);
		const stderr = extractOutput(result.stderr);
		const error = extractOutput(result.error?.message);
		const parsed = parseStructuredOutput(stdout);
		const exitCode = typeof result.status === "number" ? result.status : (result.error ? 1 : 0);
		const ok = exitCode === 0 && !result.error;

		if (stdout) debug(`stdout ${hook.definition.file}: ${stdout}`);
		if (stderr) debug(`stderr ${hook.definition.file}: ${stderr}`);
		if (error) debug(`error ${hook.definition.file}: ${error}`);

		return {
			ok,
			exitCode,
			stdout,
			stderr,
			parsed,
			error: error || undefined,
		};
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		debug(`Hook execution threw ${hook.definition.file}: ${message}`);
		return {
			ok: false,
			exitCode: 1,
			stdout: "",
			stderr: "",
			parsed: undefined,
			error: message,
		};
	}
}

function getSessionInfo(ctx: ExtensionContext): {
	sessionId: string;
	sessionFile: string;
	cwd: string;
} {
	return {
		sessionId: ctx.sessionManager.getSessionId() || "default",
		sessionFile: ctx.sessionManager.getSessionFile() || "",
		cwd: ctx.cwd,
	};
}

function buildBaseEnv(hook: ActiveHook, ctx: ExtensionContext): Record<string, string> {
	const session = getSessionInfo(ctx);
	return {
		PI_HOOK_EVENT: hook.definition.event,
		PI_HOOK_FILE: hook.definition.file,
		PI_HOOK_SCOPE: hook.scope,
		PI_HOOK_TIMEOUT_MS: String(getHookTimeoutMs()),
		PI_SESSION_ID: session.sessionId,
		PI_SESSION_FILE: session.sessionFile,
		PI_CWD: session.cwd,
	};
}

function buildBasePayload(hook: ActiveHook, ctx: ExtensionContext): Record<string, unknown> {
	const session = getSessionInfo(ctx);
	return {
		hook_event: hook.definition.event,
		hook_file: hook.definition.file,
		hook_scope: hook.scope,
		hook_path: hook.path,
		hook_root: hook.rootDir,
		legacy_path: hook.legacy,
		timestamp: new Date().toISOString(),
		session_id: session.sessionId,
		session_file: session.sessionFile || undefined,
		cwd: session.cwd,
	};
}

function getToolName(event: ToolCallEvent | ToolResultEvent): string {
	return toSafeString((event as { toolName?: string }).toolName ?? "").trim();
}

function getToolInput(event: ToolCallEvent | ToolResultEvent): Record<string, unknown> {
	return isRecord(event.input) ? event.input : {};
}

function isGitCommitCommand(toolName: string, args: Record<string, unknown>): boolean {
	if (toolName !== "bash") return false;
	const command = toSafeString(args.command ?? "").trim();
	if (!command) return false;
	return /^git\s+commit\b/.test(command);
}

function extractCommitMessage(command: string): string {
	const normalized = command.trim();

	const combinedFlagMatch = normalized.match(
		/(?:\s|^)-[a-ln-zA-LN-Z]*m\s+(?:"([^"]*)"|'([^']*)'|([^\s]+))/,
	);
	if (combinedFlagMatch) {
		return combinedFlagMatch[1] ?? combinedFlagMatch[2] ?? combinedFlagMatch[3] ?? "";
	}

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

function getStagedFiles(cwd: string): string[] {
	try {
		const result = spawnSync("git", ["diff", "--cached", "--name-only"], {
			cwd,
			encoding: "utf8",
			timeout: 2_000,
			maxBuffer: 256 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (result.status !== 0 || result.error) return [];
		const output = extractOutput(result.stdout);
		return output ? output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
	} catch {
		return [];
	}
}

function buildBlockResponse(reason: string): ToolCallEventResult {
	const message = reason.trim() || "Hook blocked this operation.";
	return {
		block: true,
		reason: `[hooks] ${message}`,
	};
}

function getBlockReason(result: HookRunResult, hook: ActiveHook): string {
	if (isRecord(result.parsed) && typeof result.parsed.reason === "string" && result.parsed.reason.trim()) {
		return result.parsed.reason.trim();
	}
	return result.stdout || result.stderr || result.error || `${hook.definition.file} failed.`;
}

function shouldBlockFromStructuredOutput(parsed: unknown): string | undefined {
	if (!isRecord(parsed)) return undefined;
	if (parsed.action === "block" || parsed.block === true) {
		return typeof parsed.reason === "string" && parsed.reason.trim()
			? parsed.reason.trim()
			: "Hook blocked this operation.";
	}
	return undefined;
}

function replaceToolInput(target: Record<string, unknown>, nextInput: Record<string, unknown>): void {
	for (const key of Object.keys(target)) {
		delete target[key];
	}
	Object.assign(target, structuredClone(nextInput));
}

function normalizeToolContent(value: unknown): ToolResultEvent["content"] | undefined {
	if (typeof value === "string") {
		return [{ type: "text", text: value }];
	}
	if (!Array.isArray(value)) return undefined;
	return value as ToolResultEvent["content"];
}

function appendTextBlock(base: string, addition: string): string {
	const next = addition.trim();
	if (!next) return base;
	return base.trim() ? `${base.trim()}\n\n${next}` : next;
}

function normalizeBeforeAgentStartMessage(value: unknown): HookCustomMessage | undefined {
	if (typeof value === "string") {
		return {
			customType: "hooks.before-agent-start",
			content: value,
			display: false,
		};
	}
	if (Array.isArray(value)) {
		return {
			customType: "hooks.before-agent-start",
			content: value as HookCustomMessage["content"],
			display: false,
		};
	}
	if (!isRecord(value)) return undefined;

	const content = value.content;
	if (typeof content !== "string" && !Array.isArray(content)) return undefined;

	return {
		customType:
			typeof value.customType === "string" && value.customType.trim()
				? value.customType.trim()
				: "hooks.before-agent-start",
		content: content as HookCustomMessage["content"],
		display: value.display === true,
		details: value.details,
	};
}

function mergeBeforeAgentStartMessages(
	current: HookCustomMessage | undefined,
	next: HookCustomMessage,
): HookCustomMessage {
	if (!current) return next;
	if (
		typeof current.content === "string" &&
		typeof next.content === "string" &&
		current.customType === next.customType &&
		current.display === next.display
	) {
		return {
			...current,
			content: appendTextBlock(current.content, next.content),
			details: next.details ?? current.details,
		};
	}
	return next;
}

function normalizeBashResult(value: unknown): UserBashEventResult["result"] | undefined {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.output !== "string" &&
		value.output !== undefined &&
		value.output !== null
	) {
		return undefined;
	}
	if (
		typeof value.exitCode !== "number" &&
		value.exitCode !== undefined &&
		value.exitCode !== null
	) {
		return undefined;
	}

	const hasKnownField =
		Object.prototype.hasOwnProperty.call(value, "output") ||
		Object.prototype.hasOwnProperty.call(value, "exitCode") ||
		Object.prototype.hasOwnProperty.call(value, "cancelled") ||
		Object.prototype.hasOwnProperty.call(value, "truncated") ||
		Object.prototype.hasOwnProperty.call(value, "fullOutputPath");
	if (!hasKnownField) return undefined;

	return {
		output: typeof value.output === "string" ? value.output : "",
		exitCode: typeof value.exitCode === "number" ? value.exitCode : undefined,
		cancelled: value.cancelled === true,
		truncated: value.truncated === true,
		fullOutputPath:
			typeof value.fullOutputPath === "string" && value.fullOutputPath.trim()
				? value.fullOutputPath
				: undefined,
	};
}

function buildUserBashBlockResult(reason: string): UserBashEventResult {
	const message = reason.trim() || "Hook blocked this bash command.";
	return {
		result: {
			output: `[hooks] ${message}`,
			exitCode: 1,
			cancelled: false,
			truncated: false,
		},
	};
}

function runPassiveHooks(
	hooks: ActiveHook[],
	ctx: ExtensionContext,
	buildPayload: (hook: ActiveHook) => Record<string, unknown>,
	buildEnv: (hook: ActiveHook) => Record<string, string>,
): void {
	for (const hook of hooks) {
		const result = runHookScript(hook, buildPayload(hook), buildEnv(hook), ctx.cwd);
		if (!result.ok) {
			debug(`Passive hook failed (${hook.definition.file}): ${getBlockReason(result, hook)}`);
		}
	}
}

function runInputHooks(hooks: ActiveHook[], event: InputEvent, ctx: ExtensionContext): InputEventResult | undefined {
	let currentText = event.text;
	let currentImages = event.images;

	for (const hook of hooks) {
		const payload = {
			...buildBasePayload(hook, ctx),
			text: currentText,
			images: currentImages,
			source: event.source,
		};
		const env = {
			...buildBaseEnv(hook, ctx),
			PI_USER_INPUT: currentText,
			PI_INPUT_SOURCE: event.source,
		};
		const result = runHookScript(hook, payload, env, ctx.cwd);
		if (!result.ok) {
			debug(`Input hook failed (${hook.definition.file}): ${getBlockReason(result, hook)}`);
			continue;
		}

		if (!isRecord(result.parsed)) continue;

		if (result.parsed.action === "handled") {
			return { action: "handled" };
		}

		const hasText = typeof result.parsed.text === "string";
		const hasImages = Array.isArray(result.parsed.images);
		const wantsTransform = result.parsed.action === "transform" || hasText || hasImages;
		if (!wantsTransform) continue;

		if (hasText) currentText = result.parsed.text;
		if (hasImages) currentImages = result.parsed.images as InputEvent["images"];
	}

	if (currentText !== event.text || currentImages !== event.images) {
		return {
			action: "transform",
			text: currentText,
			images: currentImages,
		};
	}

	return undefined;
}

function runBeforeAgentStartHooks(
	hooks: ActiveHook[],
	event: BeforeAgentStartEvent,
	ctx: ExtensionContext,
): BeforeAgentStartEventResult | undefined {
	let currentSystemPrompt = event.systemPrompt;
	let currentMessage: HookCustomMessage | undefined;

	for (const hook of hooks) {
		const payload = {
			...buildBasePayload(hook, ctx),
			prompt: event.prompt,
			images: event.images,
			system_prompt: currentSystemPrompt,
		};
		const env = {
			...buildBaseEnv(hook, ctx),
			PI_PROMPT: truncateForEnv(event.prompt),
			PI_SYSTEM_PROMPT: truncateForEnv(currentSystemPrompt),
			PI_IMAGE_COUNT: String(event.images?.length ?? 0),
		};
		const result = runHookScript(hook, payload, env, ctx.cwd);
		if (!result.ok) {
			debug(`Before-agent-start hook failed (${hook.definition.file}): ${getBlockReason(result, hook)}`);
			continue;
		}
		if (!isRecord(result.parsed)) continue;

		if (Object.prototype.hasOwnProperty.call(result.parsed, "systemPrompt") && typeof result.parsed.systemPrompt === "string") {
			currentSystemPrompt = result.parsed.systemPrompt;
		} else if (typeof result.parsed.systemMessage === "string") {
			currentSystemPrompt = appendTextBlock(currentSystemPrompt, result.parsed.systemMessage);
		}

		const nextMessage = normalizeBeforeAgentStartMessage(result.parsed.message ?? result.parsed.context);
		if (nextMessage) {
			currentMessage = mergeBeforeAgentStartMessages(currentMessage, nextMessage);
		}
	}

	const systemPromptChanged = currentSystemPrompt !== event.systemPrompt;
	if (!systemPromptChanged && !currentMessage) return undefined;

	return {
		systemPrompt: systemPromptChanged ? currentSystemPrompt : undefined,
		message: currentMessage,
	};
}

function runToolCallHooks(
	hooks: ActiveHook[],
	event: ToolCallEvent,
	ctx: ExtensionContext,
): ToolCallEventResult | undefined {
	for (const hook of hooks) {
		const payload = {
			...buildBasePayload(hook, ctx),
			tool_name: getToolName(event),
			tool_call_id: event.toolCallId,
			input: getToolInput(event),
		};
		const env = {
			...buildBaseEnv(hook, ctx),
			PI_TOOL_NAME: getToolName(event),
			PI_TOOL_ARGS: toJsonString(getToolInput(event)),
			PI_TOOL_CALL_ID: event.toolCallId,
		};
		const result = runHookScript(hook, payload, env, ctx.cwd);
		const structured = isRecord(result.parsed) ? result.parsed : undefined;

		if (!result.ok) {
			return buildBlockResponse(getBlockReason(result, hook));
		}

		if (structured && isRecord(structured.input)) {
			replaceToolInput(event.input, structured.input);
		}

		const structuredBlockReason = shouldBlockFromStructuredOutput(structured);
		if (structuredBlockReason) {
			return buildBlockResponse(structuredBlockReason);
		}
	}

	return undefined;
}

function runPreCommitHooks(
	hooks: ActiveHook[],
	event: ToolCallEvent,
	ctx: ExtensionContext,
): ToolCallEventResult | undefined {
	const args = getToolInput(event);
	const command = toSafeString(args.command ?? "").trim();
	const stagedFiles = getStagedFiles(ctx.cwd);
	const commitMessage = extractCommitMessage(command);

	for (const hook of hooks) {
		const payload = {
			...buildBasePayload(hook, ctx),
			tool_name: getToolName(event),
			tool_call_id: event.toolCallId,
			input: args,
			command,
			commit_message: commitMessage,
			staged_files: stagedFiles,
		};
		const env = {
			...buildBaseEnv(hook, ctx),
			PI_TOOL_NAME: getToolName(event),
			PI_TOOL_ARGS: toJsonString(args),
			PI_TOOL_CALL_ID: event.toolCallId,
			PI_COMMIT_MSG: commitMessage,
			PI_FILES: stagedFiles.join("\n"),
		};
		const result = runHookScript(hook, payload, env, ctx.cwd);
		if (!result.ok) {
			return buildBlockResponse(getBlockReason(result, hook));
		}

		const structuredBlockReason = shouldBlockFromStructuredOutput(result.parsed);
		if (structuredBlockReason) {
			return buildBlockResponse(structuredBlockReason);
		}
	}

	return undefined;
}

function runToolResultHooks(
	hooks: ActiveHook[],
	event: ToolResultEvent,
	ctx: ExtensionContext,
): ToolResultEventResult | undefined {
	let currentContent = event.content;
	let currentDetails = event.details;
	let currentIsError = event.isError;
	let modified = false;

	for (const hook of hooks) {
		const textSummary = currentContent
			.filter((part) => part?.type === "text" && typeof (part as { text?: unknown }).text === "string")
			.map((part) => (part as { text: string }).text)
			.join("\n\n");

		const payload = {
			...buildBasePayload(hook, ctx),
			tool_name: getToolName(event),
			tool_call_id: event.toolCallId,
			input: getToolInput(event),
			content: currentContent,
			details: currentDetails,
			is_error: currentIsError,
		};
		const env = {
			...buildBaseEnv(hook, ctx),
			PI_TOOL_NAME: getToolName(event),
			PI_TOOL_ARGS: toJsonString(getToolInput(event)),
			PI_TOOL_CALL_ID: event.toolCallId,
			PI_TOOL_IS_ERROR: currentIsError ? "1" : "0",
			PI_TOOL_RESULT_TEXT: truncateForEnv(textSummary),
			PI_TOOL_RESULT_DETAILS: truncateForEnv(toJsonString(currentDetails ?? null)),
		};
		const result = runHookScript(hook, payload, env, ctx.cwd);
		if (!result.ok) {
			debug(`Tool-result hook failed (${hook.definition.file}): ${getBlockReason(result, hook)}`);
			continue;
		}
		if (!isRecord(result.parsed)) continue;

		const nextContent = normalizeToolContent(result.parsed.content ?? result.parsed.text);
		if (nextContent !== undefined) {
			currentContent = nextContent;
			modified = true;
		}

		if (Object.prototype.hasOwnProperty.call(result.parsed, "details")) {
			currentDetails = result.parsed.details;
			modified = true;
		}

		if (typeof result.parsed.isError === "boolean") {
			currentIsError = result.parsed.isError;
			modified = true;
		}
	}

	if (!modified) return undefined;
	return {
		content: currentContent,
		details: currentDetails,
		isError: currentIsError,
	};
}

function runUserBashHooks(
	hooks: ActiveHook[],
	event: UserBashEvent,
	ctx: ExtensionContext,
): UserBashEventResult | undefined {
	for (const hook of hooks) {
		const payload = {
			...buildBasePayload(hook, ctx),
			command: event.command,
			exclude_from_context: event.excludeFromContext,
			cwd: event.cwd,
		};
		const env = {
			...buildBaseEnv(hook, ctx),
			PI_BASH_COMMAND: event.command,
			PI_USER_BASH_COMMAND: event.command,
			PI_BASH_EXCLUDE_FROM_CONTEXT: event.excludeFromContext ? "1" : "0",
		};
		const result = runHookScript(hook, payload, env, event.cwd || ctx.cwd);
		if (!result.ok) {
			return buildUserBashBlockResult(getBlockReason(result, hook));
		}
		const structured = isRecord(result.parsed) ? result.parsed : undefined;
		const structuredBlockReason = shouldBlockFromStructuredOutput(structured);
		if (structuredBlockReason) {
			return buildUserBashBlockResult(structuredBlockReason);
		}

		const explicitResult = normalizeBashResult(structured?.result ?? structured);
		if (explicitResult) {
			return { result: explicitResult };
		}
	}

	return undefined;
}

export default function hooksExtension(pi: ExtensionAPI): void {
	const rootDir = process.cwd();
	const { activeHooks, roots } = discoverHooks(rootDir);

	const hooksByFile = new Map<HookFile, ActiveHook[]>();
	for (const hook of activeHooks) {
		const existing = hooksByFile.get(hook.definition.file) ?? [];
		existing.push(hook);
		hooksByFile.set(hook.definition.file, existing);
	}

	const sessionStartHooks = hooksByFile.get("session-start.sh") ?? [];
	if (sessionStartHooks.length > 0) {
		pi.on("session_start", (_event, ctx) => {
			runPassiveHooks(
				sessionStartHooks,
				ctx,
				(hook) => ({
					...buildBasePayload(hook, ctx),
					reason: "startup",
				}),
				(hook) => ({
					...buildBaseEnv(hook, ctx),
					PI_SESSION_REASON: "startup",
				}),
			);
		});
	}

	const beforeAgentStartHooks = hooksByFile.get("before-agent-start.sh") ?? [];
	if (beforeAgentStartHooks.length > 0) {
		pi.on("before_agent_start", (event, ctx) => runBeforeAgentStartHooks(beforeAgentStartHooks, event, ctx));
	}

	const inputHooks = hooksByFile.get("input.sh") ?? [];
	if (inputHooks.length > 0) {
		pi.on("input", (event, ctx) => runInputHooks(inputHooks, event, ctx));
	}

	const preToolHooks = hooksByFile.get("pre-tool-use.sh") ?? [];
	const preCommitHooks = hooksByFile.get("pre-commit.sh") ?? [];
	if (preToolHooks.length > 0 || preCommitHooks.length > 0) {
		pi.on("tool_call", (event, ctx) => {
			const preToolResult = runToolCallHooks(preToolHooks, event, ctx);
			if (preToolResult) return preToolResult;

			if (preCommitHooks.length === 0) return undefined;
			if (!isGitCommitCommand(getToolName(event), getToolInput(event))) return undefined;

			return runPreCommitHooks(preCommitHooks, event, ctx);
		});
	}

	const postToolHooks = hooksByFile.get("post-tool-use.sh") ?? [];
	if (postToolHooks.length > 0) {
		pi.on("tool_result", (event, ctx) => runToolResultHooks(postToolHooks, event, ctx));
	}

	const userBashHooks = hooksByFile.get("user-bash.sh") ?? [];
	if (userBashHooks.length > 0) {
		pi.on("user_bash", (event, ctx) => runUserBashHooks(userBashHooks, event, ctx));
	}

	const agentEndHooks = hooksByFile.get("agent-end.sh") ?? [];
	if (agentEndHooks.length > 0) {
		pi.on("agent_end", (event: AgentEndEvent, ctx) => {
			runPassiveHooks(
				agentEndHooks,
				ctx,
				(hook) => ({
					...buildBasePayload(hook, ctx),
					messages: event.messages,
					message_count: event.messages.length,
				}),
				(hook) => ({
					...buildBaseEnv(hook, ctx),
					PI_MESSAGE_COUNT: String(event.messages.length),
				}),
			);
		});
	}

	const turnEndHooks = hooksByFile.get("turn-end.sh") ?? [];
	if (turnEndHooks.length > 0) {
		pi.on("turn_end", (event: TurnEndEvent, ctx) => {
			runPassiveHooks(
				turnEndHooks,
				ctx,
				(hook) => ({
					...buildBasePayload(hook, ctx),
					turn_index: event.turnIndex,
					message: event.message,
					tool_results: event.toolResults,
				}),
				(hook) => ({
					...buildBaseEnv(hook, ctx),
					PI_TURN_INDEX: String(event.turnIndex),
					PI_TOOL_RESULTS_COUNT: String(event.toolResults.length),
				}),
			);
		});
	}

	const sessionStopHooks = hooksByFile.get("session-stop.sh") ?? [];
	if (sessionStopHooks.length > 0) {
		pi.on("session_shutdown", (_event, ctx) => {
			runPassiveHooks(
				sessionStopHooks,
				ctx,
				(hook) => ({
					...buildBasePayload(hook, ctx),
					reason: "shutdown",
				}),
				(hook) => ({
					...buildBaseEnv(hook, ctx),
					PI_SESSION_REASON: "shutdown",
				}),
			);
		});
	}

	pi.registerCommand("hooks", {
		description: "List active shell hooks, search paths, and protocol details",
		async handler(_args: string, ctx: ExtensionCommandContext) {
			const lines: string[] = ["## Active Hooks", ""];
			lines.push(`Timeout: ${getHookTimeoutMs()} ms`);
			lines.push("Structured payload: JSON on stdin for every hook");
			lines.push("Structured control: JSON on stdout for input/before-agent-start/pre-tool/post-tool/user-bash hooks");
			lines.push("");
			lines.push("### Search Paths");
			for (const root of roots) {
				lines.push(`- [${root.scope}${root.legacy ? ", legacy" : ""}] ${root.dir}`);
			}
			lines.push("");

			if (activeHooks.length === 0) {
				lines.push("No executable hook scripts detected.");
			} else {
				lines.push(`Total active hooks: ${activeHooks.length}`);
				lines.push("");

				for (const definition of HOOK_DEFINITIONS) {
					const hooks = hooksByFile.get(definition.file) ?? [];
					if (hooks.length === 0) continue;
					lines.push(
						`### ${definition.file} (${definition.event})${definition.canBlock ? " — can block" : ""}`,
					);
					for (const hook of hooks) {
						lines.push(
							`- [${hook.scope}${hook.legacy ? ", legacy" : ""}] ${hook.path}`,
						);
					}
					lines.push("");
				}
			}

			lines.push("### Structured Output");
			lines.push('- `before-agent-start.sh`: `{ "systemMessage": "..." }`, `{ "systemPrompt": "..." }`, or `{ "message": { ... } }`');
			lines.push('- `input.sh`: `{ "action": "transform", "text": "..." }` or `{ "action": "handled" }`');
			lines.push('- `pre-tool-use.sh` / `pre-commit.sh`: `{ "action": "block", "reason": "..." }`');
			lines.push('- `post-tool-use.sh`: `{ "content": "replacement text", "details": {...}, "isError": false }`');
			lines.push('- `user-bash.sh`: `{ "action": "block", "reason": "..." }` or `{ "result": { "output": "...", "exitCode": 0 } }`');
			lines.push("");
			lines.push("Existing env-var hooks remain supported.");

			const output = lines.join("\n").trim();
			if (ctx?.ui) {
				ctx.ui.notify(output, "info");
			}
			return output;
		},
	});
}
