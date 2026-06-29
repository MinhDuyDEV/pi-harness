/**
 * Agent loading and model resolution for the Harness extension.
 *
 * Loads agent definitions from .pi/agents/*.md at runtime.
 * Users customize agents by editing markdown files, not TypeScript.
 *
 * Default agent mapping:
 *   planner   → .pi/agents/harness-planner.md  (strict sprint manifest)
 *   generator → .pi/agents/harness-worker.md   (single-sprint implementation)
 *   evaluator → .pi/agents/harness-reviewer.md (strict JSON QA)
 */

import type { ResourceLoader } from "@earendil-works/pi-coding-agent";
import type { Model, Api, ThinkingLevel } from "@earendil-works/pi-ai";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { parseMarkdownFrontmatter } from "./parsing.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentFrontmatter {
	description?: string;
	model?: string;
	thinking?: string;
	max_turns?: number;
	tools?: string;
	disallowed_tools?: string;
	prompt_mode?: string;
}

export interface AgentConfig {
	systemPrompt: string;
	tools: string[];
	model?: string;
	thinking?: string;
}

/** Validate a raw thinking level string against the allowed values. */
export function validateThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) return undefined;
	const valid: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"];
	return valid.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;
}

// ─── Context Files ────────────────────────────────────────────────────────────

/**
 * Load context files (AGENTS.md, APPEND_SYSTEM.md) from project or global locations.
 * Priority: project > global.
 */
export function loadContextFiles(cwd: string): { agents: string; append: string } {
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
export function wrapWithContext(
	basePrompt: string,
	context: { agents: string; append: string },
): string {
	const parts: string[] = [];
	if (context.agents) parts.push(context.agents.trimEnd() + "\n");
	parts.push(basePrompt);
	if (context.append) parts.push("\n" + context.append.trim());
	return parts.join("\n");
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
export const DEFAULT_PLANNER_TOOLS = ["read", "grep", "find", "ls"];
export const DEFAULT_GENERATOR_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
export const DEFAULT_EVALUATOR_TOOLS = ["read", "grep", "find", "ls"];

export const DEFAULT_PLANNER_PROMPT = `You are a software architect. Your job is to expand a brief product idea into a strict sprint manifest.

Output only numbered sprint sections. Each sprint must include every required field:
- Description
- Lane: tiny, normal, or high-risk
- Risk Flags: concrete comma-separated flags, or none
- Context Needed: exact files/docs the worker should read
- Proof Required: unit/typecheck/build/e2e/manual proof shape
- Criteria: testable checklist items
- Files: planned write ownership

Format each sprint as:

## Sprint N: Title
Description: ...
Lane: normal
Risk Flags: none
Context Needed:
- path/to/relevant-file.ts
Proof Required:
- npm test
Criteria:
- [ ] Criterion 1
- [ ] Criterion 2
Verification Commands:
- npm test
Files: path/to/file1.ts, path/to/file2.ts`;

export const DEFAULT_GENERATOR_PROMPT = `You are a senior full-stack developer. You implement features one sprint at a time.

For each sprint:
1. Read the sprint description and criteria
2. Implement the feature in the current working directory
3. Self-evaluate before declaring done
4. If you receive evaluation feedback with FAIL, fix the specific issues

Work in the existing project at the current working directory. Do not modify files outside the sprint scope.
When done, signal completion.`;

export const DEFAULT_EVALUATOR_PROMPT = `You are a skeptical QA engineer. Your job is to test each sprint thoroughly.

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

function parseToolList(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);
}

/**
 * Build a ResourceLoader for harness child sessions.
 *
 * The harness owns the system prompt, but it should still expose project/global
 * extension tools, skills, and prompt resources to child agents. Using
 * DefaultResourceLoader keeps extension-provided tools such as webclaw
 * available when the agent allowlist names them.
 */
export async function createHarnessResourceLoader(systemPrompt: string, cwd: string): Promise<ResourceLoader> {
	const { DefaultResourceLoader, getAgentDir } = await import("@earendil-works/pi-coding-agent");
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		systemPrompt,
	});
	await loader.reload();
	return loader;
}

/**
 * Load an agent definition from .pi/agents/{name}.md.
 * Returns the frontmatter fields and body as the system prompt.
 * Returns null if the file doesn't exist.
 */
export function loadAgentFile(name: string, projectDir: string): AgentConfig | null {
	const filePath = resolve(projectDir, ".pi", "agents", `${name}.md`);
	if (!existsSync(filePath)) return null;

	const raw = readFileSync(filePath, "utf-8");
	const { frontmatter, body } = parseMarkdownFrontmatter(raw);

	const fm = frontmatter as unknown as AgentFrontmatter;

	// Resolve tools: explicit `tools:` allowlist if provided, otherwise all built-ins.
	// In both cases, remove anything listed in `disallowed_tools:`.
	// (Previously merged in default xai_* side tools too, but the local
	// xai fork keeps the xai_* tools available, so no merge is needed.)
	const disallowed = new Set(parseToolList(fm.disallowed_tools));
	const baseTools = fm.tools ? parseToolList(fm.tools) : [...BUILTIN_TOOL_NAMES];
	const tools = baseTools.filter((tool) => !disallowed.has(tool));

	return {
		systemPrompt: body,
		tools,
		model: fm.model || undefined,
		thinking: fm.thinking || undefined,
	};
}

/** Human-readable model label: provider/id */
export function modelLabel(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

/**
 * Resolve a model spec string against the model registry.
 * Preserves current defaults, overrides, and fallback behavior.
 * Invalid or unresolvable specs fall back gracefully with warnings.
 */
export function resolveModel(
	spec: string | undefined,
	fallback: Model<Api>,
	label: string,
	warnings: string[],
	modelRegistry?: { find: (provider: string, modelId: string) => Model<Api> | undefined },
): Model<Api> {
	if (!spec) return fallback;
	const slashIdx = spec.indexOf("/");
	if (slashIdx === -1) {
		warnings.push(`${label} model "${spec}" is invalid; expected provider/model. Falling back to ${modelLabel(fallback)}.`);
		return fallback;
	}
	if (!modelRegistry) {
		warnings.push(`${label} model "${spec}" could not be resolved because modelRegistry is unavailable. Falling back to ${modelLabel(fallback)}.`);
		return fallback;
	}
	const provider = spec.slice(0, slashIdx);
	const modelId = spec.slice(slashIdx + 1);
	const found = modelRegistry.find(provider, modelId);
	if (!found) {
		warnings.push(`${label} model "${spec}" was not found. Falling back to ${modelLabel(fallback)}.`);
	}
	return found ?? fallback;
}
