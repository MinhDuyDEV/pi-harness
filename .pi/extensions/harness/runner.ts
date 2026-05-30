import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { createHarnessResourceLoader, modelLabel, validateThinkingLevel } from "./agents.js";
import type { HarnessTracker } from "./artifacts.js";
import { runInteractivePaneAgent } from "./interactivePane.js";
import { getLastAssistantText } from "./parsing.js";
import type { HarnessWidget, AgentRole } from "./widgets.js";

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
		});
		return { mode: opts.mode, status: "completed", outputText: result.outputText, sessionFile: result.sessionFile, paneId: result.paneId };
	}

	const session = await spawnSdkAgent(opts);
	const stopLog = opts.tracker.startEventLog(opts.subDir, opts.role, session, { phase: opts.phase, agent: opts.agentName });
	try {
		await session.prompt(opts.userPrompt);
	} finally {
		stopLog();
	}
	const outputText = getLastAssistantText(session);
	opts.tracker.saveSession(opts.subDir, opts.role, session, opts.systemPrompt);
	session.dispose();
	return { mode: opts.mode, status: "completed", outputText };
}
