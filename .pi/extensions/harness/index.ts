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
 *
 * Execution orchestration is delegated to ./orchestrator.js, git safety
 * to ./gitSafety.js. This module registers the tool and wires parameters
 * to the orchestrator.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { resolveProjectRoot } from "./gitSafety.js";
import { orchestrateHarnessRun } from "./orchestrator.js";

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
			tmuxMode: Type.Optional(
				Type.Union([
					Type.Literal("watch"),
					Type.Literal("off"),
				], {
					description: 'Tmux observability mode. "watch" shows harness execution in tmux when available. "off" disables tmux. Default: watch.',
					default: "watch",
				}),
			),
			workspace: Type.Optional(
				Type.Union([
					Type.Literal("current"),
					Type.Literal("worktree"),
					Type.Literal("auto"),
				], {
					description: 'Workspace mode. "current" runs in the active workspace (default). "worktree" creates an isolated detached git worktree. "auto" currently aliases current unless future policy changes.',
					default: "current",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const cwd = ctx.cwd;
			const projectRoot = resolveProjectRoot(cwd);
			const model = ctx.model;

			if (!model) {
				const errContent: TextContent = { type: "text" as const, text: "[x] No active model available." };
				return {
					content: [errContent],
					details: { phase: "failed", error: "No model" },
					isError: true,
				};
			}

			const availableToolNames = new Set(pi.getAllTools().map((tool) => tool.name));

			return orchestrateHarnessRun(
				{
					prompt: params.prompt,
					iterations: params.iterations ?? 3,
					pattern: params.pattern ?? "producer-reviewer",
					plannerAgent: params.plannerAgent ?? "harness-planner",
					generatorAgent: params.generatorAgent ?? "harness-worker",
					evaluatorAgent: params.evaluatorAgent ?? "harness-reviewer",
					plannerModel: params.plannerModel,
					generatorModel: params.generatorModel,
					evaluatorModel: params.evaluatorModel,
					inheritContext: params.inheritContext ?? false,
					tmuxMode: params.tmuxMode ?? "watch",
					workspace: params.workspace ?? "current",
				},
				{
					cwd,
					projectRoot,
					model,
					modelRegistry: ctx.modelRegistry,
					signal: _signal,
					onUpdate,
					ctx,
					availableToolNames,
				},
			);
		},
	});
}
