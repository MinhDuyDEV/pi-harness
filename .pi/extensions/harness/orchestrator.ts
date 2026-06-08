/**
 * Execution orchestration for the Harness extension.
 *
 * Coordinates planning, implementation, verification, and progress updates
 * while preserving workspace policy and git safety guarantees.
 *
 * Extracted from index.ts to remove duplicate agent lifecycle patterns,
 * consolidate error handling, and centralize progress/reporting logic.
 */

import type { ExtensionContext, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { Model, Api, TextContent } from "@earendil-works/pi-ai";
import {
	parseSprints,
	parseEvalOutput,
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
	loadContextFiles,
	wrapWithContext,
	loadAgentFile,
	modelLabel,
	resolveModel,
	DEFAULT_PLANNER_PROMPT,
	DEFAULT_GENERATOR_PROMPT,
	DEFAULT_EVALUATOR_PROMPT,
	DEFAULT_PLANNER_TOOLS,
	DEFAULT_GENERATOR_TOOLS,
	DEFAULT_EVALUATOR_TOOLS,
} from "./agents.js";
import { HarnessWidget } from "./widgets.js";
import { createHarnessWorkspace, type HarnessWorkspace, type HarnessWorkspaceMode } from "./gitSafety.js";
import { resolveSkillHints } from "./skills.js";
import { startHarnessTmuxWatch, type HarnessTmuxWatch } from "./tmuxWatch.js";
import { isInsideTmux } from "./interactivePane.js";
import { runHarnessAgent, type AgentRunnerMode } from "./runner.js";
import { filterToolsForRole, DEFAULT_HARNESS_POLICY, type HarnessAgentRole } from "./policy.js";
import { formatVerificationSummary, runVerificationCommands } from "./verification.js";
import { assessRunTrace, assessSprintTrace, formatTraceQualitySummary, type RunTraceQualitySummary } from "./traceQuality.js";

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
	role: HarnessAgentRole,
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
	const availableTools = requestedTools.filter((tool) => {
		if (availableToolNames.size === 0 || availableToolNames.has(tool)) return true;
		warnings.push(`Agent "${name}" requested unavailable tool "${tool}"; it will not be enabled.`);
		return false;
	});
	const tools = filterToolsForRole(availableTools, role, name, warnings);
	return {
		systemPrompt: wrapWithContext(base, contextFiles),
		tools,
		model: file?.model,
		thinking: file?.thinking,
	};
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

function agentRunnerMode(params: HarnessRunParams): AgentRunnerMode {
	return shouldUseInteractivePanes(params) ? "interactive-pane" : "sdk";
}

function runStatePromptSection(tracker: HarnessTracker): string[] {
	const state = tracker.readState();
	return state ? ["", "Current harness run state:", state] : [];
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
	runnerMode: AgentRunnerMode,
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
	const planningPrompt = `Decompose the following task into numbered sprints for the build harness.\n\nTASK:\n${prompt}`;
	tracker.savePrompt("planner-user", planningPrompt);
	tracker.saveSystemPrompt("plan", "planner", plannerDef.systemPrompt);
	throwIfAborted(signal);

	const result = await runHarnessAgent({
		mode: runnerMode,
		projectRoot,
		runCwd,
		runDir: tracker.runDir,
		subDir: "plan/planner",
		agentName: plannerAgentName,
		role: "planner",
		phase: "planning",
		systemPrompt: plannerDef.systemPrompt,
		userPrompt: planningPrompt,
		tools: plannerDef.tools,
		model: resolvedPlannerModel,
		thinking: plannerDef.thinking,
		tracker,
		widget,
		signal,
	});
	// Ensure final planner metrics always appear in widget.
	widget.update({
		turnCount: result.usage.turnCount,
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		cacheReadTokens: result.usage.cacheReadTokens,
		cacheWriteTokens: result.usage.cacheWriteTokens,
		totalCost: result.usage.totalCost,
	});
	const specText = result.outputText;
	tracker.saveSpec(specText);

	const sprints = parseSprints(specText);
	tracker.appendState("planning", `Planner produced ${sprints.length} strict sprint(s).`, sprints.map((sprint) => `Sprint ${sprint.number}: ${sprint.title} · lane ${sprint.riskLane} · proof ${sprint.proofRequired.length}`));
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
	const runnerMode = agentRunnerMode(params);

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
			ownedFiles: sprint.files,
			verificationCommandCount: sprint.verificationCommands.length,
			verificationStatus: sprint.verificationCommands.length > 0 ? "pending" : "skipped",
			reviewStatus: params.pattern === "pipeline" ? "skipped" : "pending",
			riskLane: sprint.riskLane,
			contextItemCount: sprint.contextNeeded.length,
			proofItemCount: sprint.proofRequired.length,
			traceQuality: "pending",
			dependencyCount: sprint.dependencies.length,
			frictionCount: 0,
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
			`Lane: ${sprint.riskLane}`,
			`Risk Flags: ${sprint.riskFlags.length > 0 ? sprint.riskFlags.join(", ") : "none"}`,
			"Context Needed:",
			...(sprint.contextNeeded.length > 0 ? sprint.contextNeeded.map((item) => `- ${item}`) : ["- none listed"]),
			"Proof Required:",
			...(sprint.proofRequired.length > 0 ? sprint.proofRequired.map((item) => `- ${item}`) : ["- none listed"]),
			`Dependencies: ${sprint.dependencies.length > 0 ? sprint.dependencies.map((d) => `Sprint ${d}`).join(", ") : "none"}`,
			"",
			"Criteria:",
			sprint.criteria,
			...runStatePromptSection(tracker),
		];
		if (skillHints.workerText) sprintTask.push("", skillHints.workerText);
		if (sprint.ownedFiles.length > 0) {
			sprintTask.push(
				"",
				"OWNED FILES — you may ONLY create or modify these files:",
				...sprint.ownedFiles.map((file) => `- ${file}`),
				"",
				"Do NOT edit, create, or delete any file not listed above. If you need a dependency, declare it in the sprint criteria instead.",
			);
		}
		const generatorPrompt = sprintTask.join("\n");

		const generatorSubDir = `sprint-${i + 1}`;
		tracker.savePrompt(`generator-sprint-${i + 1}-system`, generatorDef.systemPrompt);
		tracker.savePrompt(`generator-sprint-${i + 1}-user`, generatorPrompt);
		tracker.saveSystemPrompt(generatorSubDir, "generator", generatorDef.systemPrompt);
		throwIfAborted(signal);
		await runHarnessAgent({
			mode: runnerMode,
			projectRoot,
			runCwd,
			runDir: tracker.runDir,
			subDir: `${generatorSubDir}/generator`,
			agentName: generatorAgentName,
			role: "generator",
			phase: "generating",
			systemPrompt: generatorDef.systemPrompt,
			userPrompt: generatorPrompt,
			tools: generatorDef.tools,
			model: resolvedGeneratorModel,
			thinking: generatorDef.thinking,
			tracker,
			widget,
			signal,
		});
		tracker.appendState(`sprint ${i + 1} generation`, `Generator completed sprint ${i + 1}: ${sprint.title}.`, sprint.files ? [`Planned files: ${sprint.files}`] : []);

		// Fail if any dependency hasn't passed.
		const failedDependencies = sprint.dependencies.filter((dep) => {
			const depResult = results[dep - 1];
			return !depResult || !depResult.passed;
		});
		if (failedDependencies.length > 0) {
			failedSprintCount++;
			const detail = `BLOCKED: depends on sprint(s) ${failedDependencies.join(", ")} which did not pass.`;
			writeProgress(tracker.runDir, i + 1, sprint.title, false, detail);
			tracker.appendState(`sprint ${i + 1} blocked`, detail);
			widget.update({ passedSprints: passedSprintCount, failedSprints: failedSprintCount, verificationStatus: "failed", reviewStatus: "skipped", activeTools: [] });
			tracker.recordEvent({ event: "sprint_blocked", sprint: i + 1, reason: "failed_dependencies", failedDependencies });
			results.push({ sprint: sprint.title, iterations: 0, passed: false, verdict: "FAIL", confidence: "low", evalOutput: detail, verification: { status: "failed", results: [] } });
			continue;
		}

		// High-risk sprints without verification commands fail immediately.
		if (sprint.verificationRequired && sprint.verificationCommands.length === 0) {
			failedSprintCount++;
			const detail = `BLOCKED: high-risk sprint requires verification commands but none were declared.`;
			writeProgress(tracker.runDir, i + 1, sprint.title, false, detail);
			tracker.appendState(`sprint ${i + 1} blocked`, detail);
			widget.update({ passedSprints: passedSprintCount, failedSprints: failedSprintCount, verificationStatus: "failed", reviewStatus: "skipped", activeTools: [] });
			tracker.recordEvent({ event: "sprint_blocked", sprint: i + 1, reason: "missing_verification_commands", riskLane: sprint.riskLane });
			results.push({ sprint: sprint.title, iterations: 0, passed: false, verdict: "FAIL", confidence: "low", evalOutput: detail, verification: { status: "failed", results: [] } });
			continue;
		}

		if (params.pattern === "pipeline") {
			widget.update({ phase: "evaluating", verificationStatus: sprint.verificationCommands.length > 0 ? "running" : "skipped", reviewStatus: "skipped", activeTools: [] });
			const verification = runVerificationCommands(sprint.verificationCommands, runCwd, DEFAULT_HARNESS_POLICY);
			const pipelinePassed = verification.status !== "failed";
			if (pipelinePassed) passedSprintCount++;
			else failedSprintCount++;
			widget.update({ passedSprints: passedSprintCount, failedSprints: failedSprintCount, verificationStatus: verification.status, reviewStatus: "skipped", activeTools: [] });
			const detail = `pipeline mode — no evaluator; ${formatVerificationSummary(verification)}`;
			writeProgress(tracker.runDir, i + 1, sprint.title, pipelinePassed, detail);
			tracker.appendState(`sprint ${i + 1} pipeline`, detail);
			const hasVerifCommands = sprint.verificationCommands.length > 0;
			let pipelineVerdict: "PASS" | "FAIL" | "UNVERIFIABLE";
			if (!hasVerifCommands) pipelineVerdict = "UNVERIFIABLE";
			else if (pipelinePassed) pipelineVerdict = "PASS";
			else pipelineVerdict = "FAIL";
			const sprintResult: SprintResult = {
				sprint: sprint.title,
				iterations: 1,
				passed: pipelinePassed && hasVerifCommands,
				verdict: pipelineVerdict,
				confidence: "low",
				evalOutput: "(pipeline mode — no evaluator)",
				verification,
			};
			results.push(sprintResult);
			const traceQuality = assessSprintTrace(sprint, sprintResult);
			widget.update({ traceQuality: traceQuality.level, frictionCount: traceQuality.friction.length });
			tracker.recordEvent({ event: "sprint_trace_quality", sprint: i + 1, ...traceQuality });
			continue;
		}

		let passed = false;
		let evalText = "";
		let iteration = 0;
		let lastVerification = runVerificationCommands([], runCwd, DEFAULT_HARNESS_POLICY);
		let lastEvalConfidence: "high" | "medium" | "low" = "low";

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
				verificationStatus: sprint.verificationCommands.length > 0 ? "running" : "skipped",
				reviewStatus: "pending",
			});

			tracker.startPhase("evaluating", evaluatorAgentName);
			lastVerification = runVerificationCommands(sprint.verificationCommands, runCwd, DEFAULT_HARNESS_POLICY);
			widget.update({ verificationStatus: lastVerification.status, reviewStatus: "running" });
			const verificationText = formatVerificationSummary(lastVerification);
			tracker.appendState(`sprint ${i + 1} verification iter ${iteration + 1}`, verificationText);
			const evaluatorPrompt = [
				`Test Sprint ${i + 1}: ${sprint.title}`,
				"",
				`Lane: ${sprint.riskLane}`,
				`Risk Flags: ${sprint.riskFlags.length > 0 ? sprint.riskFlags.join(", ") : "none"}`,
				"Proof Required:",
				...(sprint.proofRequired.length > 0 ? sprint.proofRequired.map((item) => `- ${item}`) : ["- none listed"]),
				"",
				"File ownership contract:",
				...(sprint.ownedFiles.length > 0 ? sprint.ownedFiles.map((file) => `- ${file}`) : ["- no files declared"]),
				"FAIL this sprint if the generator created, modified, or deleted any file not listed above.",
				"",
				"Criteria:",
				sprint.criteria,
				"",
				"Harness deterministic verification:",
				verificationText,
				...runStatePromptSection(tracker),
				...(skillHints.reviewerText ? ["", skillHints.reviewerText] : []),
			].join("\n");
			const evaluatorSubDir = `sprint-${i + 1}/evaluator-iter-${iteration + 1}`;
			tracker.savePrompt(`evaluator-sprint-${i + 1}-iter-${iteration + 1}-system`, evaluatorDef.systemPrompt);
			tracker.savePrompt(`evaluator-sprint-${i + 1}-iter-${iteration + 1}-user`, evaluatorPrompt);
			tracker.saveSystemPrompt(evaluatorSubDir, "evaluator", evaluatorDef.systemPrompt);
			throwIfAborted(signal);
			const evalRun = await runHarnessAgent({
				mode: runnerMode,
				projectRoot,
				runCwd,
				runDir: tracker.runDir,
				subDir: `${evaluatorSubDir}/evaluator`,
				agentName: evaluatorAgentName,
				role: "evaluator",
				phase: "evaluating",
				systemPrompt: evaluatorDef.systemPrompt,
				userPrompt: evaluatorPrompt,
				tools: evaluatorDef.tools,
				model: resolvedEvaluatorModel,
				thinking: evaluatorDef.thinking,
				tracker,
				widget,
				signal,
			});
			evalText = evalRun.outputText;
			const evalResult = parseEvalOutput(evalText, sprint.criteria);
			lastEvalConfidence = evalResult.confidence;
			passed = evalResult.verdict === "PASS" && lastVerification.status !== "failed";
			widget.update({ reviewStatus: passed ? "passed" : "failed" });
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
				writeProgress(tracker.runDir, i + 1, sprint.title, true, `${evalResult.summary || evalText.slice(0, 200)}; ${lastVerification.status === "skipped" ? "verification skipped" : `verification ${lastVerification.status}`}`);
				passedSprintCount++;
				widget.update({ passedSprints: passedSprintCount, failedSprints: failedSprintCount, activeTools: [] });
				break;
			}

			iteration++;
			if (iteration >= params.iterations) {
				writeProgress(tracker.runDir, i + 1, sprint.title, false, [failedCriteria.map((c) => c.evidence).join("; "), formatVerificationSummary(lastVerification)].filter(Boolean).join("; "));
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
				reviewStatus: "failed",
			});

			tracker.startPhase("fixing", generatorAgentName);
			const fixerPrompt = [
				`Sprint ${i + 1}: ${sprint.title} FAILED evaluation.`,
				"",
				"Fix these issues:",
				evalText,
				"",
				"Harness deterministic verification:",
				formatVerificationSummary(lastVerification),
				...runStatePromptSection(tracker),
				...(skillHints.workerText ? ["", skillHints.workerText] : []),
			].join("\n");
			const fixerSubDir = `sprint-${i + 1}/generator-iter-${iteration + 1}`;
			tracker.savePrompt(`generator-sprint-${i + 1}-iter-${iteration + 1}-system`, generatorDef.systemPrompt);
			tracker.savePrompt(`generator-sprint-${i + 1}-iter-${iteration + 1}-user`, fixerPrompt);
			tracker.saveSystemPrompt(fixerSubDir, "generator", generatorDef.systemPrompt);
			throwIfAborted(signal);
			await runHarnessAgent({
				mode: runnerMode,
				projectRoot,
				runCwd,
				runDir: tracker.runDir,
				subDir: `${fixerSubDir}/generator`,
				agentName: generatorAgentName,
				role: "generator",
				phase: "fixing",
				systemPrompt: generatorDef.systemPrompt,
				userPrompt: fixerPrompt,
				tools: generatorDef.tools,
				model: resolvedGeneratorModel,
				thinking: generatorDef.thinking,
				tracker,
				widget,
				signal,
			});
			tracker.appendState(`sprint ${i + 1} fix iter ${iteration + 1}`, `Generator attempted fixes for sprint ${i + 1}.`);
		}

		// Determine verdict: PASS only when deterministic verification passed.
		// ATTESTED when LLM said PASS but no verification commands exist.
		const hasVerifCommands = sprint.verificationCommands.length > 0;
		let sprintVerdict: "PASS" | "FAIL" | "ATTESTED" | "UNVERIFIABLE";
		if (!passed) {
			sprintVerdict = "FAIL";
		} else if (hasVerifCommands) {
			sprintVerdict = "PASS";
		} else {
			sprintVerdict = "ATTESTED";
		}

		// Flag low-confidence passes
		if (sprintVerdict === "PASS" && lastEvalConfidence === "low") {
			notify(onUpdate, `  [low-confidence] Sprint ${i + 1} passed but evaluator confidence is low. Review manually.`, {
				phase: "evaluation",
				sprint: i + 1,
				warning: "low-confidence pass",
				confidence: "low",
			});
		}

		const sprintResult: SprintResult = {
			sprint: sprint.title,
			iterations: Math.max(1, iteration + 1),
			passed,
			verdict: sprintVerdict,
			confidence: lastEvalConfidence,
			evalOutput: evalText,
			verification: lastVerification,
		};
		results.push(sprintResult);
		const traceQuality = assessSprintTrace(sprint, sprintResult);
		widget.update({ traceQuality: traceQuality.level, frictionCount: traceQuality.friction.length });
		tracker.recordEvent({ event: "sprint_trace_quality", sprint: i + 1, ...traceQuality });
	}

	return { results, passedSprintCount, failedSprintCount };
}

// ─── Report Helpers ──────────────────────────────────────────────────────────

function verdictDisplay(verdict: string, confidence?: string): string {
	switch (verdict) {
		case "PASS": return `[✓] PASS${confidence === "low" ? " (low conf)" : confidence === "medium" ? " (med conf)" : ""}`;
		case "ATTESTED": return "[~] ATTESTED";
		case "UNVERIFIABLE": return "[?] UNVERIFIABLE";
		default: return "[x] FAIL";
	}
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
	traceSummary: RunTraceQualitySummary,
): string {
	const allPassed = results.every((r) => r.passed);
	const attestedCount = results.filter((r) => r.verdict === "ATTESTED").length;
	const unverifiableCount = results.filter((r) => r.verdict === "UNVERIFIABLE").length;
	const lowConfCount = results.filter((r) => r.verdict === "PASS" && r.confidence === "low").length;
	const statusFlags = [
		allPassed ? "[✓] All sprints passed" : "[!] Some sprints failed",
		attestedCount > 0 ? `${attestedCount} ATTESTED` : "",
		unverifiableCount > 0 ? `${unverifiableCount} UNVERIFIABLE` : "",
		lowConfCount > 0 ? `${lowConfCount} low-confidence` : "",
	].filter(Boolean).join(" · ");

	const reportLines = results
		.map((r, i) => {
			const trace = traceSummary.items[i]?.level ?? "weak";
			const disp = verdictDisplay(r.verdict, r.confidence);
			return `| ${i + 1} | ${r.sprint} | ${disp} | ${r.verification?.status ?? "unknown"} | ${trace} | ${r.iterations} |`;
		})
		.join("\n");
	const frictionLines = traceSummary.friction.length > 0
		? ["", "**Harness friction**:", ...traceSummary.friction.slice(0, 8).map((item) => `- ${item}`)]
		: ["", "**Harness friction**: none"];

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
		`**Trust**: ${attestedCount + unverifiableCount > 0 ? "mixed (see verdicts)" : lowConfCount > 0 ? "medium (low-confidence passes)" : "high (deterministic)"}`,
		`**Trace quality**: ${traceSummary.level} (${traceSummary.score}/${traceSummary.maxScore})`,
		"| Sprint | Title | Result | Verification | Trace | Iterations |",
		"|--------|-------|--------|--------------|-------|------------|",
		reportLines,
		...frictionLines,
		"",
		allPassed && attestedCount === 0 && unverifiableCount === 0
			? "All sprints passed with deterministic verification. Consider integration testing, deployment, and polish."
			: allPassed && (attestedCount > 0 || unverifiableCount > 0)
				? "All sprints passed but some are ATTESTED or UNVERIFIABLE. Review non-deterministic results."
				: "Some sprints failed. Review evaluation output and apply fixes.",
	].join("\n");
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Run the full harness orchestration.
 *
 * Coordinates planning, implementation, verification, and progress updates
 * while preserving workspace policy and git safety guarantees.
 *
 * Returns the extension tool result consumed by index.ts. Planner manifests
 * are strict; invalid contracts fail before implementation.
 */
export async function orchestrateHarnessRun(
	params: HarnessRunParams,
	context: HarnessContext,
): Promise<HarnessResult> {
	const { projectRoot, model: mainModel, modelRegistry, signal, onUpdate, ctx } = context;

	// Widget for live progress
	const widget = new HarnessWidget(ctx);
	widget.update({ pattern: params.pattern, maxIterations: params.iterations, runnerMode: agentRunnerMode(params) });

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
		"planner",
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
		"generator",
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
		"evaluator",
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

	// Cross-model enforcement: evaluator must be a different model than generator.
	const genLabel = `${resolvedModels.generator.provider}/${resolvedModels.generator.id}`;
	const evalLabel = `${resolvedModels.evaluator.provider}/${resolvedModels.evaluator.id}`;
	if (genLabel === evalLabel) {
		widget.clear();
		const errorContent: TextContent = {
			type: "text" as const,
			text: [
				"[x] Evaluator and generator use the same model.",
				"",
				"The evaluator must be a different model than the generator to provide",
				"an independent cross-check. Both are resolved to:",
				`  ${genLabel}`,
				"",
				"Fix: configure a different evaluator model in:",
				"  - The harness evaluatorAgent parameter, or",
				"  - .pi/agents/harness-reviewer.md frontmatter (model: field)",
				"",
				"The evaluator model should be from a different provider or a",
				"significantly different model family to ensure honest evaluation.",
			].join("\n"),
		};
		return {
			content: [errorContent],
			details: { phase: "failed", error: "Same model for evaluator and generator", generator: genLabel },
			isError: true,
		};
	}

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
		agentRunnerMode(params),
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
	const traceSummary = assessRunTrace(sprints, results);
	tracker.saveTraceQuality(traceSummary);
	tracker.appendState("trace quality", formatTraceQualitySummary(traceSummary));

	const finalReport = buildFinalReport(params, results, specText, sprints, tracker, workspace, workflowSlug, watch, traceSummary);
	tracker.saveReport(finalReport);
	tracker.recordEvent({ event: "run_end", passed: allPassed, traceQuality: traceSummary.level, frictionCount: traceSummary.friction.length });
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
