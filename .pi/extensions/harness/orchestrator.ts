/**
 * Execution orchestration for the Harness extension.
 *
 * Coordinates planning, implementation, verification, and progress updates
 * while preserving worktree isolation and git safety guarantees.
 *
 * Extracted from index.ts to remove duplicate agent lifecycle patterns,
 * consolidate error handling, and centralize progress/reporting logic.
 */

import type { ExtensionContext, AgentSession, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Model, Api, TextContent } from "@earendil-works/pi-ai";
import {
	parseSprints,
	parseEvalOutput,
	getLastAssistantText,
	HARNESS_FORMAT_INSTRUCTIONS,
	HARNESS_EVAL_INSTRUCTIONS,
	type Sprint,
	type SprintResult,
} from "./parsing.js";
import {
	generateWorkflowScript,
	HarnessTracker,
	writeProgress,
} from "./artifacts.js";
import {
	validateThinkingLevel,
	loadContextFiles,
	wrapWithContext,
	loadAgentFile,
	modelLabel,
	resolveModel,
	createHarnessResourceLoader,
	DEFAULT_PLANNER_PROMPT,
	DEFAULT_GENERATOR_PROMPT,
	DEFAULT_EVALUATOR_PROMPT,
	DEFAULT_PLANNER_TOOLS,
	DEFAULT_GENERATOR_TOOLS,
	DEFAULT_EVALUATOR_TOOLS,
} from "./agents.js";
import { HarnessWidget, type AgentRole } from "./widgets.js";
import { createHarnessWorkspace, type HarnessWorkspace, type HarnessWorkspaceMode } from "./gitSafety.js";
import { resolveSkillHints } from "./skills.js";
import { startHarnessTmuxWatch, type HarnessTmuxWatch } from "./tmuxWatch.js";
import { isInsideTmux, runInteractivePaneAgent } from "./interactivePane.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentDef {
	systemPrompt: string;
	tools: string[];
	model?: string;
	thinking?: string;
}

export interface HarnessRunParams {
	prompt: string;
	iterations: number;
	pattern: string;
	plannerAgent: string;
	generatorAgent: string;
	evaluatorAgent: string;
	plannerModel?: string;
	generatorModel?: string;
	evaluatorModel?: string;
	inheritContext: boolean;
	tmuxMode: "off" | "watch";
	workspace: HarnessWorkspaceMode;
}

export interface HarnessContext {
	cwd: string;
	projectRoot: string;
	model: Model<Api>;
	modelRegistry?: { find: (provider: string, modelId: string) => Model<Api> | undefined };
	signal?: AbortSignal;
	onUpdate?: AgentToolUpdateCallback<Record<string, unknown>>;
	ctx: ExtensionContext;
	availableToolNames?: Set<string>;
}

export interface HarnessResult {
	content: TextContent[];
	details: Record<string, unknown>;
	isError?: boolean;
}

// ─── Agent Definition Loading ────────────────────────────────────────────────

/**
 * Load an agent definition from file or fall back to defaults.
 * Duplicate pattern removed from index.ts by centralizing here.
 */
function loadAgentDef(
	name: string,
	defaultName: string,
	defaultPrompt: string,
	defaultTools: string[],
	projectRoot: string,
	contextFiles: { agents: string; append: string },
	warnings: string[],
	availableToolNames: Set<string>,
): AgentDef {
	const file = loadAgentFile(name, projectRoot);
	if (!file && name !== defaultName) {
		warnings.push(`Agent "${name}" was not found; falling back to built-in ${defaultName} prompt.`);
	}
	const base = file ? file.systemPrompt : defaultPrompt;
	const requestedTools = file ? file.tools : defaultTools;
	const tools = requestedTools.filter((tool) => {
		if (availableToolNames.size === 0 || availableToolNames.has(tool)) return true;
		warnings.push(`Agent "${name}" requested unavailable tool "${tool}"; it will not be enabled.`);
		return false;
	});
	return {
		systemPrompt: wrapWithContext(base, contextFiles),
		tools,
		model: file?.model,
		thinking: file?.thinking,
	};
}

// ─── Agent Session Spawning ──────────────────────────────────────────────────

/**
 * Create a sub-agent session and register it with the widget.
 * Duplicate spawn / track / dispose pattern consolidated here.
 */
async function spawnAgent(
	opts: {
		systemPrompt: string;
		tools: string[];
		model: Model<Api>;
		thinking?: string;
		agentName: string;
		role: AgentRole;
		runCwd: string;
		widget: HarnessWidget;
	},
): Promise<AgentSession> {
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

// ─── Error Handling ──────────────────────────────────────────────────────────

class HarnessAbortError extends Error {
	constructor() {
		super("Harness run aborted");
		this.name = "HarnessAbortError";
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new HarnessAbortError();
}

// ─── Model Resolution ────────────────────────────────────────────────────────

function resolveAllModels(
	params: HarnessRunParams,
	mainModel: Model<Api>,
	plannerDef: AgentDef,
	generatorDef: AgentDef,
	evaluatorDef: AgentDef,
	warnings: string[],
	modelRegistry?: { find: (provider: string, modelId: string) => Model<Api> | undefined },
): { planner: Model<Api>; generator: Model<Api>; evaluator: Model<Api> } {
	return {
		planner: resolveModel(params.plannerModel ?? plannerDef.model, mainModel, "planner", warnings, modelRegistry),
		generator: resolveModel(params.generatorModel ?? generatorDef.model, mainModel, "generator", warnings, modelRegistry),
		evaluator: resolveModel(params.evaluatorModel ?? evaluatorDef.model, mainModel, "evaluator", warnings, modelRegistry),
	};
}

// ─── Phase Notifications ─────────────────────────────────────────────────────

function notify(
	onUpdate: HarnessContext["onUpdate"],
	text: string,
	details: Record<string, unknown> = {},
): void {
	onUpdate?.({
		content: [{ type: "text" as const, text }],
		details,
	});
}

// ─── Interactive Pane Mode ───────────────────────────────────────────────────

function shouldUseInteractivePanes(params: HarnessRunParams): boolean {
	return params.tmuxMode === "watch" && isInsideTmux();
}

// ─── Phase 1: Planning ───────────────────────────────────────────────────────

async function runPlanningPhase(
	prompt: string,
	plannerAgentName: string,
	plannerDef: AgentDef,
	resolvedPlannerModel: Model<Api>,
	runCwd: string,
	widget: HarnessWidget,
	tracker: HarnessTracker,
	pattern: string,
	projectRoot: string,
	useInteractivePanes: boolean,
	signal?: AbortSignal,
	onUpdate?: HarnessContext["onUpdate"],
): Promise<{ specText: string; sprints: Sprint[] }> {
	notify(onUpdate, `[Start] Harness (${pattern}): Planning phase using "${plannerAgentName}" agent...`, { phase: "planning" });

	widget.startSpinner();
	widget.update({
		phase: "planning",
		agentName: plannerAgentName,
		agentRole: "planner",
		agentModel: modelLabel(resolvedPlannerModel),
		agentThinking: plannerDef.thinking ?? "",
		activeTools: [],
		turnCount: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost: 0,
	});

	tracker.startPhase("planning", plannerAgentName);
	tracker.savePrompt("planner-system", plannerDef.systemPrompt);
	tracker.savePrompt("planner-user", prompt);
	tracker.saveSystemPrompt("plan", "planner", plannerDef.systemPrompt);
	throwIfAborted(signal);

	let specText: string;
	if (useInteractivePanes) {
		const result = await runInteractivePaneAgent({
			projectRoot,
			runCwd,
			runDir: tracker.runDir,
			subDir: "plan/planner",
			agentName: plannerAgentName,
			role: "planner",
			systemPrompt: plannerDef.systemPrompt,
			userPrompt: prompt,
			tools: plannerDef.tools,
			model: resolvedPlannerModel,
			thinking: plannerDef.thinking,
			signal,
		});
		specText = result.outputText;
	} else {
		const planner = await spawnAgent({
			systemPrompt: plannerDef.systemPrompt,
			tools: plannerDef.tools,
			model: resolvedPlannerModel,
			thinking: plannerDef.thinking,
			agentName: plannerAgentName,
			role: "planner",
			runCwd,
			widget,
		});
		const stopPlannerLog = tracker.startEventLog("plan", "planner", planner, { phase: "planning", agent: plannerAgentName });
		try {
			await planner.prompt(prompt);
		} finally {
			stopPlannerLog();
		}
		specText = getLastAssistantText(planner);
		tracker.saveSession("plan", "planner", planner, plannerDef.systemPrompt);
		planner.dispose();
	}
	tracker.saveSpec(specText);

	const sprints = parseSprints(specText);
	return { specText, sprints };
}

// ─── Phase 2: Build + Evaluate (per sprint) ──────────────────────────────────

async function runBuildEvaluatePhase(
	sprints: Sprint[],
	params: HarnessRunParams,
	generatorAgentName: string,
	generatorDef: AgentDef,
	evaluatorAgentName: string,
	evaluatorDef: AgentDef,
	resolvedGeneratorModel: Model<Api>,
	resolvedEvaluatorModel: Model<Api>,
	runCwd: string,
	widget: HarnessWidget,
	tracker: HarnessTracker,
	projectRoot: string,
	signal?: AbortSignal,
	onUpdate?: HarnessContext["onUpdate"],
): Promise<{
	results: SprintResult[];
	passedSprintCount: number;
	failedSprintCount: number;
}> {
	const results: SprintResult[] = [];
	let passedSprintCount = 0;
	let failedSprintCount = 0;
	const useInteractivePanes = shouldUseInteractivePanes(params);

	for (let i = 0; i < sprints.length; i++) {
		const sprint = sprints[i];
		const skillHints = resolveSkillHints(projectRoot, sprint);
		for (const warning of skillHints.warnings) {
			notify(onUpdate, `[warn] ${warning}`, { phase: "skills", warning, sprint: i + 1 });
		}
		widget.update({
			phase: "generating",
			sprint: i + 1,
			total: sprints.length,
			sprintTitle: sprint.title,
			iteration: 0,
			agentName: generatorAgentName,
			agentRole: "generator",
			agentModel: modelLabel(resolvedGeneratorModel),
			agentThinking: generatorDef.thinking ?? "",
			activeTools: [],
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		});

		tracker.startPhase("generating", generatorAgentName);
		notify(onUpdate, `[Build] Sprint ${i + 1}/${sprints.length}: ${sprint.title}`, {
			phase: "sprint",
			sprint: i + 1,
			total: sprints.length,
			title: sprint.title,
		});

		const sprintTask = [
			`Implement Sprint ${i + 1}: ${sprint.title}`,
			"",
			`Description: ${sprint.description}`,
			"",
			"Criteria:",
			sprint.criteria,
		];
		if (skillHints.workerText) sprintTask.push("", skillHints.workerText);
		if (sprint.files) sprintTask.push("", `Files: ${sprint.files}`);
		const generatorPrompt = sprintTask.join("\n");

		const generatorSubDir = `sprint-${i + 1}`;
		tracker.savePrompt(`generator-sprint-${i + 1}-system`, generatorDef.systemPrompt);
		tracker.savePrompt(`generator-sprint-${i + 1}-user`, generatorPrompt);
		tracker.saveSystemPrompt(generatorSubDir, "generator", generatorDef.systemPrompt);
		throwIfAborted(signal);
		if (useInteractivePanes) {
			await runInteractivePaneAgent({
				projectRoot,
				runCwd,
				runDir: tracker.runDir,
				subDir: `${generatorSubDir}/generator`,
				agentName: generatorAgentName,
				role: "generator",
				systemPrompt: generatorDef.systemPrompt,
				userPrompt: generatorPrompt,
				tools: generatorDef.tools,
				model: resolvedGeneratorModel,
				thinking: generatorDef.thinking,
				signal,
			});
		} else {
			const generator = await spawnAgent({
				systemPrompt: generatorDef.systemPrompt,
				tools: generatorDef.tools,
				model: resolvedGeneratorModel,
				thinking: generatorDef.thinking,
				agentName: generatorAgentName,
				role: "generator",
				runCwd,
				widget,
			});
			const stopGeneratorLog = tracker.startEventLog(generatorSubDir, "generator", generator, { phase: "generating", agent: generatorAgentName });
			try {
				await generator.prompt(generatorPrompt);
			} finally {
				stopGeneratorLog();
			}
			tracker.saveSession(generatorSubDir, "generator", generator, generatorDef.systemPrompt);
			generator.dispose();
		}

		if (params.pattern === "pipeline") {
			passedSprintCount++;
			widget.update({ passedSprints: passedSprintCount, failedSprints: failedSprintCount, activeTools: [] });
			writeProgress(tracker.runDir, i + 1, sprint.title, true, "pipeline mode — no evaluation");
			results.push({
				sprint: sprint.title,
				iterations: 1,
				passed: true,
				evalOutput: "(pipeline mode — no evaluation)",
			});
			continue;
		}

		let passed = false;
		let evalText = "";
		let iteration = 0;

		while (!passed && iteration < params.iterations) {
			widget.update({
				phase: "evaluating",
				iteration: iteration + 1,
				agentName: evaluatorAgentName,
				agentRole: "evaluator",
				agentModel: modelLabel(resolvedEvaluatorModel),
				agentThinking: evaluatorDef.thinking ?? "",
				activeTools: [],
				turnCount: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			});

			tracker.startPhase("evaluating", evaluatorAgentName);
			const evaluatorPrompt = [`Test Sprint ${i + 1}: ${sprint.title}`, "", "Criteria:", sprint.criteria, ...(skillHints.reviewerText ? ["", skillHints.reviewerText] : [])].join("\n");
			const evaluatorSubDir = `sprint-${i + 1}/evaluator-iter-${iteration + 1}`;
			tracker.savePrompt(`evaluator-sprint-${i + 1}-iter-${iteration + 1}-system`, evaluatorDef.systemPrompt);
			tracker.savePrompt(`evaluator-sprint-${i + 1}-iter-${iteration + 1}-user`, evaluatorPrompt);
			tracker.saveSystemPrompt(evaluatorSubDir, "evaluator", evaluatorDef.systemPrompt);
			throwIfAborted(signal);
			if (useInteractivePanes) {
				const result = await runInteractivePaneAgent({
					projectRoot,
					runCwd,
					runDir: tracker.runDir,
					subDir: `${evaluatorSubDir}/evaluator`,
					agentName: evaluatorAgentName,
					role: "evaluator",
					systemPrompt: evaluatorDef.systemPrompt,
					userPrompt: evaluatorPrompt,
					tools: evaluatorDef.tools,
					model: resolvedEvaluatorModel,
					thinking: evaluatorDef.thinking,
					signal,
				});
				evalText = result.outputText;
			} else {
				const evaluator = await spawnAgent({
					systemPrompt: evaluatorDef.systemPrompt,
					tools: evaluatorDef.tools,
					model: resolvedEvaluatorModel,
					thinking: evaluatorDef.thinking,
					agentName: evaluatorAgentName,
					role: "evaluator",
					runCwd,
					widget,
				});
				const stopEvaluatorLog = tracker.startEventLog(evaluatorSubDir, "evaluator", evaluator, { phase: "evaluating", agent: evaluatorAgentName });
				try {
					await evaluator.prompt(evaluatorPrompt);
				} finally {
					stopEvaluatorLog();
				}
				evalText = getLastAssistantText(evaluator);
				tracker.saveSession(evaluatorSubDir, "evaluator", evaluator, evaluatorDef.systemPrompt);
				evaluator.dispose();
			}
			const evalResult = parseEvalOutput(evalText);
			passed = evalResult.verdict === "PASS";
			const failedCriteria = evalResult.criteria.filter((c) => !c.passes);

			notify(
				onUpdate,
				`  ${passed ? "[✓]" : "[x]"} Sprint ${i + 1} evaluation (iter ${iteration + 1}): ${passed ? "PASS" : "FAIL"}`,
				{
					phase: "evaluation",
					sprint: i + 1,
					total: sprints.length,
					iteration: iteration + 1,
					passed,
					evalOutput: evalText,
				},
			);

			if (passed) {
				writeProgress(tracker.runDir, i + 1, sprint.title, true, evalResult.summary || evalText.slice(0, 200));
				passedSprintCount++;
				widget.update({ passedSprints: passedSprintCount, failedSprints: failedSprintCount, activeTools: [] });
				break;
			}

			iteration++;
			if (iteration >= params.iterations) {
				writeProgress(tracker.runDir, i + 1, sprint.title, false, failedCriteria.map((c) => c.evidence).join("; "));
				failedSprintCount++;
				widget.update({ passedSprints: passedSprintCount, failedSprints: failedSprintCount, activeTools: [] });
				break;
			}

			widget.update({
				phase: "fixing",
				iteration: iteration + 1,
				agentName: generatorAgentName,
				agentRole: "generator",
				agentModel: modelLabel(resolvedGeneratorModel),
				agentThinking: generatorDef.thinking ?? "",
				activeTools: [],
				turnCount: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			});

			tracker.startPhase("fixing", generatorAgentName);
			const fixerPrompt = [
				`Sprint ${i + 1}: ${sprint.title} FAILED evaluation.`,
				"",
				"Fix these issues:",
				evalText,
				...(skillHints.workerText ? ["", skillHints.workerText] : []),
			].join("\n");
			const fixerSubDir = `sprint-${i + 1}/generator-iter-${iteration + 1}`;
			tracker.savePrompt(`generator-sprint-${i + 1}-iter-${iteration + 1}-system`, generatorDef.systemPrompt);
			tracker.savePrompt(`generator-sprint-${i + 1}-iter-${iteration + 1}-user`, fixerPrompt);
			tracker.saveSystemPrompt(fixerSubDir, "generator", generatorDef.systemPrompt);
			throwIfAborted(signal);
			if (useInteractivePanes) {
				await runInteractivePaneAgent({
					projectRoot,
					runCwd,
					runDir: tracker.runDir,
					subDir: `${fixerSubDir}/generator`,
					agentName: generatorAgentName,
					role: "generator",
					systemPrompt: generatorDef.systemPrompt,
					userPrompt: fixerPrompt,
					tools: generatorDef.tools,
					model: resolvedGeneratorModel,
					thinking: generatorDef.thinking,
					signal,
				});
			} else {
				const fixer = await spawnAgent({
					systemPrompt: generatorDef.systemPrompt,
					tools: generatorDef.tools,
					model: resolvedGeneratorModel,
					thinking: generatorDef.thinking,
					agentName: generatorAgentName,
					role: "generator",
					runCwd,
					widget,
				});
				const stopFixerLog = tracker.startEventLog(fixerSubDir, "generator", fixer, { phase: "fixing", agent: generatorAgentName });
				try {
					await fixer.prompt(fixerPrompt);
				} finally {
					stopFixerLog();
				}
				tracker.saveSession(fixerSubDir, "generator", fixer, generatorDef.systemPrompt);
				fixer.dispose();
			}
		}

		results.push({
			sprint: sprint.title,
			iterations: Math.max(1, iteration + 1),
			passed,
			evalOutput: evalText,
		});
	}

	return { results, passedSprintCount, failedSprintCount };
}

// ─── Phase 3: Report ─────────────────────────────────────────────────────────

function buildFinalReport(
	params: HarnessRunParams,
	results: SprintResult[],
	specText: string,
	sprints: Sprint[],
	tracker: HarnessTracker,
	workspace: HarnessWorkspace,
	workflowSlug: string | null,
	watch: HarnessTmuxWatch,
): string {
	const allPassed = results.every((r) => r.passed);
	const reportLines = results
		.map((r, i) => `| ${i + 1} | ${r.sprint} | ${r.passed ? "[✓] PASS" : "[x] FAIL"} | ${r.iterations} |`)
		.join("\n");

	return [
		"## Harness Build Results",
		"",
		`**Pattern**: ${params.pattern}`,
		`**Status**: ${allPassed ? "[✓] All sprints passed" : "[!] Some sprints failed"}`,
		`**Sprints**: ${sprints.length}`,
		workflowSlug ? `**Workflow**: .pi/workflows/${workflowSlug}.mjs` : "",
		`**Run dir**: .pi/harness-runs/${tracker.runId}`,
		watch.attachCommand ? `**Watch**: ${watch.attachCommand}` : params.tmuxMode === "off" ? "**Watch**: off" : watch.warning ? `**Watch**: ${watch.warning}` : "",
		watch.warning && watch.attachCommand ? `**Tmux note**: ${watch.warning}` : "",
		workspace.isolated ? `**Workspace**: worktree — ${workspace.worktreePath}` : `**Workspace**: current — ${workspace.cwd}`,
		"|--------|-------|--------|------------|",
		reportLines,
		"",
		allPassed
			? "All sprints passed. Consider integration testing, deployment, and polish."
			: "Some sprints failed. Review evaluation output and apply fixes.",
	].join("\n");
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Run the full harness orchestration.
 *
 * Coordinates planning, implementation, verification, and progress updates
 * while preserving worktree isolation and git safety guarantees.
 *
 * Returns the same shape as the original index.ts execute() method to
 * maintain backward compatibility. Error handling and progress updates
 * remain equivalent for successful and failed runs.
 */
export async function orchestrateHarnessRun(
	params: HarnessRunParams,
	context: HarnessContext,
): Promise<HarnessResult> {
	const { projectRoot, model: mainModel, modelRegistry, signal, onUpdate, ctx } = context;

	// Widget for live progress
	const widget = new HarnessWidget(ctx);
	widget.update({ pattern: params.pattern, maxIterations: params.iterations });

	// Tracker for full run artifacts
	const tracker = new HarnessTracker(projectRoot, params.prompt);
	tracker.recordEvent({ event: "run_start", pattern: params.pattern, prompt: params.prompt, tmuxMode: params.tmuxMode, workspace: params.workspace });
	const watch = params.tmuxMode === "watch" ? startHarnessTmuxWatch(projectRoot, tracker.runDir, tracker.runId) : {};
	if (watch.attachCommand) {
		notify(onUpdate, `[watch] Harness tmux session: ${watch.attachCommand}`, { phase: "watch", tmuxSession: watch.sessionName, attachCommand: watch.attachCommand });
		if (watch.warning) notify(onUpdate, `[tmux] ${watch.warning}`, { phase: "watch", warning: watch.warning });
	} else if (watch.warning) {
		notify(onUpdate, `[warn] ${watch.warning}`, { phase: "watch", warning: watch.warning });
	}
	const workspace = await createHarnessWorkspace(projectRoot, params.prompt, params.workspace);
	const runCwd = workspace.cwd;
	tracker.saveWorkspace(workspace);

	if (workspace.warning) {
		notify(onUpdate, `[warn] ${workspace.warning}`, { phase: "workspace", warning: workspace.warning });
	}

	// Load context files once
	const contextFiles = params.inheritContext ? loadContextFiles(projectRoot) : { agents: "", append: "" };

	const warnings: string[] = [];
	const availableToolNames = context.availableToolNames ?? new Set<string>();

	// --- Load agent definitions ---
	const plannerDef = loadAgentDef(
		params.plannerAgent,
		"harness-planner",
		DEFAULT_PLANNER_PROMPT,
		DEFAULT_PLANNER_TOOLS,
		projectRoot,
		contextFiles,
		warnings,
		availableToolNames,
	);
	// Append harness format as the final output contract for this run.
	plannerDef.systemPrompt = plannerDef.systemPrompt + "\n\n" + HARNESS_FORMAT_INSTRUCTIONS;

	const generatorDef = loadAgentDef(
		params.generatorAgent,
		"harness-worker",
		DEFAULT_GENERATOR_PROMPT,
		DEFAULT_GENERATOR_TOOLS,
		projectRoot,
		contextFiles,
		warnings,
		availableToolNames,
	);
	const evaluatorDef = loadAgentDef(
		params.evaluatorAgent,
		"harness-reviewer",
		DEFAULT_EVALUATOR_PROMPT,
		DEFAULT_EVALUATOR_TOOLS,
		projectRoot,
		contextFiles,
		warnings,
		availableToolNames,
	);
	// Append evaluation output format instructions (Default-FAIL contract)
	evaluatorDef.systemPrompt += HARNESS_EVAL_INSTRUCTIONS;

	// Resolve models
	const resolvedModels = resolveAllModels(
		params,
		mainModel,
		plannerDef,
		generatorDef,
		evaluatorDef,
		warnings,
		modelRegistry,
	);

	for (const warning of warnings) {
		notify(onUpdate, `[warn] ${warning}`, { phase: "configuration", warning });
	}

	signal?.addEventListener("abort", () => widget.clear(), { once: true });

	// --- Phase 1: Plan ---
	const { specText, sprints } = await runPlanningPhase(
		params.prompt,
		params.plannerAgent,
		plannerDef,
		resolvedModels.planner,
		runCwd,
		widget,
		tracker,
		params.pattern,
		projectRoot,
		shouldUseInteractivePanes(params),
		signal,
		onUpdate,
	);

	if (sprints.length === 0) {
		widget.clear();
		const errorContent: TextContent = {
			type: "text" as const,
			text: [
				"[x] Planner couldn't produce a valid spec.",
				"",
				"Raw output:",
				"```",
				specText.slice(0, 2000),
				"```",
			].join("\n"),
		};
		return {
			content: [errorContent],
			details: { phase: "failed", error: "No sprints parsed", spec: specText },
			isError: true,
		};
	}

	widget.update({ phase: "", sprint: 0, total: sprints.length, sprintTitle: "" });

	notify(onUpdate, `[Spec] Spec created: ${sprints.length} sprints. Building with "${params.generatorAgent}"...`, {
		phase: "building",
		sprint: 0,
		total: sprints.length,
		spec: specText,
	});

	// --- Phase 2: Build + Evaluate (per sprint) ---
	const { results, passedSprintCount, failedSprintCount } = await runBuildEvaluatePhase(
		sprints,
		params,
		params.generatorAgent,
		generatorDef,
		params.evaluatorAgent,
		evaluatorDef,
		resolvedModels.generator,
		resolvedModels.evaluator,
		runCwd,
		widget,
		tracker,
		projectRoot,
		signal,
		onUpdate,
	);

	widget.stopSpinner();
	const allPassed = results.every((r) => r.passed);
	widget.update({
		phase: allPassed ? "complete" : "failed",
		sprintTitle: "",
		activeTools: [],
		agentName: "",
		agentRole: "",
		agentModel: "",
		agentThinking: "",
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	});

	// Generate reusable workflow script
	const workflowSlug = generateWorkflowScript(projectRoot, params.prompt, specText, sprints, params.pattern, results);

	// Save tracking artifacts
	tracker.saveTiming();

	const finalReport = buildFinalReport(params, results, specText, sprints, tracker, workspace, workflowSlug, watch);
	tracker.saveReport(finalReport);
	tracker.recordEvent({ event: "run_end", passed: allPassed });
	widget.clear();

	return {
		content: [{ type: "text" as const, text: finalReport }],
		details: {
			phase: "complete",
			pattern: params.pattern,
			pass: allPassed,
			plannerAgent: params.plannerAgent,
			generatorAgent: params.generatorAgent,
			evaluatorAgent: params.evaluatorAgent,
			sprints: results,
			spec: specText,
		},
	};
}
