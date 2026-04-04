import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CONFIG_PATH = join(homedir(), ".pi", "remote-questions.json");
const ASK_USER_QUESTION_TOOL = "ask_user_question";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

type Provider = "discord" | "slack";
type PreferredProvider = "auto" | Provider;
type TimeoutMode = "first_option" | "pause";

interface RemoteQuestionOption {
	label: string;
	description?: string;
}

interface RemoteQuestion {
	question: string;
	header: string;
	options: RemoteQuestionOption[];
	multiSelect: boolean;
}

interface RemoteQuestionsConfig {
	enabled: boolean;
	discordWebhookUrl?: string;
	slackWebhookUrl?: string;
	preferredProvider: PreferredProvider;
	channelPreference?: string;
	timeoutMs: number;
	pollIntervalMs: number;
	onTimeout: TimeoutMode;
	responseDir: string;
	pendingDir: string;
}

const DEFAULT_CONFIG: RemoteQuestionsConfig = {
	enabled: true,
	discordWebhookUrl: "",
	slackWebhookUrl: "",
	preferredProvider: "auto",
	channelPreference: "",
	timeoutMs: DEFAULT_TIMEOUT_MS,
	pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
	onTimeout: "first_option",
	responseDir: join(homedir(), ".pi", "remote-questions", "responses"),
	pendingDir: join(homedir(), ".pi", "remote-questions", "pending"),
};

function toBool(value: string | undefined): boolean {
	if (!value) return false;
	return /^(1|true|yes|on)$/i.test(value.trim());
}

function isHeadlessRemoteMode(): boolean {
	return toBool(process.env.PI_HEADLESS) || toBool(process.env.PI_REMOTE_QUESTIONS);
}

function ensureDir(path: string): void {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
}

function ensureConfigDir(): void {
	ensureDir(dirname(CONFIG_PATH));
}

function loadConfig(): RemoteQuestionsConfig {
	try {
		if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };

		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		const config: RemoteQuestionsConfig = {
			...DEFAULT_CONFIG,
			...raw,
		};

		config.timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
			? config.timeoutMs
			: DEFAULT_TIMEOUT_MS;
		const rawPollInterval = Number(config.pollIntervalMs);
		config.pollIntervalMs = Number.isFinite(rawPollInterval) && rawPollInterval >= 100
			? Math.round(rawPollInterval)
			: DEFAULT_POLL_INTERVAL_MS;
		config.responseDir = config.responseDir
			? resolve(config.responseDir)
			: DEFAULT_CONFIG.responseDir;
		config.pendingDir = config.pendingDir
			? resolve(config.pendingDir)
			: DEFAULT_CONFIG.pendingDir;

		return config;
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function saveConfig(config: RemoteQuestionsConfig): void {
	ensureConfigDir();
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function notify(ctx: any, message: string, type: "info" | "warning" | "error" = "info"): void {
	ctx?.ui?.notify?.(message, type);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function makeRequestId(): string {
	const rand = Math.random().toString(36).slice(2, 8);
	return `rq-${Date.now()}-${rand}`;
}

function pickProvider(config: RemoteQuestionsConfig): Provider | undefined {
	if (config.preferredProvider === "discord" && config.discordWebhookUrl) return "discord";
	if (config.preferredProvider === "slack" && config.slackWebhookUrl) return "slack";
	if (config.discordWebhookUrl) return "discord";
	if (config.slackWebhookUrl) return "slack";
	return undefined;
}

function getWebhookUrl(config: RemoteQuestionsConfig, provider: Provider): string {
	return provider === "discord"
		? (config.discordWebhookUrl ?? "")
		: (config.slackWebhookUrl ?? "");
}

function formatQuestionBlock(q: RemoteQuestion, index: number): string {
	const optionLines = q.options
		.map((option, optionIndex) => {
			const description = option.description ? ` — ${option.description}` : "";
			return `  ${optionIndex + 1}. ${option.label}${description}`;
		})
		.join("\n");

	return [
		`Q${index + 1} [${q.header}] ${q.question}`,
		optionLines,
		`  Multi-select: ${q.multiSelect ? "yes" : "no"}`,
	].join("\n");
}

function buildWebhookMessage(
	requestId: string,
	questions: RemoteQuestion[],
	responseFile: string,
	config: RemoteQuestionsConfig,
): string {
	const questionText = questions
		.map((q, index) => formatQuestionBlock(q, index))
		.join("\n\n");

	const channelLine = config.channelPreference
		? `Channel preference: ${config.channelPreference}\n`
		: "";

	return [
		"🤖 Pi needs human input (headless AskUserQuestion)",
		`Request ID: ${requestId}`,
		channelLine,
		"Questions:",
		questionText,
		"",
		"Respond by creating this JSON file:",
		responseFile,
		"",
		"Example:",
		"{",
		"  \"answers\": {",
		`    \"${questions[0]?.question ?? "Question text"}\": \"${questions[0]?.options?.[0]?.label ?? "Option label"}\"`,
		"  }",
		"}",
	].join("\n");
}

async function postWebhook(
	provider: Provider,
	url: string,
	message: string,
	channelPreference: string | undefined,
): Promise<void> {
	if (!url) {
		throw new Error(`Missing ${provider} webhook URL`);
	}

	const body = provider === "discord"
		? {
			username: "Pi Remote Questions",
			content: message,
		}
		: {
			text: message,
			...(channelPreference ? { channel: channelPreference } : {}),
		};

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`${provider} webhook failed (${response.status}): ${text || response.statusText}`);
	}
}

function parseAnswersFromResponse(
	parsed: any,
	questions: RemoteQuestion[],
): Record<string, string> | undefined {
	const rawAnswers = parsed?.answers;
	if (!rawAnswers) return undefined;

	const answers: Record<string, string> = {};

	if (Array.isArray(rawAnswers)) {
		for (let i = 0; i < questions.length; i++) {
			const value = rawAnswers[i];
			if (value === undefined || value === null) continue;
			answers[questions[i].question] = Array.isArray(value)
				? value.join(", ")
				: String(value);
		}
		return answers;
	}

	if (typeof rawAnswers !== "object") {
		return undefined;
	}

	for (let i = 0; i < questions.length; i++) {
		const question = questions[i];
		const direct = rawAnswers[question.question];
		const byHeader = rawAnswers[question.header];
		const byIndex = rawAnswers[String(i)];
		const value = direct ?? byHeader ?? byIndex;
		if (value === undefined || value === null) continue;
		answers[question.question] = Array.isArray(value)
			? value.join(", ")
			: String(value);
	}

	return answers;
}

function normalizeAnswer(question: RemoteQuestion, value: string | undefined): string {
	if (!value) return question.options[0]?.label ?? "";

	const labels = question.options.map((option) => option.label);
	const matchLabel = (candidate: string): string | undefined => {
		return labels.find((label) => label.toLowerCase() === candidate.toLowerCase());
	};

	if (!question.multiSelect) {
		const matched = matchLabel(value.trim());
		return matched ?? question.options[0]?.label ?? value.trim();
	}

	const parts = value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);

	const selected = parts
		.map((part) => matchLabel(part))
		.filter((item): item is string => Boolean(item));

	if (selected.length === 0) {
		return question.options[0]?.label ?? "";
	}

	return selected.join(", ");
}

function fallbackAnswers(questions: RemoteQuestion[]): Record<string, string> {
	const answers: Record<string, string> = {};
	for (const question of questions) {
		answers[question.question] = question.options[0]?.label ?? "";
	}
	return answers;
}

function buildSummaryLines(
	questions: RemoteQuestion[],
	answers: Record<string, string>,
): string {
	return questions
		.map((question) => `${question.header}: ${answers[question.question] ?? "(no answer)"}`)
		.join("\n");
}

function blockWithRemoteResult(result: any, message: string): any {
	return {
		blocked: true,
		message,
		result,
	};
}

async function waitForResponse(
	responseFile: string,
	questions: RemoteQuestion[],
	timeoutMs: number,
	pollIntervalMs: number,
): Promise<Record<string, string> | undefined> {
	const deadline = Date.now() + timeoutMs;
	const safePollIntervalMs = Math.max(100, pollIntervalMs);

	while (true) {
		try {
			await access(responseFile);
			try {
				const parsed = JSON.parse(await readFile(responseFile, "utf8"));
				const parsedAnswers = parseAnswersFromResponse(parsed, questions);
				if (!parsedAnswers) {
					await sleep(Math.min(safePollIntervalMs, 1000));
					continue;
				}

				const normalized: Record<string, string> = {};
				for (const question of questions) {
					normalized[question.question] = normalizeAnswer(
						question,
						parsedAnswers[question.question],
					);
				}

				await unlink(responseFile).catch(() => {});
				return normalized;
			} catch {
				// Invalid JSON while human is editing the file — keep polling.
			}
		} catch {
			// No response file yet.
		}

		const now = Date.now();
		if (now >= deadline) {
			break;
		}

		const remainingMs = deadline - now;
		await sleep(Math.min(safePollIntervalMs, remainingMs));
	}

	return undefined;
}

function isAskUserQuestionTool(toolName: string): boolean {
	const normalized = toolName.trim().toLowerCase();
	return normalized === ASK_USER_QUESTION_TOOL || normalized === "askuserquestion";
}

function ensureAskUserQuestionToolEnabled(pi: any): void {
	try {
		const getActiveTools = pi?.getActiveTools;
		const getAllTools = pi?.getAllTools;
		const setActiveTools = pi?.setActiveTools;
		if (
			typeof getActiveTools !== "function" ||
			typeof getAllTools !== "function" ||
			typeof setActiveTools !== "function"
		) {
			return;
		}

		const activeTools = getActiveTools.call(pi);
		if (!Array.isArray(activeTools)) return;
		if (activeTools.includes(ASK_USER_QUESTION_TOOL)) return;

		const allTools = getAllTools.call(pi);
		const hasAskTool = Array.isArray(allTools) && allTools.some((tool: any) => {
			if (typeof tool === "string") return tool === ASK_USER_QUESTION_TOOL;
			return tool?.name === ASK_USER_QUESTION_TOOL;
		});
		if (!hasAskTool) return;

		setActiveTools.call(pi, [...activeTools, ASK_USER_QUESTION_TOOL]);
	} catch {
		// Best-effort: if runtime API differs, skip silently.
	}
}

function parseSeconds(raw: string | undefined, fallbackMs: number): number {
	if (!raw) return Math.round(fallbackMs / 1000);
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return Math.round(fallbackMs / 1000);
	return Math.round(parsed);
}

function commandHelp(): string {
	return [
		"## /remote",
		"",
		"Commands:",
		"  /remote status",
		"  /remote enable | disable",
		"  /remote set discord <webhook-url>",
		"  /remote set slack <webhook-url>",
		"  /remote set provider <auto|discord|slack>",
		"  /remote set channel <name>",
		"  /remote set timeout <seconds>",
		"  /remote set poll <seconds>",
		"  /remote set fallback <first|pause>",
		"  /remote set response-dir <path>",
		"  /remote set pending-dir <path>",
		"  /remote clear <discord|slack|all>",
		"",
		`Config file: ${CONFIG_PATH}`,
	].join("\n");
}

export default function remoteQuestionsExtension(pi: any): void {
	let config = loadConfig();
	ensureDir(config.responseDir);
	ensureDir(config.pendingDir);

	const refreshAskToolState = () => {
		if (!config.enabled) return;
		if (!isHeadlessRemoteMode()) return;
		ensureAskUserQuestionToolEnabled(pi);
	};

	pi.on("session_start", refreshAskToolState);
	pi.on("turn_start", refreshAskToolState);
	refreshAskToolState();

	pi.registerCommand("remote", {
		description: "Configure remote AskUserQuestion delivery in headless mode",
		async handler(args: string, ctx: any) {
			const trimmed = (args ?? "").trim();
			const parts = trimmed.length === 0 ? [] : trimmed.split(/\s+/g);
			const [command, subcommand, ...rest] = parts;

			if (!command || command === "status") {
				const lines = [
					"## Remote Questions Status",
					`enabled: ${config.enabled ? "yes" : "no"}`,
					`headless env active: ${isHeadlessRemoteMode() ? "yes" : "no"}`,
					`preferred provider: ${config.preferredProvider}`,
					`discord webhook: ${config.discordWebhookUrl ? "configured" : "not set"}`,
					`slack webhook: ${config.slackWebhookUrl ? "configured" : "not set"}`,
					`channel preference: ${config.channelPreference || "(none)"}`,
					`timeout: ${Math.round(config.timeoutMs / 1000)}s`,
					`poll interval: ${Math.round(config.pollIntervalMs / 1000)}s`,
					`on-timeout: ${config.onTimeout}`,
					`pending dir: ${config.pendingDir}`,
					`response dir: ${config.responseDir}`,
					`config path: ${CONFIG_PATH}`,
				];
				const output = lines.join("\n");
				notify(ctx, output);
				return output;
			}

			if (command === "enable") {
				config.enabled = true;
				saveConfig(config);
				refreshAskToolState();
				const output = "[remote] Enabled.";
				notify(ctx, output);
				return output;
			}

			if (command === "disable") {
				config.enabled = false;
				saveConfig(config);
				const output = "[remote] Disabled.";
				notify(ctx, output, "warning");
				return output;
			}

			if (command === "set") {
				const value = rest.join(" ");
				switch (subcommand) {
					case "discord":
						config.discordWebhookUrl = value;
						break;
					case "slack":
						config.slackWebhookUrl = value;
						break;
					case "provider":
						if (value !== "auto" && value !== "discord" && value !== "slack") {
							return notify(ctx, "[remote] provider must be auto|discord|slack", "error");
						}
						config.preferredProvider = value;
						break;
					case "channel":
						config.channelPreference = value;
						break;
					case "timeout": {
						const seconds = parseSeconds(value, config.timeoutMs);
						config.timeoutMs = seconds * 1000;
						break;
					}
					case "poll": {
						const seconds = parseSeconds(value, config.pollIntervalMs);
						config.pollIntervalMs = Math.max(500, seconds * 1000);
						break;
					}
					case "fallback":
						if (value !== "first" && value !== "pause") {
							return notify(ctx, "[remote] fallback must be first|pause", "error");
						}
						config.onTimeout = value === "first" ? "first_option" : "pause";
						break;
					case "response-dir":
						if (!value) return notify(ctx, "[remote] response-dir requires a path", "error");
						config.responseDir = resolve(value);
						ensureDir(config.responseDir);
						break;
					case "pending-dir":
						if (!value) return notify(ctx, "[remote] pending-dir requires a path", "error");
						config.pendingDir = resolve(value);
						ensureDir(config.pendingDir);
						break;
					default:
						notify(ctx, commandHelp(), "warning");
						return;
				}

				saveConfig(config);
				refreshAskToolState();
				const output = `[remote] Updated ${subcommand}.`;
				notify(ctx, output);
				return output;
			}

			if (command === "clear") {
				if (subcommand !== "discord" && subcommand !== "slack" && subcommand !== "all") {
					return notify(ctx, "[remote] clear must be discord|slack|all", "error");
				}
				if (subcommand === "discord" || subcommand === "all") config.discordWebhookUrl = "";
				if (subcommand === "slack" || subcommand === "all") config.slackWebhookUrl = "";
				saveConfig(config);
				refreshAskToolState();
				const output = `[remote] Cleared ${subcommand}.`;
				notify(ctx, output);
				return output;
			}

			notify(ctx, commandHelp(), "warning");
		},
	});

	pi.on("before_tool_call", async (event: any, ctx: any) => {
		const toolName = event?.toolName ?? event?.name ?? "";
		if (!isAskUserQuestionTool(toolName)) return;
		if (!config.enabled) return;
		if (!isHeadlessRemoteMode()) return;

		// ask_user_question disables itself when no UI is available.
		// Re-enable it so subsequent turns can still request remote clarification.
		ensureAskUserQuestionToolEnabled(pi);

		const input = event?.input ?? event?.params;
		const questions = (input?.questions ?? []) as RemoteQuestion[];
		if (!Array.isArray(questions) || questions.length === 0) return;

		const provider = pickProvider(config);
		if (!provider) {
			const message =
				"AskUserQuestion called in headless mode, but no webhook is configured. Use /remote set discord <url> or /remote set slack <url>.";
			notify(ctx, `[remote] ${message}`, "warning");
			return blockWithRemoteResult(
				{
					content: [{ type: "text", text: message }],
					details: {
						questions,
						answers: {},
						cancelled: true,
						remote: true,
						misconfigured: true,
					},
					isError: true,
				},
				`[remote] ${message}`,
			);
		}

		const requestId = makeRequestId();
		const responseFile = join(config.responseDir, `${requestId}.json`);
		const pendingFile = join(config.pendingDir, `${requestId}.json`);
		const webhookUrl = getWebhookUrl(config, provider);

		ensureDir(config.pendingDir);
		ensureDir(config.responseDir);

		const pendingPayload = {
			requestId,
			provider,
			createdAt: new Date().toISOString(),
			questions,
			responseFile,
		};
		await writeFile(pendingFile, JSON.stringify(pendingPayload, null, 2)).catch(() => {});

		try {
			const webhookMessage = buildWebhookMessage(requestId, questions, responseFile, config);
			await postWebhook(provider, webhookUrl, webhookMessage, config.channelPreference);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const notifyMessage = `[remote] Failed to post webhook: ${message}`;
			notify(ctx, notifyMessage, "error");
			await unlink(pendingFile).catch(() => {});
			return blockWithRemoteResult(
				{
					content: [{ type: "text", text: `Remote question delivery failed: ${message}` }],
					details: {
						questions,
						answers: {},
						cancelled: true,
						remote: true,
						requestId,
					},
					isError: true,
				},
				notifyMessage,
			);
		}

		notify(ctx, `[remote] Question posted to ${provider}. Waiting for response (${Math.round(config.timeoutMs / 1000)}s).`);

		const remoteAnswers = await waitForResponse(
			responseFile,
			questions,
			config.timeoutMs,
			config.pollIntervalMs,
		);

		if (!remoteAnswers) {
			if (config.onTimeout === "pause") {
				const timeoutMessage = `[remote] Timed out waiting for response for ${requestId}.`;
				notify(ctx, timeoutMessage, "warning");
				await unlink(pendingFile).catch(() => {});
				return blockWithRemoteResult(
					{
						content: [{ type: "text", text: `Remote response timeout after ${Math.round(config.timeoutMs / 1000)}s (request ${requestId}).` }],
						details: {
							questions,
							answers: {},
							cancelled: true,
							remote: true,
							timeout: true,
							requestId,
						},
						isError: true,
					},
					timeoutMessage,
				);
			}

			const fallback = fallbackAnswers(questions);
			const summary = buildSummaryLines(questions, fallback);
			const timeoutFallbackMessage =
				`[remote] Timed out waiting for response for ${requestId}; using first-option fallback.`;
			notify(ctx, timeoutFallbackMessage, "warning");
			await unlink(pendingFile).catch(() => {});
			return blockWithRemoteResult(
				{
					content: [{ type: "text", text: summary }],
					details: {
						questions,
						answers: fallback,
						cancelled: false,
						remote: true,
						timeout: true,
						requestId,
						fallback: "first_option",
					},
				},
				timeoutFallbackMessage,
			);
		}

		const summary = buildSummaryLines(questions, remoteAnswers);
		const successMessage = `[remote] Received remote response for ${requestId}.`;
		notify(ctx, successMessage);

		await unlink(pendingFile).catch(() => {});

		return blockWithRemoteResult(
			{
				content: [{ type: "text", text: summary }],
				details: {
					questions,
					answers: remoteAnswers,
					cancelled: false,
					remote: true,
					requestId,
					provider,
				},
			},
			successMessage,
		);
	});
}
