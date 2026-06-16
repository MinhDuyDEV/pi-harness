import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { modelLabel } from "./agents.js";

export interface InteractivePaneUsageSnapshot {
	turnCount: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
}

export interface InteractivePaneRunOptions {
	projectRoot: string;
	runCwd: string;
	runDir: string;
	subDir: string;
	agentName: string;
	role: string;
	systemPrompt: string;
	userPrompt: string;
	tools: string[];
	model: Model<Api>;
	thinking?: string;
	signal?: AbortSignal;
	onUsage?: (usage: InteractivePaneUsageSnapshot) => void;
}

export interface InteractivePaneRunResult {
	outputText: string;
	sessionFile?: string;
	paneId?: string;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function runTmux(args: string[]): string {
	return execFileSync("tmux", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tmuxPaneExists(paneId: string): boolean {
	try {
		return runTmux(["list-panes", "-a", "-F", "#{pane_id}"]).split("\n").includes(paneId);
	} catch {
		return false;
	}
}

function closeAgentPane(paneId: string, originalPane: string, agentDir: string): void {
	let closed = false;
	try {
		if (tmuxPaneExists(paneId)) {
			runTmux(["kill-pane", "-t", paneId]);
			closed = true;
		}
	} catch (error) {
		writeFileSync(join(agentDir, "PANE-CLOSE-ERROR.txt"), String(error), "utf-8");
	} finally {
		try {
			if (tmuxPaneExists(originalPane)) runTmux(["select-pane", "-t", originalPane]);
		} catch {
			// best-effort: keep the user's main pi pane focused
		}
	}
	writeFileSync(join(agentDir, "PANE-CLOSED.txt"), closed ? "closed" : "already-closed", "utf-8");
}

export function isInsideTmux(): boolean {
	return Boolean(process.env.TMUX);
}

function listJsonlFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) out.push(...listJsonlFiles(path));
		else if (entry.endsWith(".jsonl")) out.push(path);
	}
	return out.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (part && typeof part === "object" && "type" in part && (part as { type?: unknown }).type === "text") {
				return String((part as { text?: unknown }).text ?? "");
			}
			return "";
		})
		.join("");
}

type SessionEntry = { type?: unknown; message?: { role?: unknown; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } } } };

function readJsonlEntries(sessionFile: string): SessionEntry[] {
	const raw = readFileSync(sessionFile, "utf-8").trim();
	if (!raw) return [];
	const entries: SessionEntry[] = [];
	for (const line of raw.split("\n")) {
		try {
			entries.push(JSON.parse(line));
		} catch {
			// Ignore partially-written or malformed lines while polling.
		}
	}
	return entries;
}

export function readInteractivePaneUsage(sessionFile: string): InteractivePaneUsageSnapshot {
	const usage: InteractivePaneUsageSnapshot = {
		turnCount: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost: 0,
	};
	for (const entry of readJsonlEntries(sessionFile)) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "assistant") continue;
		usage.turnCount++;
		if (!message.usage) continue;
		usage.inputTokens += message.usage.input || 0;
		usage.outputTokens += message.usage.output || 0;
		usage.cacheReadTokens += message.usage.cacheRead || 0;
		usage.cacheWriteTokens += message.usage.cacheWrite || 0;
		usage.totalCost += message.usage.cost?.total || 0;
	}
	return usage;
}

function sameUsage(a: InteractivePaneUsageSnapshot | undefined, b: InteractivePaneUsageSnapshot): boolean {
	if (!a) return false;
	return a.turnCount === b.turnCount && a.inputTokens === b.inputTokens && a.outputTokens === b.outputTokens && a.cacheReadTokens === b.cacheReadTokens && a.cacheWriteTokens === b.cacheWriteTokens && a.totalCost === b.totalCost;
}

function readCompletedAssistant(sessionFile: string): string | null {
	const entries = readJsonlEntries(sessionFile);
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "message") continue;
		const message = entry.message as { role?: unknown; stopReason?: unknown; content?: unknown } | undefined;
		if (message?.role !== "assistant") continue;
		if (message.stopReason === "toolUse") continue;
		return extractText(message.content);
	}
	return null;
}

async function waitForCompletion(sessionDir: string, signal?: AbortSignal, onUsage?: (usage: InteractivePaneUsageSnapshot) => void): Promise<{ outputText: string; sessionFile?: string }> {
	const started = Date.now();
	const timeoutMs = 30 * 60 * 1000;
	let lastUsage: InteractivePaneUsageSnapshot | undefined;
	while (Date.now() - started < timeoutMs) {
		if (signal?.aborted) throw new Error("Interactive pi pane run aborted");
		const files = listJsonlFiles(sessionDir);
		for (const file of files) {
			if (onUsage) {
				const usage = readInteractivePaneUsage(file);
				if (!sameUsage(lastUsage, usage)) {
					lastUsage = usage;
					onUsage(usage);
				}
			}
			const outputText = readCompletedAssistant(file);
			if (outputText !== null) return { outputText, sessionFile: file };
		}
		await new Promise((resolve) => setTimeout(resolve, 750));
	}
	throw new Error(`Timed out waiting for interactive pi session in ${sessionDir}`);
}

export async function runInteractivePaneAgent(opts: InteractivePaneRunOptions): Promise<InteractivePaneRunResult> {
	if (!isInsideTmux()) {
		throw new Error("Interactive pane agents require running pi inside tmux");
	}

	const agentDir = join(opts.runDir, opts.subDir);
	const sessionDir = join(agentDir, "sessions");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(sessionDir, { recursive: true });

	const systemPath = join(agentDir, "SYSTEM-PROMPT.txt");
	const promptPath = join(agentDir, "USER-PROMPT.md");
	writeFileSync(systemPath, opts.systemPrompt, "utf-8");
	writeFileSync(promptPath, opts.userPrompt, "utf-8");

	const args = [
		"pi",
		"--name", shellQuote(`harness ${opts.role}: ${opts.agentName}`),
		"--session-dir", shellQuote(sessionDir),
		"--tools", shellQuote(opts.tools.join(",")),
		"--model", shellQuote(modelLabel(opts.model)),
		"--system-prompt", shellQuote(systemPath),
	];
	if (opts.thinking) args.push("--thinking", shellQuote(opts.thinking));
	args.push(shellQuote(`@${promptPath}`));

	const title = `harness ${opts.role}`.replace(/[^a-zA-Z0-9 _:-]/g, "").slice(0, 40);
	const script = [
		`printf '\\033]2;${title}\\033\\\\'`,
		`cd ${shellQuote(opts.runCwd)}`,
		args.join(" "),
	].join("; ");

	const originalPane = runTmux(["display-message", "-p", "#{pane_id}"]);
	const paneId = runTmux(["split-window", "-h", "-P", "-F", "#{pane_id}", "-c", opts.runCwd, `bash -lc ${shellQuote(script)}`]);
	writeFileSync(join(agentDir, "PANE.txt"), paneId, "utf-8");
	try {
		runTmux(["select-layout", "tiled"]);
		runTmux(["select-pane", "-t", originalPane]);
	} catch {
		// best-effort: keep the user's main pi pane focused
	}

	try {
		const result = await waitForCompletion(sessionDir, opts.signal, opts.onUsage);
		writeFileSync(join(agentDir, "OUTPUT.md"), result.outputText, "utf-8");
		if (result.sessionFile) writeFileSync(join(agentDir, "SESSION-FILE.txt"), result.sessionFile, "utf-8");
		return { ...result, paneId };
	} finally {
		closeAgentPane(paneId, originalPane, agentDir);
	}
}
