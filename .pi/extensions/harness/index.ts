/**
 * Harness — Multi-agent build harness for long-running app development.
 *
 * Architecture: Planner → Generator ↔ Evaluator (GAN-inspired loop)
 *
 * Loads agent definitions from .pi/agents/*.md at runtime.
 * Users customize agents by editing markdown files, not TypeScript.
 *
 * Default agent mapping:
 *   planner   → .pi/agents/harness-planner.md  (strict sprint manifest)
 *   generator → .pi/agents/harness-worker.md   (single-sprint implementation)
 *   evaluator → .pi/agents/harness-reviewer.md (strict JSON QA)
 *
 * Each sprint iterates generator↔evaluator up to N times (default 3).
 */

import type { ExtensionAPI, ResourceLoader, ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	createExtensionRuntime,
	SessionManager,
	type AgentSession,
	type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Model, TextContent, Api, ThinkingLevel } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Sprint {
	number: number;
	title: string;
	description: string;
	criteria: string;
	files: string;
}

interface SprintResult {
	sprint: string;
	iterations: number;
	passed: boolean;
	evalOutput: string;
}

interface AgentFrontmatter {
	description?: string;
	model?: string;
	thinking?: string;
	max_turns?: number;
	disallowed_tools?: string;
	prompt_mode?: string;
}

interface AgentConfig {
	systemPrompt: string;
	tools: string[];
	model?: string;
	thinking?: string;
}

/** Validate a raw thinking level string against the allowed values. */
function validateThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) return undefined;
	const valid: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"];
	return valid.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;
}

/**
 * Load context files (AGENTS.md, APPEND_SYSTEM.md) from project or global locations.
 * Priority: project > global.
 */
function loadContextFiles(cwd: string): { agents: string; append: string } {
	const projectAgents = resolve(cwd, ".pi", "AGENTS.md");
	const globalAgents = resolve(homedir(), ".pi", "agent", "AGENTS.md");
	const projectAppend = resolve(cwd, ".pi", "APPEND_SYSTEM.md");
	const globalAppend = resolve(homedir(), ".pi", "agent", "APPEND_SYSTEM.md");

	const agents = existsSync(projectAgents)
		? readFileSync(projectAgents, "utf-8")
		: existsSync(globalAgents)
			? readFileSync(globalAgents, "utf-8")
			: "";

	const append = existsSync(projectAppend)
		? readFileSync(projectAppend, "utf-8")
		: existsSync(globalAppend)
			? readFileSync(globalAppend, "utf-8")
			: "";

	return { agents, append };
}

/** Wrap an agent's system prompt with context files. */
function wrapWithContext(
	basePrompt: string,
	context: { agents: string; append: string },
): string {
	const parts: string[] = [];
	if (context.agents) parts.push(context.agents.trimEnd() + "\n");
	parts.push(basePrompt);
	if (context.append) parts.push("\n" + context.append.trim());
	return parts.join("\n");
}

const HARNESS_FORMAT_INSTRUCTIONS = `

---
[CRITICAL OUTPUT FORMAT — OVERRIDES ALL OTHER FORMAT INSTRUCTIONS]

You MUST output your plan ONLY as numbered sprint sections in this EXACT format.
IGNORE any other output format instructions in your system prompt.

## Sprint 1: Title
Description: ...
Criteria:
- [ ] Criterion 1
- [ ] Criterion 2
Files: path/to/file1.ts, path/to/file2.ts

## Sprint 2: Title
Description: ...
Criteria:
- [ ] Criterion 1
- [ ] Criterion 2
Files: path/to/file3.ts

Only output sprint sections. No commentary, no tables, no XML blocks, no episode tags.`;

/**
 * Evaluator output format — structured JSON for Default-FAIL contract.
 * Each criterion starts as "passes": false. Evaluator flips to true with evidence.
 */
const HARNESS_EVAL_INSTRUCTIONS = `

---
[CRITICAL OUTPUT FORMAT]

Output your evaluation as structured JSON. No other commentary.

{
  "verdict": "PASS" or "FAIL",
  "criteria": [
    {
      "id": "c1",
      "description": "What was tested",
      "passes": true or false,
      "evidence": "Evidence file or observation"
    }
  ],
  "summary": "One-line summary"
}

Only output JSON. No other text, no markdown.`;

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
const DEFAULT_PLANNER_TOOLS = ["read", "bash", "grep", "find", "ls"];
const DEFAULT_GENERATOR_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const DEFAULT_EVALUATOR_TOOLS = ["read", "bash"];

const DEFAULT_PLANNER_PROMPT = `You are a software architect. Your job is to expand a brief product idea into a detailed build specification.

Output a structured spec with numbered sprints. Each sprint must have:
- A clear description of what to build
- Testable criteria (what "done" looks like)
- Which files to create or modify

Be ambitious about scope. Focus on product context and high-level design — not detailed implementation.
Find opportunities to weave AI features into the product.

Format each sprint as:

## Sprint N: Title
Description: ...
Criteria:
- [ ] Criterion 1
- [ ] Criterion 2
Files: path/to/file1.ts, path/to/file2.ts`;

const DEFAULT_GENERATOR_PROMPT = `You are a senior full-stack developer. You implement features one sprint at a time.

For each sprint:
1. Read the sprint description and criteria
2. Implement the feature in the current working directory
3. Self-evaluate before declaring done
4. If you receive evaluation feedback with FAIL, fix the specific issues

Work in the existing project at the current working directory. Do not modify files outside the sprint scope.
When done, signal completion.`;

const DEFAULT_EVALUATOR_PROMPT = `You are a skeptical QA engineer. Your job is to test each sprint thoroughly.

For each sprint:
1. Read the criteria carefully
2. Start the application if needed (check package.json for start scripts)
3. Test each criterion by running the app, checking routes, inspecting output
4. Report PASS or FAIL for each criterion
5. For FAIL: be specific — what broke, where (file:line if possible), what you expected

Only pass a sprint when ALL criteria pass. Be harsh — missing features, broken interactions, and edge cases all count as FAIL.

Format your output as:

## Evaluation: Sprint N
Result: PASS or FAIL
Issues:
- [file.ts:42] Description of the issue
Recommendations:
- Suggested fix`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractText(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

function getLastAssistantText(session: AgentSession): string {
	const messages = session.messages;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			return extractText(msg.content);
		}
	}
	return "";
}

function createMinimalLoader(systemPrompt: string): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

function parseSprints(text: string): Sprint[] {
	const normalizedText = text.replace(/\r\n/g, "\n");
	const sprints: Sprint[] = [];
	const sprintRegex = /## Sprint (\d+):\s*(.+?)\n([\s\S]*?)(?=\n## Sprint |\n*$)/g;
	let match: RegExpExecArray | null;
	while ((match = sprintRegex.exec(normalizedText)) !== null) {
		const num = Number.parseInt(match[1], 10);
		const title = match[2].trim();
		const body = match[3].trim();
		const criteriaMatch = body.match(/Criteria?:?\s*\n?([\s\S]*?)(?=\nFiles:|$)/);
		const criteria = criteriaMatch?.[1]?.trim() ?? body;
		const filesMatch = body.match(/Files:?\s*(.+?)$/m);
		const files = filesMatch?.[1]?.trim() ?? "";
		sprints.push({ number: num, title, description: body, criteria, files });
	}

	// Fallback: if no ## Sprint sections found, treat entire output as one sprint
	if (sprints.length === 0 && normalizedText.trim()) {
		const lines = normalizedText.trim().split("\n");
		const firstLine = lines[0].replace(/^#+\s*/, "").slice(0, 80);
		sprints.push({
			number: 1,
			title: firstLine || "Implementation",
			description: normalizedText.trim(),
			criteria: normalizedText.trim(),
			files: "",
		});
	}

	return sprints;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns frontmatter and body separated.
 */
function parseMarkdownFrontmatter(
	content: string,
): { frontmatter: Record<string, string>; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content.trim() };

	const raw = match[1];
	const body = match[2].trim();
	const frontmatter: Record<string, string> = {};

	// Simple line-by-line YAML key: value parser
	for (const line of raw.split("\n")) {
		const kvMatch = line.match(/^\s*(\w[\w_-]*)\s*:\s*(.*?)\s*$/);
		if (kvMatch) {
			frontmatter[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, "");
		}
	}

	return { frontmatter, body };
}

/**
 * Load an agent definition from .pi/agents/{name}.md.
 * Returns the frontmatter fields and body as the system prompt.
 * Returns null if the file doesn't exist.
 */
function loadAgentFile(name: string, projectDir: string): AgentConfig | null {
	const filePath = resolve(projectDir, ".pi", "agents", `${name}.md`);
	if (!existsSync(filePath)) return null;

	const raw = readFileSync(filePath, "utf-8");
	const { frontmatter, body } = parseMarkdownFrontmatter(raw);

	const fm = frontmatter as unknown as AgentFrontmatter;

	// Resolve tools: all 7 minus disallowed_tools
	const disallowed = fm.disallowed_tools
		? fm.disallowed_tools.split(",").map((t) => t.trim())
		: [];
	const tools = ALL_TOOLS.filter((t) => !disallowed.includes(t));

	return {
		systemPrompt: body,
		tools,
		model: fm.model || undefined,
		thinking: fm.thinking || undefined,
	};
}

// ─── Live Widget ──────────────────────────────────────────────────────────────

/**
 * Braille spinner frames — industry standard for TUI (pi built-in, unicode-animations npm).
 * Each frame is a 2×4 braille dot pattern, cycling through all dot states.
 * Standard interval: 80ms.
 * Source: https://www.npmjs.com/package/unicode-animations and pi's own setWorkingIndicator().
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

type HarnessPhase = "initializing" | "planning" | "generating" | "evaluating" | "fixing" | "complete" | "failed" | "";
type AgentRole = "planner" | "generator" | "evaluator";

type ActiveTool = {
	id: string;
	name: string;
	label: string;
	startedAt: number;
};

interface WidgetState {
	phase: HarnessPhase;
	sprint: number;
	total: number;
	agentName: string;
	agentRole: AgentRole | "";
	agentModel: string;
	agentThinking: string;
	activeTools: ActiveTool[];
	turnCount: number;
	inputTokens: number;
	outputTokens: number;
	totalCost: number;
	sprintTitle: string;
	pattern: string;
	iteration: number;
	maxIterations: number;
	passedSprints: number;
	failedSprints: number;
}

/** Minimal theme type matching pi-tui's Theme (types not exported directly). */
type WidgetTheme = { fg: (color: ThemeColor, text: string) => string; bold?: (text: string) => string };

function fitCell(text: string, width: number): string {
	const clipped = visibleWidth(text) > width ? truncateToWidth(text, width, "…") : text;
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function borderSegment(label: string, width: number): string {
	const clipped = visibleWidth(label) > width ? truncateToWidth(label, width, "") : label;
	return clipped + "─".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

function formatTokens(count: number): string {
	if (count <= 0) return "0";
	if (count < 1000) return String(count);
	if (count < 1000000) return `${(count / 1000).toFixed(count < 10000 ? 1 : 0)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatCost(cost: number): string {
	return cost > 0 ? `$${cost.toFixed(4)}` : "$0";
}

function modelLabel(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function sessionUsage(session: AgentSession): Pick<WidgetState, "turnCount" | "inputTokens" | "outputTokens" | "totalCost"> {
	let inputTokens = 0;
	let outputTokens = 0;
	let totalCost = 0;
	let turnCount = 0;
	for (const message of session.messages as any[]) {
		if (message.role === "assistant") turnCount++;
		if (message.usage) {
			inputTokens += message.usage.input || 0;
			outputTokens += message.usage.output || 0;
			totalCost += message.usage.cost?.total || 0;
		}
	}
	return { turnCount, inputTokens, outputTokens, totalCost };
}

/**
 * Manages a live TUI widget showing harness progress.
 * The widget exposes only state the harness actually knows: workflow phase,
 * active agent metadata, sprint/review progress, active tools, and elapsed time.
 */
class HarnessWidget {
	private ctx: ExtensionContext;
	private state: WidgetState;
	private spinnerIdx = 0;
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private registered = false;
	private startedAt = Date.now();
	private phaseStartedAt = Date.now();
	private sprintStartedAt = Date.now();

	constructor(ctx: ExtensionContext) {
		this.ctx = ctx;
		this.state = {
			phase: "initializing",
			sprint: 0,
			total: 0,
			agentName: "",
			agentRole: "",
			agentModel: "",
			agentThinking: "",
			activeTools: [],
			turnCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalCost: 0,
			sprintTitle: "",
			pattern: "",
			iteration: 0,
			maxIterations: 3,
			passedSprints: 0,
			failedSprints: 0,
		};
	}

	update(partial: Partial<WidgetState>) {
		if (partial.phase && partial.phase !== this.state.phase) {
			this.phaseStartedAt = Date.now();
		}
		if (partial.sprint && partial.sprint !== this.state.sprint) {
			this.sprintStartedAt = Date.now();
		}
		Object.assign(this.state, partial);
		this.render();
	}

	private isRunning(): boolean {
		return ["planning", "generating", "evaluating", "fixing"].includes(this.state.phase);
	}

	private c(theme: WidgetTheme, color: ThemeColor, text: string): string {
		return theme.fg(color, text);
	}

	private b(theme: WidgetTheme, text: string): string {
		return theme.bold ? theme.bold(text) : text;
	}

	private phaseLabel(): string {
		switch (this.state.phase) {
			case "planning":
				return "Investigate & plan";
			case "generating":
				return "Implement sprint";
			case "evaluating":
				return "Evaluate criteria";
			case "fixing":
				return "Repair findings";
			case "complete":
				return "Workflow complete";
			case "failed":
				return "Workflow failed";
			default:
				return "Preparing workflow";
		}
	}

	private phaseIcon(theme: WidgetTheme): string {
		const spin = SPINNER_FRAMES[this.spinnerIdx % SPINNER_FRAMES.length];
		if (this.isRunning()) return this.c(theme, "accent", spin);
		if (this.state.phase === "complete") return this.c(theme, "success", "✓");
		if (this.state.phase === "failed") return this.c(theme, "error", "×");
		return this.c(theme, "muted", "•");
	}

	private sprintProgressBar(theme: WidgetTheme, width: number): string {
		const s = this.state;
		if (s.total <= 0 || width < 8) return "";
		const done = Math.min(s.total, s.passedSprints + s.failedSprints);
		const barWidth = Math.max(4, Math.min(width - 8, 18));
		const filled = Math.min(barWidth, Math.floor((done / s.total) * barWidth));
		const failed = s.failedSprints > 0;
		const active = done < s.total && s.sprint > 0;
		const fill = "━".repeat(filled);
		const cursor = active && filled < barWidth ? "▶" : "";
		const rest = "·".repeat(Math.max(0, barWidth - filled - cursor.length));
		const color: ThemeColor = failed ? "error" : done === s.total ? "success" : "accent";
		return `${this.c(theme, color, fill + cursor)}${this.c(theme, "dim", rest)} ${done}/${s.total}`;
	}

	private phaseRow(theme: WidgetTheme, phase: "plan" | "build" | "review" | "finish", label: string, progress: string): string {
		const s = this.state;
		const active =
			(phase === "plan" && s.phase === "planning") ||
			(phase === "build" && s.phase === "generating") ||
			(phase === "review" && (s.phase === "evaluating" || s.phase === "fixing")) ||
			(phase === "finish" && (s.phase === "complete" || s.phase === "failed"));
		const done =
			(phase === "plan" && s.total > 0 && s.phase !== "planning" && s.phase !== "initializing") ||
			(phase === "build" && s.passedSprints + s.failedSprints >= s.total && s.total > 0) ||
			(phase === "review" && ((s.pattern === "pipeline" && s.total > 0 && s.phase !== "planning" && s.phase !== "initializing") || s.phase === "complete")) ||
			(phase === "finish" && s.phase === "complete");
		const failed = (phase === "finish" && s.phase === "failed") || (phase === "build" && s.failedSprints > 0);
		const prefix = active
			? `${this.c(theme, "accent", "›")} ${this.phaseIcon(theme)}`
			: failed
				? `  ${this.c(theme, "error", "×")}`
				: done
					? `  ${this.c(theme, "success", "✓")}`
					: `  ${this.c(theme, "dim", "·")}`;
		const textColor: ThemeColor = active ? "accent" : failed ? "error" : done ? "success" : "muted";
		return `${prefix} ${this.c(theme, textColor, label)} ${this.c(theme, "dim", progress)}`;
	}

	private activeToolLine(theme: WidgetTheme): string {
		const tools = this.state.activeTools;
		if (tools.length === 0) return this.isRunning() ? "waiting for agent" : "idle";
		return tools
			.map((tool) => `${tool.label} ${this.c(theme, "dim", formatElapsed(Date.now() - tool.startedAt))}`)
			.join(", ");
	}

	private agentLine(theme: WidgetTheme): string {
		const s = this.state;
		const parts = [s.agentName || "—"];
		if (s.agentRole) parts.push(s.agentRole);
		if (s.agentModel) parts.push(s.agentModel);
		if (s.agentThinking) parts.push(`think:${s.agentThinking}`);
		return `${this.c(theme, "muted", "agent")} ${parts.join(" · ")}`;
	}

	private metricsLine(theme: WidgetTheme): string {
		const s = this.state;
		return [
			`${this.c(theme, "muted", "↻")} ${s.turnCount}`,
			`${this.c(theme, "muted", "↑")} ${formatTokens(s.inputTokens)}`,
			`${this.c(theme, "muted", "↓")} ${formatTokens(s.outputTokens)}`,
			`${this.c(theme, "muted", "¤")} ${formatCost(s.totalCost)}`,
		].join(" · ");
	}

	private buildExpandedLines(width: number, theme: WidgetTheme): string[] {
		const totalWidth = Math.max(80, width);
		const contentWidth = totalWidth - 7;
		const leftWidth = Math.min(34, Math.max(28, Math.floor(contentWidth * 0.34)));
		const rightWidth = contentWidth - leftWidth;
		const s = this.state;
		const pattern = s.pattern || "producer-reviewer";
		const progress = this.sprintProgressBar(theme, 26);
		const title = ` Harness · ${pattern} · ${progress || "planning"} · ${formatElapsed(Date.now() - this.startedAt)} `;
		const top = `${this.c(theme, "border", "╭")}${this.c(theme, "borderAccent", borderSegment(" Workflow ", leftWidth + 2))}${this.c(theme, "border", "┬")}${this.c(theme, "borderAccent", borderSegment(title, rightWidth + 2))}${this.c(theme, "border", "╮")}`;
		const bottom = `${this.c(theme, "border", "╰")}${this.c(theme, "border", "─".repeat(leftWidth + 2))}${this.c(theme, "border", "┴")}${this.c(theme, "border", "─".repeat(rightWidth + 2))}${this.c(theme, "border", "╯")}`;
		const buildDone = Math.min(s.total, s.passedSprints + s.failedSprints);
		const reviewProgress = pattern === "pipeline" ? "skipped" : s.iteration > 0 ? `${s.iteration}/${s.maxIterations}` : `0/${s.maxIterations}`;
		const phaseRows = [
			this.phaseRow(theme, "plan", "Investigate & plan", s.total > 0 ? "done" : "0/1"),
			this.phaseRow(theme, "build", "Implement sprints", s.total > 0 ? `${buildDone}/${s.total}` : "0/0"),
			this.phaseRow(theme, "review", pattern === "pipeline" ? "Pipeline" : "Review & repair", reviewProgress),
			this.phaseRow(theme, "finish", "Finish", s.phase === "complete" ? "done" : s.phase === "failed" ? "failed" : "pending"),
		];
		const rightRows = [
			`${this.phaseIcon(theme)} ${this.c(theme, s.phase === "failed" ? "error" : "accent", this.b(theme, this.phaseLabel()))}`,
			this.agentLine(theme),
		];
		if (s.total > 0) rightRows.push(`${this.c(theme, "muted", "sprint")} ${s.sprint || 0}/${s.total}${s.sprintTitle ? ` · ${s.sprintTitle}` : ""}`);
		if (pattern !== "pipeline" && s.iteration > 0) rightRows.push(`${this.c(theme, "muted", "iteration")} ${s.iteration}/${s.maxIterations}`);
		rightRows.push(`${this.c(theme, "muted", "tools")} ${this.activeToolLine(theme)}`);
		rightRows.push(`${this.metricsLine(theme)} · ${this.c(theme, "muted", "phase")} ${formatElapsed(Date.now() - this.phaseStartedAt)} · ${this.c(theme, "muted", "sprint")} ${formatElapsed(Date.now() - this.sprintStartedAt)}`);
		const rowCount = Math.max(phaseRows.length, rightRows.length);
		const rows: string[] = [];
		for (let i = 0; i < rowCount; i++) {
			rows.push(`${this.c(theme, "border", "│")} ${fitCell(phaseRows[i] ?? "", leftWidth)} ${this.c(theme, "border", "│")} ${fitCell(rightRows[i] ?? "", rightWidth)} ${this.c(theme, "border", "│")}`);
		}
		return [top, ...rows, bottom];
	}

	private buildNormalLines(width: number, theme: WidgetTheme): string[] {
		const s = this.state;
		const pattern = s.pattern || "producer-reviewer";
		const progress = this.sprintProgressBar(theme, 18);
		const header = `${this.phaseIcon(theme)} ${this.b(theme, "Harness")} · ${pattern}${progress ? ` · ${progress}` : ""}`;
		const rows = [
			header,
			`  ${this.c(theme, "accent", this.phaseLabel())} · ${this.agentLine(theme)}`,
		];
		if (s.sprintTitle) rows.push(`  ${this.c(theme, "muted", "sprint")} ${s.sprint}/${s.total} · ${s.sprintTitle}`);
		rows.push(`  ${this.c(theme, "muted", "tools")} ${this.activeToolLine(theme)}`);
		rows.push(`  ${this.metricsLine(theme)}`);
		return rows.map((line) => truncateToWidth(line, width, "…"));
	}

	private buildCompactLines(width: number, theme: WidgetTheme): string[] {
		const s = this.state;
		const sprint = s.total > 0 ? ` ${s.sprint || 0}/${s.total}` : "";
		const agent = s.agentName ? ` · ${s.agentName}` : "";
		const metrics = ` · ↻${s.turnCount} ↑${formatTokens(s.inputTokens)} ↓${formatTokens(s.outputTokens)} $${formatCost(s.totalCost).slice(1)}`;
		return [truncateToWidth(`${this.phaseIcon(theme)} harness${sprint} · ${this.phaseLabel()}${agent}${metrics}`, width, "…")];
	}

	private buildLines(width: number, theme: WidgetTheme): string[] {
		if (width >= 80) return this.buildExpandedLines(width, theme);
		if (width >= 60) return this.buildNormalLines(width, theme);
		return this.buildCompactLines(width, theme);
	}

	private render() {
		if (!this.ctx?.ui) return;
		const s = this.state;
		const spin = SPINNER_FRAMES[this.spinnerIdx % SPINNER_FRAMES.length];
		if (this.isRunning()) {
			this.ctx.ui.setStatus("harness", `${spin} harness ${s.phase} · sprint ${s.sprint || 0}/${s.total || 0}`);
		} else {
			this.ctx.ui.setStatus("harness", undefined);
		}
		this.ctx.ui.setWidget("harness", (_tui, theme) => ({
			render: (width: number) => this.buildLines(width, theme),
			invalidate: () => {},
		}));
		this.registered = true;
	}

	startSpinner() {
		this.spinnerIdx = 0;
		this.intervalId = setInterval(() => {
			this.spinnerIdx++;
			if (this.registered) this.render();
		}, SPINNER_INTERVAL_MS);
	}

	stopSpinner() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	clear() {
		this.stopSpinner();
		if (this.ctx?.ui) {
			this.ctx.ui.setWidget("harness", undefined);
			this.ctx.ui.setStatus("harness", undefined);
		}
		this.registered = false;
	}

	/** Create an activity-tracking subscription for an agent session. */
	trackSession(session: AgentSession, agentName: string, meta: { role: AgentRole; model: string; thinking?: string }) {
		const activeTools = new Map<string, ActiveTool>();
		let turnCount = 0;
		const usage = () => {
			const current = sessionUsage(session);
			return { ...current, turnCount: Math.max(turnCount, current.turnCount) };
		};

		return session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "tool_execution_start") {
				activeTools.set(event.toolCallId, {
					id: event.toolCallId,
					name: event.toolName,
					label: shortToolName(event.toolName),
					startedAt: Date.now(),
				});
				this.update({ activeTools: [...activeTools.values()], agentName, agentRole: meta.role, agentModel: meta.model, agentThinking: meta.thinking ?? "", ...usage() });
			} else if (event.type === "tool_execution_end") {
				activeTools.delete(event.toolCallId);
				this.update({ activeTools: [...activeTools.values()], agentName, agentRole: meta.role, agentModel: meta.model, agentThinking: meta.thinking ?? "", ...usage() });
			} else if (event.type === "turn_end") {
				turnCount++;
				this.update(usage());
			} else if (event.type === "agent_end") {
				this.update({ activeTools: [], ...usage() });
			}
		});
	}
}

function shortToolName(tool: string): string {
	const map: Record<string, string> = {
		read: "reading",
		bash: "running cmd",
		edit: "editing",
		write: "writing",
		grep: "searching",
		find: "finding files",
		ls: "listing",
	};
	return map[tool] ?? tool;
}

// ─── Safe Workspace Helpers ───────────────────────────────────────────────────

function resolveProjectRoot(cwd: string): string {
	try {
		return execSync("git rev-parse --show-toplevel", { cwd }).toString().trim();
	} catch {
		return cwd;
	}
}

type HarnessWorkspace = {
	cwd: string;
	isolated: boolean;
	worktreePath?: string;
	warning?: string;
};

/**
 * Create an isolated detached git worktree for harness writes.
 * Falls back to the current cwd only when git worktree creation is unavailable.
 * This deliberately never stages, commits, resets, or bypasses hooks.
 */
async function createHarnessWorkspace(cwd: string, prompt: string): Promise<HarnessWorkspace> {
	try {
		const root = resolveProjectRoot(cwd);
		const project = root.split(/[\\/]/).pop() || "project";
		const slug = prompt
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 24) || "run";
		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const worktreePath = join(homedir(), ".pi", "worktrees", project, `harness-${stamp}-${slug}`);
		mkdirSync(join(homedir(), ".pi", "worktrees", project), { recursive: true });
		execSync(`git worktree add --detach ${JSON.stringify(worktreePath)} HEAD`, { cwd: root });
		return { cwd: worktreePath, isolated: true, worktreePath };
	} catch (err) {
		return {
			cwd,
			isolated: false,
			warning: `Could not create isolated git worktree; using current cwd without automatic git rollback. ${(err as Error).message}`,
		};
	}
}

/** Write or append to harness-run-local progress artifacts. */
function writeProgress(runDir: string, sprintNum: number, title: string, passed: boolean, detail: string) {
	const progressPath = join(runDir, "PROGRESS.md");
	const line = [
		`## Sprint ${sprintNum}: ${title}`,
		`**Status**: ${passed ? "[✓] PASS" : "[x] FAIL"}`,
		`**Detail**: ${detail.slice(0, 200)}`,
		`**Time**: ${new Date().toISOString()}`,
		"",
	].join("\n");
	if (!existsSync(progressPath)) {
		writeFileSync(progressPath, `# Harness Build Progress\n\nStarted: ${new Date().toISOString()}\n\n${line}`);
	} else {
		appendFileSync(progressPath, line);
	}

	const sprintStatePath = join(runDir, `sprint-${sprintNum}-state.json`);
	const stateJson = {
		id: `sprint-${sprintNum}`,
		title,
		status: passed ? "passed" : "failed",
		detail: detail.slice(0, 1000),
		completedAt: new Date().toISOString(),
		gates: { "review-passed": passed },
	};
	writeFileSync(sprintStatePath, JSON.stringify(stateJson, null, 2), "utf-8");
}

// ─── Workflow Script Generation ───────────────────────────────────────────────

/** Generate a reusable workflow script at .pi/workflows/{slug}.mjs and a run card. */
function generateWorkflowScript(
	cwd: string,
	prompt: string,
	specText: string,
	sprints: Sprint[],
	pattern: string,
	results: SprintResult[],
) {
	try {
		// Generate a slug from the prompt
		const slug = prompt
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "harness-run";

		const workflowsDir = join(cwd, ".pi", "workflows");
		const runsDir = join(cwd, ".pi", "harness-runs");
		mkdirSync(workflowsDir, { recursive: true });
		mkdirSync(runsDir, { recursive: true });

		// Write workflow script
		const script = `// Generated by Harness — re-run with: node .pi/workflows/${slug}.mjs
// Original prompt: ${JSON.stringify(prompt)}

import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";

const CWD = process.cwd();
const MODEL = getModel("anthropic", "claude-sonnet-4-20250514");

const sprints = ${JSON.stringify(sprints, null, 2)};

async function run() {
	console.log("Running harness workflow: ${slug}");
	console.log("Pattern: ${pattern}");
	console.log("Sprints: " + sprints.length + "\\n");

	for (const sprint of sprints) {
		console.log("\\n=== Sprint " + sprint.number + ": " + sprint.title + " ===");
		const { session: gen } = await createAgentSession({
			model: MODEL,
			tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
			sessionManager: SessionManager.inMemory(CWD),
			cwd: CWD,
		});
		await gen.prompt("Implement: " + sprint.title + "\\n" + sprint.description);
		gen.dispose();
	}
	console.log("\\nDone.");
}
run().catch(console.error);
`;
		writeFileSync(join(workflowsDir, `${slug}.mjs`), script, "utf-8");

		// Write harness run card from template
		const templatePath = join(cwd, ".pi", "templates", "harness-card.md");
		const allPassed = results.every((r) => r.passed);
		let card: string;

		if (existsSync(templatePath)) {
			const template = readFileSync(templatePath, "utf-8");
			const sprintSummary = results
				.map((r, i) => `| ${i + 1} | ${r.sprint} | ${r.passed ? "PASS" : "FAIL"} | ${r.iterations} |`)
				.join("\\n");
			card = template
				.replace(/\*\*Name:\*\*.*/m, `**Name:** ${slug}`)
				.replace(/\*\*Date:\*\*.*/m, `**Date:** ${new Date().toISOString()}`)
				.replace(/\*\*Change.*\*\*.*/m, `**Change / workflow under test:** ${prompt}`)
				.replace(/Run report path:.*/, `Run report path: .pi/harness-runs/${slug}.md`)
				.replace(/Subagent output files:.*/, `Subagent output files: .pi/workflows/${slug}.mjs`);
			card += `\\n### Results\\n| Sprint | Title | Result | Iterations |\\n|--------|-------|--------|------------|\\n${sprintSummary}`;
			card += `\\n**Status**: ${allPassed ? "All passed" : "Some failed"}`;
		} else {
			card = `# Harness Run: ${slug}\\n**Prompt**: ${prompt}\\n**Date**: ${new Date().toISOString()}\\n**Status**: ${allPassed ? "All passed" : "Some failed"}`;
		}

		writeFileSync(join(runsDir, `${slug}.md`), card, "utf-8");
		return slug;
	} catch {
		return null;
	}
}

function extractJsonObjects(text: string): string[] {
	const objects: string[] = [];
	let start = -1;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "{") {
			if (depth === 0) start = i;
			depth++;
		} else if (char === "}" && depth > 0) {
			depth--;
			if (depth === 0 && start >= 0) {
				objects.push(text.slice(start, i + 1));
				start = -1;
			}
		}
	}
	return objects;
}

/** Parse structured JSON evaluation output. Default-FAIL on malformed output. */
function parseEvalOutput(text: string): { verdict: string; criteria: Array<{ passes: boolean; evidence: string }>; summary: string } {
	for (const candidate of extractJsonObjects(text)) {
		if (!candidate.includes("verdict")) continue;
		try {
			const parsed = JSON.parse(candidate);
			return {
				verdict: parsed.verdict === "PASS" ? "PASS" : "FAIL",
				criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [],
				summary: typeof parsed.summary === "string" ? parsed.summary : "",
			};
		} catch {
			// Try the next balanced object.
		}
	}
	return {
		verdict: "FAIL",
		criteria: [{ passes: false, evidence: `Evaluator did not return valid harness JSON. Output: ${text.slice(0, 200)}` }],
		summary: text.slice(0, 100),
	};
}

// ─── Run Tracker ───────────────────────────────────────────────────────────────

/**
 * Tracks all agent conversations and artifacts for a harness run.
 * Stores everything under .pi/harness-runs/<run-id>/ organized by sprint.
 */
class HarnessTracker {
	readonly runDir: string;
	private startedAt = Date.now();
	private phaseLog: Array<{ phase: string; startedAt: number; agent: string }> = [];

	constructor(cwd: string, prompt: string) {
		const slug = prompt
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 30) || "harness";
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		this.runDir = join(cwd, ".pi", "harness-runs", `${timestamp}-${slug}`);
		try {
			mkdirSync(this.runDir, { recursive: true });
		} catch {
			// fail silently — tracking is best-effort
		}
	}

	private write(name: string, content: string) {
		try {
			writeFileSync(join(this.runDir, name), content, "utf-8");
		} catch {
			// best-effort
		}
	}

	private writeJSON(name: string, data: unknown) {
		this.write(name, JSON.stringify(data, null, 2));
	}

	startPhase(phase: string, agent: string) {
		this.phaseLog.push({ phase, startedAt: Date.now(), agent });
	}

	/** Save a full agent session transcript after prompt completes. */
	saveSession(subDir: string, role: string, session: AgentSession, systemPrompt: string) {
		const dir = join(this.runDir, subDir);
		try {
			mkdirSync(dir, { recursive: true });
		} catch {
			return;
		}

		// Write system prompt used
		writeFileSync(join(dir, `${role}-system-prompt.txt`), systemPrompt, "utf-8");

		// Write full conversation transcript
		const transcript = session.messages.map((m: any) => ({
			role: m.role,
			timestamp: m.timestamp,
			content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
			toolName: m.toolName,
			toolCallId: m.toolCallId,
		}) as any);
		this.writeJSON(`${subDir}/${role}-conversation.json`, transcript);

		// Write last assistant output as readable text
		const lastText = getLastAssistantText(session);
		if (lastText) {
			writeFileSync(join(dir, `${role}-output.txt`), lastText, "utf-8");
		}

		// Write usage summary
		let totalInput = 0,
			totalOutput = 0,
			totalCost = 0;
		for (const m of session.messages as any[]) {
			if (m.usage) {
				totalInput += m.usage.input || 0;
				totalOutput += m.usage.output || 0;
				totalCost += m.usage.cost?.total || 0;
			}
		}
		this.writeJSON(`${subDir}/${role}-usage.json`, {
			inputTokens: totalInput,
			outputTokens: totalOutput,
			totalCost: Math.round(totalCost * 10000) / 10000,
			turns: session.messages.filter((m: any) => m.role === "assistant").length,
		});
	}

	/** Write the spec from the planner. */
	saveSpec(specText: string) {
		this.write("spec.md", specText);
	}

	/** Write final build report. */
	saveReport(report: string) {
		this.write("build-report.md", report);
	}

	/** Write harness workspace/isolation metadata. */
	saveWorkspace(workspace: HarnessWorkspace) {
		this.writeJSON("workspace.json", workspace);
	}

	/** Write timing summary. */
	saveTiming() {
		const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
		const phases = this.phaseLog.map((p) => ({
			phase: p.phase,
			agent: p.agent,
			durationMs: Date.now() - p.startedAt,
		}));
		this.writeJSON("timing.json", { totalSeconds: Number(elapsed), phases });
	}
}

// ─── Extension Entry ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "harness",
		label: "Harness",
		description: [
			"Multi-agent build harness: planner → generator → evaluator loop.",
			"Decomposes a short product prompt into sprints, implements them with automated QA.",
			"Agent prompts loaded from .pi/agents/*.md at runtime.",
			"Each sprint iterates up to N times until all criteria pass.",
		].join(" "),
		promptSnippet: "Run a multi-agent build with planner, generator, and evaluator agents",
		promptGuidelines: [
			"Use harness when the task requires building a complete application from a short prompt",
			"The harness decomposes work into sprints with automated QA via a separate evaluator agent",
			"Agent definitions come from .pi/agents/planner.md, .pi/agents/worker.md, .pi/agents/reviewer.md",
		],
		parameters: Type.Object({
			prompt: Type.String({
				description: "Product idea (1-4 sentences). The planner expands this into a full spec.",
			}),
			iterations: Type.Optional(
				Type.Number({
					description: "Max generator→evaluator iterations per sprint",
					default: 3,
				}),
			),
			pattern: Type.Optional(
				Type.String({
					description: 'Architecture pattern: "producer-reviewer" (default) or "pipeline"',
					default: "producer-reviewer",
				}),
			),
			plannerAgent: Type.Optional(
				Type.String({
					description: "Agent name for planner (from .pi/agents/{name}.md). Default: harness-planner",
					default: "harness-planner",
				}),
			),
			generatorAgent: Type.Optional(
				Type.String({
					description: "Agent name for generator (from .pi/agents/{name}.md). Default: harness-worker",
					default: "harness-worker",
				}),
			),
			evaluatorAgent: Type.Optional(
				Type.String({
					description: "Agent name for evaluator (from .pi/agents/{name}.md). Default: harness-reviewer",
					default: "harness-reviewer",
				}),
			),
			plannerModel: Type.Optional(
				Type.String({
					description: 'Model override for planner, e.g. "opencode-go/mimo-v2.5"',
				}),
			),
			generatorModel: Type.Optional(
				Type.String({
					description: 'Model override for generator, e.g. "opencode-go/deepseek-v4-flash"',
				}),
			),
			evaluatorModel: Type.Optional(
				Type.String({
					description: 'Model override for evaluator, e.g. "opencode-go/deepseek-v4-flash"',
				}),
			),
			inheritContext: Type.Optional(
				Type.Boolean({
					description: "Opt in to prepend AGENTS.md and APPEND_SYSTEM.md to sub-agent prompts. Default is false because agent files are standalone system prompts.",
					default: false,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const cwd = ctx.cwd;
			const projectRoot = resolveProjectRoot(cwd);
			const maxIterations = params.iterations ?? 3;
			const pattern = params.pattern ?? "producer-reviewer";
			const inheritContext = params.inheritContext ?? false;

			// Widget for live progress
			const widget = new HarnessWidget(ctx);
			widget.update({ pattern, maxIterations });

			// Tracker for full run artifacts
			const tracker = new HarnessTracker(projectRoot, params.prompt);
			const workspace = await createHarnessWorkspace(projectRoot, params.prompt);
			const runCwd = workspace.cwd;
			tracker.saveWorkspace(workspace);

			if (workspace.warning) {
				onUpdate?.({
					content: [{ type: "text", text: `[warn] ${workspace.warning}` }],
					details: { phase: "workspace", warning: workspace.warning },
				});
			}

			// Load context files once
			const contextFiles = inheritContext ? loadContextFiles(projectRoot) : { agents: "", append: "" };

			const warnings: string[] = [];

			// --- Resolve models ---
			function resolveModel(
				spec: string | undefined,
				fallback: Model<Api>,
				label: string,
			): Model<Api> {
				if (!spec) return fallback;
				const slashIdx = spec.indexOf("/");
				if (slashIdx === -1) {
					warnings.push(`${label} model "${spec}" is invalid; expected provider/model. Falling back to ${modelLabel(fallback)}.`);
					return fallback;
				}
				if (!ctx.modelRegistry) {
					warnings.push(`${label} model "${spec}" could not be resolved because modelRegistry is unavailable. Falling back to ${modelLabel(fallback)}.`);
					return fallback;
				}
				const provider = spec.slice(0, slashIdx);
				const modelId = spec.slice(slashIdx + 1);
				const found = ctx.modelRegistry.find(provider, modelId);
				if (!found) {
					warnings.push(`${label} model "${spec}" was not found. Falling back to ${modelLabel(fallback)}.`);
				}
				return found ?? fallback;
			}

			const mainModel = ctx.model;
			if (!mainModel) {
				return {
					content: [{ type: "text", text: "[x] No active model available." }],
					details: { phase: "failed", error: "No model" },
					isError: true,
				};
			}

			// --- Load agent definitions ---
			function loadAgentDef(name: string, defaultName: string, defaultPrompt: string, defaultTools: string[]): {
				systemPrompt: string;
				tools: string[];
				model?: string;
				thinking?: string;
			} {
				const file = loadAgentFile(name, projectRoot);
				if (!file && name !== defaultName) {
					warnings.push(`Agent "${name}" was not found; falling back to built-in ${defaultName} prompt.`);
				}
				const base = file
					? file.systemPrompt
					: defaultPrompt;
				const tools = file ? file.tools : defaultTools;
				return {
					systemPrompt: wrapWithContext(base, contextFiles),
					tools,
					model: file?.model,
					thinking: file?.thinking,
				};
			}

			const plannerAgentName = params.plannerAgent ?? "harness-planner";
			const generatorAgentName = params.generatorAgent ?? "harness-worker";
			const evaluatorAgentName = params.evaluatorAgent ?? "harness-reviewer";

			const plannerDef = loadAgentDef(
				plannerAgentName,
				"harness-planner",
				DEFAULT_PLANNER_PROMPT,
				DEFAULT_PLANNER_TOOLS,
			);
			// Append harness format as the final output contract for this run.
			plannerDef.systemPrompt = plannerDef.systemPrompt + "\n\n" + HARNESS_FORMAT_INSTRUCTIONS;
			const generatorDef = loadAgentDef(
				generatorAgentName,
				"harness-worker",
				DEFAULT_GENERATOR_PROMPT,
				DEFAULT_GENERATOR_TOOLS,
			);
			const evaluatorDef = loadAgentDef(
				evaluatorAgentName,
				"harness-reviewer",
				DEFAULT_EVALUATOR_PROMPT,
				DEFAULT_EVALUATOR_TOOLS,
			);
			// Append evaluation output format instructions (Default-FAIL contract)
			evaluatorDef.systemPrompt += HARNESS_EVAL_INSTRUCTIONS;

			// Resolve model: explicit param > agent file > parent
			const resolvedPlannerModel = resolveModel(
				params.plannerModel ?? plannerDef.model,
				mainModel,
				"planner",
			);
			const resolvedGeneratorModel = resolveModel(
				params.generatorModel ?? generatorDef.model,
				mainModel,
				"generator",
			);
			const resolvedEvaluatorModel = resolveModel(
				params.evaluatorModel ?? evaluatorDef.model,
				mainModel,
				"evaluator",
			);

			for (const warning of warnings) {
				onUpdate?.({
					content: [{ type: "text", text: `[warn] ${warning}` }],
					details: { phase: "configuration", warning },
				});
			}

			function throwIfAborted() {
				if (_signal?.aborted) throw new Error("Harness run aborted");
			}

			_signal?.addEventListener("abort", () => widget.clear(), { once: true });

			// --- Helper: create a sub-agent session ---
			async function spawnAgent(opts: {
				systemPrompt: string;
				tools: string[];
				model: Model<Api>;
				thinking?: string;
				agentName: string;
				role: AgentRole;
			}): Promise<AgentSession> {
				const { session } = await createAgentSession({
					model: opts.model,
					tools: opts.tools,
					thinkingLevel: validateThinkingLevel(opts.thinking),
					sessionManager: SessionManager.inMemory(runCwd),
					resourceLoader: createMinimalLoader(opts.systemPrompt),
					cwd: runCwd,
				});
				widget.trackSession(session, opts.agentName, {
					role: opts.role,
					model: modelLabel(opts.model),
					thinking: opts.thinking,
				});
				return session;
			}

			// --- Phase 1: Plan ---
			onUpdate?.({
				content: [
					{
						type: "text",
						text: `[Start] Harness (${pattern}): Planning phase using "${plannerAgentName}" agent...`,
					},
				],
				details: { phase: "planning" },
			});

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
				totalCost: 0,
			});

			tracker.startPhase("planning", plannerAgentName);
			const planner = await spawnAgent({
				systemPrompt: plannerDef.systemPrompt,
				tools: plannerDef.tools,
				model: resolvedPlannerModel,
				thinking: plannerDef.thinking,
				agentName: plannerAgentName,
				role: "planner",
			});
			throwIfAborted();
			await planner.prompt(params.prompt);
			const specText = getLastAssistantText(planner);
			tracker.saveSession("plan", "planner", planner, plannerDef.systemPrompt);
			tracker.saveSpec(specText);
			planner.dispose();

			const sprints = parseSprints(specText);
			if (sprints.length === 0) {
				widget.clear();
				return {
					content: [
						{
							type: "text",
							text: [
								"[x] Planner couldn't produce a valid spec.",
								"",
								"Raw output:",
								"```",
								specText.slice(0, 2000),
								"```",
							].join("\n"),
						},
					],
					details: { phase: "failed", error: "No sprints parsed", spec: specText },
					isError: true,
				};
			}

			widget.update({ phase: "", sprint: 0, total: sprints.length, sprintTitle: "" });

			onUpdate?.({
				content: [
					{
						type: "text",
						text: `[Spec] Spec created: ${sprints.length} sprints. Building with "${generatorAgentName}"...`,
					},
				],
				details: { phase: "building", sprint: 0, total: sprints.length, spec: specText },
			});

			// --- Phase 2: Build + Evaluate (per sprint) ---
			const results: SprintResult[] = [];
			let passedSprintCount = 0;
			let failedSprintCount = 0;

			for (let i = 0; i < sprints.length; i++) {
				const sprint = sprints[i];
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
					totalCost: 0,
				});

				tracker.startPhase("generating", generatorAgentName);
				onUpdate?.({
					content: [{ type: "text", text: `[Build] Sprint ${i + 1}/${sprints.length}: ${sprint.title}` }],
					details: { phase: "sprint", sprint: i + 1, total: sprints.length, title: sprint.title },
				});

				const sprintTask = [
					`Implement Sprint ${i + 1}: ${sprint.title}`,
					"",
					`Description: ${sprint.description}`,
					"",
					"Criteria:",
					sprint.criteria,
				];
				if (sprint.files) sprintTask.push("", `Files: ${sprint.files}`);

				const generator = await spawnAgent({
					systemPrompt: generatorDef.systemPrompt,
					tools: generatorDef.tools,
					model: resolvedGeneratorModel,
					thinking: generatorDef.thinking,
					agentName: generatorAgentName,
					role: "generator",
				});
				throwIfAborted();
				await generator.prompt(sprintTask.join("\n"));
				tracker.saveSession(`sprint-${i + 1}`, "generator", generator, generatorDef.systemPrompt);
				generator.dispose();

				if (pattern === "pipeline") {
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

				while (!passed && iteration < maxIterations) {
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
						totalCost: 0,
					});

					tracker.startPhase("evaluating", evaluatorAgentName);
					const evaluator = await spawnAgent({
						systemPrompt: evaluatorDef.systemPrompt,
						tools: evaluatorDef.tools,
						model: resolvedEvaluatorModel,
						thinking: evaluatorDef.thinking,
						agentName: evaluatorAgentName,
						role: "evaluator",
					});
					throwIfAborted();
					await evaluator.prompt(
						[`Test Sprint ${i + 1}: ${sprint.title}`, "", "Criteria:", sprint.criteria].join("\n"),
					);
					evalText = getLastAssistantText(evaluator);
					const evalResult = parseEvalOutput(evalText);
					passed = evalResult.verdict === "PASS";
					const failedCriteria = evalResult.criteria.filter((c) => !c.passes);
					tracker.saveSession(`sprint-${i + 1}`, `evaluator-iter-${iteration + 1}`, evaluator, evaluatorDef.systemPrompt);
					evaluator.dispose();

					onUpdate?.({
						content: [{ type: "text", text: `  ${passed ? "[✓]" : "[x]"} Sprint ${i + 1} evaluation (iter ${iteration + 1}): ${passed ? "PASS" : "FAIL"}` }],
						details: { phase: "evaluation", sprint: i + 1, total: sprints.length, iteration: iteration + 1, passed, evalOutput: evalText },
					});

					if (passed) {
						writeProgress(tracker.runDir, i + 1, sprint.title, true, evalResult.summary || evalText.slice(0, 200));
						passedSprintCount++;
						widget.update({ passedSprints: passedSprintCount, failedSprints: failedSprintCount, activeTools: [] });
						break;
					}

					iteration++;
					if (iteration >= maxIterations) {
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
						totalCost: 0,
					});

					tracker.startPhase("fixing", generatorAgentName);
					const fixer = await spawnAgent({
						systemPrompt: generatorDef.systemPrompt,
						tools: generatorDef.tools,
						model: resolvedGeneratorModel,
						thinking: generatorDef.thinking,
						agentName: generatorAgentName,
						role: "generator",
					});
					throwIfAborted();
					await fixer.prompt([
						`Sprint ${i + 1}: ${sprint.title} FAILED evaluation.`,
						"",
						"Fix these issues:",
						evalText,
					].join("\n"));
					tracker.saveSession(`sprint-${i + 1}`, `generator-iter-${iteration + 1}`, fixer, generatorDef.systemPrompt);
					fixer.dispose();
				}

				results.push({
					sprint: sprint.title,
					iterations: Math.max(1, iteration + 1),
					passed,
					evalOutput: evalText,
				});
			}

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
			});

			const reportLines = results
				.map(
					(r, i) =>
						`| ${i + 1} | ${r.sprint} | ${r.passed ? "[✓] PASS" : "[x] FAIL"} | ${r.iterations} |`,
				)
				.join("\n");

			// Generate reusable workflow script (P2)
			const workflowSlug = generateWorkflowScript(projectRoot, params.prompt, specText, sprints, pattern, results);

			// Save tracking artifacts
			tracker.saveTiming();

			const finalReport = [
				"## Harness Build Results",
				"",
				`**Pattern**: ${pattern}`,
				`**Status**: ${allPassed ? "[✓] All sprints passed" : "[!] Some sprints failed"}`,
				`**Sprints**: ${sprints.length}`,
				workflowSlug ? `**Workflow**: .pi/workflows/${workflowSlug}.mjs` : "",
				`**Run dir**: .pi/harness-runs/${tracker.runDir.split("/").pop()}`,
				workspace.isolated ? `**Workspace**: ${workspace.worktreePath}` : "**Workspace**: current cwd (isolated worktree unavailable)",
				"|--------|-------|--------|------------|",
				reportLines,
				"",
				allPassed
					? "All sprints passed. Consider integration testing, deployment, and polish."
					: "Some sprints failed. Review evaluation output and apply fixes.",
			].join("\n");

			tracker.saveReport(finalReport);
			widget.clear();

			return {
				content: [{ type: "text", text: finalReport }],
				details: {
					phase: "complete",
					pattern,
					pass: allPassed,
					plannerAgent: plannerAgentName,
					generatorAgent: generatorAgentName,
					evaluatorAgent: evaluatorAgentName,
					sprints: results,
					spec: specText,
				},
			};
		},
	});
}
