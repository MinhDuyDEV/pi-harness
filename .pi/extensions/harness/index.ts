/**
 * Harness — Multi-agent build harness for long-running app development.
 *
 * Architecture: Planner → Generator ↔ Evaluator (GAN-inspired loop)
 *
 * Loads agent definitions from .pi/agents/*.md at runtime.
 * Users customize agents by editing markdown files, not TypeScript.
 *
 * Default agent mapping:
 *   planner   → .pi/agents/planner.md   (read-only, architecture)
 *   generator → .pi/agents/worker.md    (full tools, implementation)
 *   evaluator → .pi/agents/reviewer.md  (read-only, QA)
 *
 * Each sprint iterates generator↔evaluator up to N times (default 3).
 */

import type { ExtensionAPI, ResourceLoader, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	createExtensionRuntime,
	SessionManager,
	type AgentSession,
	type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Model, TextContent, Api, ThinkingLevel } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

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
	const sprints: Sprint[] = [];
	const sprintRegex = /## Sprint (\d+):\s*(.+?)\n([\s\S]*?)(?=\n## Sprint |\n*$)/g;
	let match: RegExpExecArray | null;
	while ((match = sprintRegex.exec(text)) !== null) {
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
	if (sprints.length === 0 && text.trim()) {
		const lines = text.trim().split("\n");
		const firstLine = lines[0].replace(/^#+\s*/, "").slice(0, 80);
		sprints.push({
			number: 1,
			title: firstLine || "Implementation",
			description: text.trim(),
			criteria: text.trim(),
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

interface WidgetState {
	phase: string;
	sprint: number;
	total: number;
	agentName: string;
	toolActivity: string;
	turnCount: number;
	sprintTitle: string;
	pattern: string;
	iteration: number;
}

/** Minimal theme type matching pi-tui's Theme (types not exported directly). */
type WidgetTheme = { fg: (color: string, text: string) => string; bold?: (text: string) => string };

/**
 * Manages a live TUI widget showing harness progress.
 * Pattern: similar to pi-subagents' AgentWidget but adapted for sequential harness phases.
 */
class HarnessWidget {
	private ctx: ExtensionContext;
	private state: WidgetState;
	private spinnerIdx = 0;
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private registered = false;

	constructor(ctx: ExtensionContext) {
		this.ctx = ctx;
		this.state = {
			phase: "initializing",
			sprint: 0,
			total: 0,
			agentName: "",
			toolActivity: "",
			turnCount: 0,
			sprintTitle: "",
			pattern: "",
			iteration: 0,
		};
	}

	update(partial: Partial<WidgetState>) {
		Object.assign(this.state, partial);
		this.render();
	}

	private render() {
		if (!this.ctx?.ui) return;
		const s = this.state;
		const spin = SPINNER_FRAMES[this.spinnerIdx % SPINNER_FRAMES.length];

		const isRunning =
			s.phase === "planning" ||
			s.phase === "generating" ||
			s.phase === "evaluating" ||
			s.phase === "fixing";
		const pattern = s.pattern || "producer-reviewer";

		const lines: string[] = [];

		// Header: spinner when running, static char otherwise
		const icon = isRunning
			? spin
			: s.phase === "complete"
				? "[✓]"
				: s.phase === "failed"
					? "[x]"
					: "[*]";
		lines.push(`${icon} Harness — ${pattern}`);

		// Sprint progress
		if (s.total > 0) {
			const label =
				s.sprint > 0
					? `Sprint ${s.sprint}/${s.total}`
					: `${s.total} sprints planned`;
			const title = s.sprintTitle ? `: ${s.sprintTitle}` : "";
			lines.push(`  ${label}${title}`);
		}

		// Determine if this is the last line (use └ instead of ├)
		const isLastPhase =
			s.phase === "complete" || s.phase === "failed" ||
			(s.phase !== "planning" && s.sprint >= s.total && !s.toolActivity);
		const branch = isLastPhase ? "  └" : "  ├";

		// Phase with agent
		if (s.phase === "planning") {
			const agent = s.agentName ? ` (${s.agentName})` : "";
			lines.push(`${branch} Planning${agent}`);
		} else if (s.phase === "generating") {
			const agent = s.agentName ? ` (${s.agentName})` : "";
			lines.push(`${branch} Generating${agent}`);
			if (s.toolActivity) lines.push(`  │  ${s.toolActivity}`);
			if (s.turnCount > 0) lines.push(`  │  ${s.turnCount} tool use(s)`);
		} else if (s.phase === "evaluating") {
			const agent = s.agentName ? ` (${s.agentName})` : "";
			lines.push(`${branch} Evaluating${agent} — iteration ${s.iteration}`);
			if (s.toolActivity) lines.push(`  │  ${s.toolActivity}`);
		} else if (s.phase === "fixing") {
			const agent = s.agentName ? ` (${s.agentName})` : "";
			lines.push(`${branch} Fixing${agent} — iteration ${s.iteration}`);
			if (s.toolActivity) lines.push(`  │  ${s.toolActivity}`);
		} else if (s.phase === "complete") {
			lines.push(`  └ [done] Build complete`);
		} else if (s.phase === "failed") {
			lines.push(`  └ [abort] Build failed`);
		}

		// Footer status
		if (isRunning) {
			this.ctx.ui.setStatus(
				"harness",
				`${s.phase} — sprint ${s.sprint}/${s.total}`,
			);
		} else {
			this.ctx.ui.setStatus("harness", undefined);
		}

		this.ctx.ui.setWidget("harness", lines);
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
	trackSession(session: AgentSession, agentName: string) {
		const activeTools = new Map<string, string>();
		let turnCount = 0;

		return session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "tool_execution_start") {
				activeTools.set(event.toolCallId, event.toolName);
				// Build human-readable activity
				const names = [...new Set(activeTools.values())];
				const desc = names.map((t) => shortToolName(t)).join(", ");
				this.update({ toolActivity: desc, agentName, turnCount });
			} else if (event.type === "tool_execution_end") {
				activeTools.delete(event.toolCallId);
				const names = [...new Set(activeTools.values())];
				const desc = names.length > 0 ? names.map((t) => shortToolName(t)).join(", ") : "";
				this.update({ toolActivity: desc, agentName, turnCount });
			} else if (event.type === "turn_end") {
				turnCount++;
				this.update({ turnCount });
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

// ─── Git Helpers ───────────────────────────────────────────────────────────────

/** Create a git checkpoint before a sprint. Returns the commit hash to revert to. */
async function gitCheckpoint(cwd: string): Promise<string | null> {
	try {
		const { execSync } = await import("node:child_process");
		// Record HEAD before sprint
		const head = execSync("git rev-parse HEAD", { cwd }).toString().trim();
		// Stage all changes and create lightweight commit
		execSync("git add -A", { cwd });
		const status = execSync("git status --porcelain", { cwd }).toString().trim();
		if (status) {
			execSync('git commit -m "harness: checkpoint" --allow-empty --no-verify', { cwd });
		}
		return head;
	} catch {
		return null; // Not a git repo or git unavailable — no-op
	}
}

/** Revert to checkpoint on evaluation failure. */
async function gitRevert(cwd: string, checkpointHash: string): Promise<boolean> {
	try {
		const { execSync } = await import("node:child_process");
		execSync(`git reset --hard ${checkpointHash}`, { cwd });
		return true;
	} catch {
		return false;
	}
}

/** Commit after a passing sprint. */
async function gitCommitSprint(cwd: string, sprintNum: number, title: string): Promise<boolean> {
	try {
		const { execSync } = await import("node:child_process");
		execSync("git add -A", { cwd });
		execSync(
			`git commit -m "harness: sprint ${sprintNum} - ${title}" --allow-empty --no-verify`,
			{ cwd },
		);
		return true;
	} catch {
		return false;
	}
}

/** Write or append to PROGRESS.md. */
function writeProgress(cwd: string, sprintNum: number, title: string, passed: boolean, detail: string) {
	const { appendFileSync, existsSync, writeFileSync, readFileSync } = require("node:fs");
	const { join } = require("node:path");
	const progressPath = join(cwd, "PROGRESS.md");
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

	// Also write sprint-state.json per sprint (from template)
	const sprintStatePath = join(cwd, `.pi`, `sprint-${sprintNum}-state.json`);
	const templatePath = join(cwd, ".pi", "templates", "sprint-state.json");
	let stateJson: any;
	if (existsSync(templatePath)) {
		try {
			stateJson = JSON.parse(readFileSync(templatePath, "utf-8"));
		} catch {
			stateJson = null;
		}
	}
	if (!stateJson) {
		stateJson = {
			id: `sprint-${sprintNum}`,
			title,
			currentPhase: "build",
			phases: { build: { status: passed ? "completed" : "failed" } },
			gates: { "review-passed": passed },
		};
	} else {
		stateJson.id = `sprint-${sprintNum}`;
		stateJson.title = title;
		stateJson.metrics.completedAt = new Date().toISOString();
		stateJson.phases.think.status = "completed";
		stateJson.phases.plan.status = "completed";
		stateJson.phases.build.status = "completed";
		stateJson.phases.build.completedAt = new Date().toISOString();
		if (passed) {
			stateJson.phases.review.status = "completed";
			stateJson.phases.qa.status = "completed";
			stateJson.gates["review-passed"] = true;
			stateJson.gates["qa-passed"] = true;
		} else {
			stateJson.phases.review.status = "failed";
			stateJson.phases.qa.status = "failed";
		}
	}
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
		const { writeFileSync, mkdirSync, readFileSync, existsSync } = require("node:fs");
		const { join } = require("node:path");

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
// Original prompt: ${prompt.replace(/"/g, '\\"')}

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

/** Parse structured JSON evaluation output. */
function parseEvalOutput(text: string): { verdict: string; criteria: Array<{ passes: boolean; evidence: string }>; summary: string } {
	// Try to extract JSON from the text
	const jsonMatch = text.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
	if (jsonMatch) {
		try {
			const parsed = JSON.parse(jsonMatch[0]);
			return {
				verdict: parsed.verdict || "FAIL",
				criteria: parsed.criteria || [],
				summary: parsed.summary || "",
			};
		} catch {
			// fall through
		}
	}
	// Fallback: text-based detection
	return {
		verdict: text.includes("PASS") && !text.includes("FAIL") ? "PASS" : "FAIL",
		criteria: [{ passes: !text.includes("FAIL"), evidence: text.slice(0, 200) }],
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
					description: "Agent name for planner (from .pi/agents/{name}.md). Default: planner",
					default: "planner",
				}),
			),
			generatorAgent: Type.Optional(
				Type.String({
					description: "Agent name for generator (from .pi/agents/{name}.md). Default: worker",
					default: "worker",
				}),
			),
			evaluatorAgent: Type.Optional(
				Type.String({
					description: "Agent name for evaluator (from .pi/agents/{name}.md). Default: reviewer",
					default: "reviewer",
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
					description: "Inherit AGENTS.md and APPEND_SYSTEM.md rules into sub-agents",
					default: true,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const cwd = ctx.cwd;
			const maxIterations = params.iterations ?? 3;
			const pattern = params.pattern ?? "producer-reviewer";
			const inheritContext = params.inheritContext ?? true;

			// Widget for live progress
			const widget = new HarnessWidget(ctx);
			widget.update({ pattern });

			// Tracker for full run artifacts
			const tracker = new HarnessTracker(cwd, params.prompt);

			// Load context files once
			const contextFiles = inheritContext ? loadContextFiles(cwd) : { agents: "", append: "" };

			// --- Resolve models ---
			function resolveModel(
				spec: string | undefined,
				fallback: Model<Api>,
			): Model<Api> {
				if (!spec) return fallback;
				const slashIdx = spec.indexOf("/");
				if (slashIdx === -1 || !ctx.modelRegistry) return fallback;
				const provider = spec.slice(0, slashIdx);
				const modelId = spec.slice(slashIdx + 1);
				const found = ctx.modelRegistry.find(provider, modelId);
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
			function loadAgentDef(name: string, defaultPrompt: string, defaultTools: string[]): {
				systemPrompt: string;
				tools: string[];
				model?: string;
				thinking?: string;
			} {
				const file = loadAgentFile(name, cwd);
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

			const plannerDef = loadAgentDef(
				params.plannerAgent ?? "planner",
				DEFAULT_PLANNER_PROMPT,
				DEFAULT_PLANNER_TOOLS,
			);
			// Prepend output format instructions for sprint parsing (overrides agent's own format)
			plannerDef.systemPrompt = HARNESS_FORMAT_INSTRUCTIONS + "\n" + plannerDef.systemPrompt;
			const generatorDef = loadAgentDef(
				params.generatorAgent ?? "worker",
				DEFAULT_GENERATOR_PROMPT,
				DEFAULT_GENERATOR_TOOLS,
			);
			const evaluatorDef = loadAgentDef(
				params.evaluatorAgent ?? "reviewer",
				DEFAULT_EVALUATOR_PROMPT,
				DEFAULT_EVALUATOR_TOOLS,
			);
			// Append evaluation output format instructions (Default-FAIL contract)
			evaluatorDef.systemPrompt += HARNESS_EVAL_INSTRUCTIONS;

			// Resolve model: explicit param > agent file > parent
			const resolvedPlannerModel = resolveModel(
				params.plannerModel ?? plannerDef.model,
				mainModel,
			);
			const resolvedGeneratorModel = resolveModel(
				params.generatorModel ?? generatorDef.model,
				mainModel,
			);
			const resolvedEvaluatorModel = resolveModel(
				params.evaluatorModel ?? evaluatorDef.model,
				mainModel,
			);

			// --- Helper: create a sub-agent session ---
			async function spawnAgent(opts: {
				systemPrompt: string;
				tools: string[];
				model: Model<Api>;
				thinking?: string;
				agentName: string;
			}): Promise<AgentSession> {
				const { session } = await createAgentSession({
					model: opts.model,
					tools: opts.tools,
					thinkingLevel: validateThinkingLevel(opts.thinking),
					sessionManager: SessionManager.inMemory(cwd),
					resourceLoader: createMinimalLoader(opts.systemPrompt),
					cwd,
				});
				// Track tool activity in the widget
				widget.trackSession(session, opts.agentName);
				return session;
			}

			// --- Phase 1: Plan ---
			onUpdate?.({
				content: [
					{
						type: "text",
						text: `[Start] Harness (${pattern}): Planning phase using "${params.plannerAgent ?? "planner"}" agent...`,
					},
				],
				details: { phase: "planning" },
			});

			widget.startSpinner();
			widget.update({ phase: "planning", agentName: params.plannerAgent ?? "planner" });

			tracker.startPhase("planning", params.plannerAgent ?? "planner");
			const planner = await spawnAgent({
				systemPrompt: plannerDef.systemPrompt,
				tools: plannerDef.tools,
				model: resolvedPlannerModel,
				thinking: plannerDef.thinking,
				agentName: params.plannerAgent ?? "planner",
			});
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
						text: `[Spec] Spec created: ${sprints.length} sprints. Building with "${params.generatorAgent ?? "worker"}"...`,
					},
				],
				details: { phase: "building", sprint: 0, total: sprints.length, spec: specText },
			});

			// --- Phase 2: Build + Evaluate (per sprint) ---
			const generator = await spawnAgent({
				systemPrompt: generatorDef.systemPrompt,
				tools: generatorDef.tools,
				model: resolvedGeneratorModel,
				thinking: generatorDef.thinking,
				agentName: params.generatorAgent ?? "worker",
			});
			const evaluator = await spawnAgent({
				systemPrompt: evaluatorDef.systemPrompt,
				tools: evaluatorDef.tools,
				model: resolvedEvaluatorModel,
				thinking: evaluatorDef.thinking,
				agentName: params.evaluatorAgent ?? "reviewer",
			});

			const results: SprintResult[] = [];

			// Git checkpoint before first sprint (P1)
			const checkpointHash = await gitCheckpoint(cwd);

			for (let i = 0; i < sprints.length; i++) {
				const sprint = sprints[i];
				// --- Generate ---
				widget.update({
					phase: "generating",
					sprint: i + 1,
					total: sprints.length,
					sprintTitle: sprint.title,
					iteration: 0,
				});

				tracker.startPhase("generating", params.generatorAgent ?? "worker");

				onUpdate?.({
					content: [
						{
							type: "text",
							text: `[Build] Sprint ${i + 1}/${sprints.length}: ${sprint.title}`,
						},
					],
					details: {
						phase: "sprint",
						sprint: i + 1,
						total: sprints.length,
						title: sprint.title,
					},
				});

					tracker.startPhase("generating", params.generatorAgent ?? "worker");
				tracker.startPhase("evaluating", params.evaluatorAgent ?? "reviewer");
				const sprintTask = [
					`Implement Sprint ${i + 1}: ${sprint.title}`,
					"",
					`Description: ${sprint.description}`,
					"",
					"Criteria:",
					sprint.criteria,
				];
				if (sprint.files) sprintTask.push("", `Files: ${sprint.files}`);

				await generator.prompt(sprintTask.join("\n"));

				// Save generator session for this sprint
				tracker.saveSession(
					`sprint-${i + 1}`,
					"generator",
					generator,
					generatorDef.systemPrompt,
				);

				if (pattern === "pipeline") {
					// Pipeline mode: no iteration, just generate and move on
					tracker.saveSession(`sprint-${i + 1}`, "generator", generator, generatorDef.systemPrompt);
					results.push({
						sprint: sprint.title,
						iterations: 1,
						passed: true,
						evalOutput: "(pipeline mode — no evaluation)",
					});
					continue;
				}

				// --- Evaluate (producer-reviewer mode, iterate up to maxIterations) ---
				let passed = false;
				let evalText = "";
				let iteration = 0;

				while (!passed && iteration < maxIterations) {
					widget.update({
						phase: "evaluating",
						iteration: iteration + 1,
						agentName: params.evaluatorAgent ?? "reviewer",
					});

					tracker.startPhase("evaluating", params.evaluatorAgent ?? "reviewer");
					await evaluator.prompt(
						[
							`Test Sprint ${i + 1}: ${sprint.title}`,
							"",
							"Criteria:",
							sprint.criteria,
						].join("\n"),
					);
					evalText = getLastAssistantText(evaluator);

					// Default-FAIL: parse structured JSON output (P0)
					const evalResult = parseEvalOutput(evalText);
					passed = evalResult.verdict === "PASS";
					const failedCriteria = evalResult.criteria.filter((c) => !c.passes);

					// Save evaluator session for this iteration
					tracker.saveSession(
						`sprint-${i + 1}`,
						`evaluator-iter-${iteration + 1}`,
						evaluator,
						evaluatorDef.systemPrompt,
					);

					onUpdate?.({
						content: [
							{
								type: "text",
								text: `  ${passed ? "[✓]" : "[x]"} Sprint ${i + 1} evaluation (iter ${iteration + 1}): ${passed ? "PASS" : "FAIL"}`,
							},
						],
						details: {
							phase: "evaluation",
							sprint: i + 1,
							total: sprints.length,
							iteration: iteration + 1,
							passed,
							evalOutput: evalText,
						},
					});

					if (passed) {
						// Git commit after passing sprint (P1)
						await gitCommitSprint(cwd, i + 1, sprint.title);
						writeProgress(cwd, i + 1, sprint.title, true, evalResult.summary || evalText.slice(0, 200));
						break;
					}

					iteration++;
					if (iteration >= maxIterations) {
						// Revert to checkpoint on final failure (P1)
						if (checkpointHash) await gitRevert(cwd, checkpointHash);
						writeProgress(cwd, i + 1, sprint.title, false, failedCriteria.map((c) => c.evidence).join("; "));
						break;
					}

					widget.update({
						phase: "fixing",
						iteration: iteration + 1,
						agentName: params.generatorAgent ?? "worker",
					});

					await generator.prompt(
						[
							`Sprint ${i + 1}: ${sprint.title} FAILED evaluation.`,
							"",
							"Fix these issues:",
							evalText,
						].join("\n"),
					);
						tracker.saveSession(
						`sprint-${i + 1}`,
						`generator-iter-${iteration + 1}`,
						generator,
						generatorDef.systemPrompt,
					);
				}

				results.push({
					sprint: sprint.title,
					iterations: iteration + 1,
					passed,
					evalOutput: evalText,
				});
			}

			// Cleanup
			generator.dispose();
			evaluator.dispose();

			widget.stopSpinner();
			const allPassed = results.every((r) => r.passed);
			widget.update({
				phase: allPassed ? "complete" : "failed",
				sprintTitle: "",
				toolActivity: "",
				agentName: "",
			});

			// Auto-clear widget after 10 seconds
			setTimeout(() => widget.clear(), 10000);
			const reportLines = results
				.map(
					(r, i) =>
						`| ${i + 1} | ${r.sprint} | ${r.passed ? "[✓] PASS" : "[x] FAIL"} | ${r.iterations} |`,
				)
				.join("\n");

			// Generate reusable workflow script (P2)
			const workflowSlug = generateWorkflowScript(cwd, params.prompt, specText, sprints, pattern, results);

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
				"|--------|-------|--------|------------|",
				reportLines,
				"",
				allPassed
					? "All sprints passed. Consider integration testing, deployment, and polish."
					: "Some sprints failed. Review evaluation output and apply fixes.",
			].join("\n");

			tracker.saveReport(finalReport);

			return {
				content: [{ type: "text", text: finalReport }],
				details: {
					phase: "complete",
					pattern,
					pass: allPassed,
					plannerAgent: params.plannerAgent ?? "planner",
					generatorAgent: params.generatorAgent ?? "worker",
					evaluatorAgent: params.evaluatorAgent ?? "reviewer",
					sprints: results,
					spec: specText,
				},
			};
		},
	});
}
