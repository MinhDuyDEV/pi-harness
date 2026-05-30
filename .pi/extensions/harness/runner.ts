import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { createHarnessResourceLoader, modelLabel, validateThinkingLevel } from "./agents.js";
import type { HarnessTracker } from "./artifacts.js";
import { runInteractivePaneAgent } from "./interactivePane.js";
import { getLastAssistantText } from "./parsing.js";
import type { HarnessWidget, AgentRole } from "./widgets.js";
import { sessionUsage } from "./widgets.js";

export type AgentRunnerMode = "sdk" | "interactive-pane";

export interface HarnessAgentRunRequest {
	mode: AgentRunnerMode;
	projectRoot: string;
	runCwd: string;
	runDir: string;
	subDir: string;
	agentName: string;
	role: AgentRole;
	phase: string;
	systemPrompt: string;
	userPrompt: string;
	tools: string[];
	model: Model<Api>;
	thinking?: string;
	tracker: HarnessTracker;
	widget: HarnessWidget;
	signal?: AbortSignal;
}

export interface HarnessAgentRunResult {
	mode: AgentRunnerMode;
	status: "completed";
	outputText: string;
	sessionFile?: string;
	paneId?: string;
	/** Session usage metrics for the widget, always populated even if events were missed. */
	usage: { turnCount: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number };
}

async function spawnSdkAgent(opts: HarnessAgentRunRequest): Promise<AgentSession> {
	const resourceLoader = await createHarnessResourceLoader(opts.systemPrompt, opts.runCwd);
	const { session } = await createAgentSession({
		model: opts.model,
		tools: opts.tools,
		thinkingLevel: validateThinkingLevel(opts.thinking),
		sessionManager: SessionManager.inMemory(opts.runCwd),
		resourceLoader,
		cwd: opts.runCwd,
	});
	opts.widget.trackSession(session, opts.agentName, {
		role: opts.role,
		model: modelLabel(opts.model),
		thinking: opts.thinking,
	});
	return session;
}

export async function runHarnessAgent(opts: HarnessAgentRunRequest): Promise<HarnessAgentRunResult> {
	if (opts.mode === "interactive-pane") {
		const result = await runInteractivePaneAgent({
			projectRoot: opts.projectRoot,
			runCwd: opts.runCwd,
			runDir: opts.runDir,
			subDir: opts.subDir,
			agentName: opts.agentName,
			role: opts.role,
			systemPrompt: opts.systemPrompt,
			userPrompt: opts.userPrompt,
			tools: opts.tools,
			model: opts.model,
			thinking: opts.thinking,
			signal: opts.signal,
			onUsage: (usage) => opts.widget.update({
				agentName: opts.agentName,
				agentRole: opts.role,
				agentModel: modelLabel(opts.model),
				agentThinking: opts.thinking ?? "",
				...usage,
			}),
		});
		return { mode: opts.mode, status: "completed", outputText: result.outputText, sessionFile: result.sessionFile, paneId: result.paneId, usage: { turnCount: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 } };
	}

	// The SDK's built-in tools (write, edit, bash) resolve relative paths against
	// process.cwd(). Since the pi process may have cwd set to .pi/ instead of the
	// project root, temporarily set process.cwd() to runCwd so tool calls from the
	// agent session create files at the correct location.
	const originalCwd = process.cwd();
	if (originalCwd !== opts.runCwd) {
		process.chdir(opts.runCwd);
	}

	const session = await spawnSdkAgent(opts);
	const stopLog = opts.tracker.startEventLog(opts.subDir, opts.role, session, { phase: opts.phase, agent: opts.agentName });
	try {
		await session.prompt(opts.userPrompt);
	} finally {
		stopLog();
		// Restore original process cwd
		if (originalCwd !== opts.runCwd) {
			process.chdir(originalCwd);
		}
	}
	const outputText = getLastAssistantText(session);
	const usage = sessionUsage(session);
	opts.tracker.saveSession(opts.subDir, opts.role, session, opts.systemPrompt);
	session.dispose();
	return { mode: opts.mode, status: "completed", outputText, usage };
}
