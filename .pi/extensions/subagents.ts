/**
 * pikit-subagents — Multi-subagent Delegation Extension
 *
 * Built-in subagent management inspired by OpenAI Codex spawn-and-forward model
 * and the pi-subagents extension pattern.
 *
 * Registers tools for spawning, monitoring, steering, and collecting results from
 * sub-agents using Pi SDK's native `createAgentSession`.
 *
 * Features:
 *   - Depth-aware delegation (prevents runaway chains)
 *   - Configurable tool allowlisting per subagent (security)
 *   - Background and blocking modes
 *   - Agent registry with live status tracking
 *   - Result collection with timeout handling
 *   - Support for model-specific routing
 */

import { Type } from "@sinclair/typebox";
import {
	createAgentSession,
	type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AgentMessage } from "@earendil-works/pi-agent-core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DEPTH = 3;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const POLL_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubagentInfo {
	id: string;
	nickname: string;
	type: string;
	modelId: string | undefined;
	status: "running" | "completed" | "error" | "aborted" | "timeout";
	task: string;
	depth: number;
	parentId: string | undefined;
	createdAt: number;
	completedAt: number | undefined;
	error: string | undefined;
	result: string | undefined;
	session: any | undefined; // The underlying AgentSession
	abortController: AbortController | undefined;
}

interface AgentRegistryEntry {
	id: string;
	nickname: string;
	type: string;
	model: string | undefined;
	status: SubagentInfo["status"];
	task: string;
	depth: number;
	createdAt: number;
	completedAt: number | undefined;
	error: string | undefined;
}

// ---------------------------------------------------------------------------
// Agent Registry
// ---------------------------------------------------------------------------

class AgentRegistry {
	private agents = new Map<string, SubagentInfo>();
	private nicknameCounters = new Map<string, number>();
	private static idCounter = 0;

	private static nextId(): string {
		return `sa-${++this.idCounter}`;
	}

	generateNickname(type: string): string {
		const count = (this.nicknameCounters.get(type) ?? 0) + 1;
		this.nicknameCounters.set(type, count);
		// Pick a nickname based on type
		const names: Record<string, string[]> = {
			worker: ["Builder", "Craftsman", "Maker", "Forger", "Artisan"],
			explore: ["Scout", "Pathfinder", "Surveyor", "Navigator", "Trailblazer"],
			scout: ["Rover", "Sentry", "Lookout", "Vanguard", "Pioneer"],
			planner: ["Architect", "Designer", "Strategist", "Blueprint", "Visionary"],
			reviewer: ["Inspector", "Auditor", "Critic", "Examiner", "Overseer"],
		};
		const pool = names[type] ?? ["Agent"];
		const idx = (count - 1) % pool.length;
		const name = pool[idx];
		const suffix = count > pool.length ? ` the ${ordinal(count - pool.length + 1)}` : "";
		return `${name}${suffix}`;
	}

	register(
		info: Omit<SubagentInfo, "id"> & { id?: string },
	): SubagentInfo {
		const id = info.id ?? AgentRegistry.nextId();
		const entry: SubagentInfo = { ...info, id };
		this.agents.set(id, entry);
		return entry;
	}

	get(id: string): SubagentInfo | undefined {
		return this.agents.get(id);
	}

	update(id: string, updates: Partial<SubagentInfo>): void {
		const entry = this.agents.get(id);
		if (entry) Object.assign(entry, updates);
	}

	list(): AgentRegistryEntry[] {
		return Array.from(this.agents.values())
			.sort((a, b) => b.createdAt - a.createdAt)
			.map(({ id, nickname, type, modelId, status, task, depth, createdAt, completedAt, error }) => ({
				id, nickname, type, model: modelId, status, task, depth,
				createdAt, completedAt, error: error ?? undefined,
			}));
	}

	remove(id: string): boolean {
		return this.agents.delete(id);
	}

	count(): number {
		return this.agents.size;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ordinal(n: number): string {
	const suffixes = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return n + (suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Global registry (shared across all sessions)
// ---------------------------------------------------------------------------

const registry = new AgentRegistry();

// ---------------------------------------------------------------------------
// Subagent spawning
// ---------------------------------------------------------------------------

async function spawnSubagent(
	task: string,
	type: string,
	options: {
		model?: string;
		tools?: string[];
		noTools?: "all" | "builtin";
		timeout?: number;
		depth?: number;
		parentId?: string;
		mode?: "background" | "blocking";
		abortController?: AbortController;
	},
): Promise<SubagentInfo> {
	const nickname = registry.generateNickname(type);
	const depth = options.depth ?? 0;

	if (depth > MAX_DEPTH) {
		throw new Error(`Delegation depth ${depth} exceeds maximum ${MAX_DEPTH}. Cannot spawn subagent.`);
	}

	// Build session creation options
	const sessionOptions: CreateAgentSessionOptions = {
		noTools: options.noTools,
		tools: options.tools,
	};

	const agent = await createAgentSession(sessionOptions);

	const info = registry.register({
		id: undefined, // auto-generate
		nickname,
		type,
		modelId: options.model,
		status: "running",
		task,
		depth,
		parentId: options.parentId,
		createdAt: Date.now(),
		completedAt: undefined,
		error: undefined,
		result: undefined,
		session: agent.session,
		abortController: options.abortController ?? new AbortController(),
	});

	// Send the task as a prompt to the sub-agent
	agent.session.agent.prompt(task).catch((err: Error) => {
		registry.update(info.id, {
			status: "error",
			error: err.message,
			completedAt: Date.now(),
		});
	});

	return info;
}

async function collectResult(
	agentId: string,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
	const info = registry.get(agentId);
	if (!info) throw new Error(`Agent ${agentId} not found`);
	if (!info.session) throw new Error(`Agent ${agentId} has no session`);

	const startTime = Date.now();
	const timeoutAt = startTime + timeoutMs;

	while (Date.now() < timeoutAt) {
		if (info.abortController?.signal.aborted) {
			registry.update(agentId, { status: "aborted", completedAt: Date.now() });
			return "[Agent aborted]";
		}

		try {
			// Check if agent is done by waiting for idle with a short timeout
			await Promise.race([
				info.session.waitForIdle(),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("timeout")), POLL_INTERVAL_MS),
				),
			]);

			// Agent is idle -- collect the result
			const state = info.session.state;
			const messages = state.messages ?? [];
			const lastAssistantMsg = [...messages]
				.reverse()
				.find((m: AgentMessage) => m.role === "assistant");

			const result = typeof lastAssistantMsg?.content === "string"
				? lastAssistantMsg.content
				: JSON.stringify(lastAssistantMsg?.content ?? "[No response]");

			registry.update(agentId, { status: "completed", completedAt: Date.now(), result });
			return result;
		} catch {
			// Not idle yet, continue polling
			continue;
		}
	}

	// Timeout
	info.abortController?.abort();
	registry.update(agentId, { status: "timeout", completedAt: Date.now(), error: "Timeout exceeded" });
	return "[Agent timeout]";
}

// ---------------------------------------------------------------------------
// Tool Registration Helper
// ---------------------------------------------------------------------------

function registerTool(
	pi: ExtensionAPI,
	name: string,
	label: string,
	description: string,
	parameters: any,
	executor: (params: Record<string, unknown>, signal: AbortSignal) => Promise<string>,
	promptSnippet?: string,
): void {
	pi.registerTool({
		name,
		label,
		description,
		parameters,
		...(promptSnippet && { promptSnippet }),
		async execute(
			_toolCallId: string,
			params: Record<string, unknown>,
			signal: AbortSignal,
			_onUpdate: (text: string) => void,
			_ctx: any,
		) {
			try {
				const text = await executor(params, signal);
				return { content: [{ type: "text" as const, text }], details: {} };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `subagents error: ${msg}` }],
					details: {},
				};
			}
		},
	});
}

// ---------------------------------------------------------------------------
// Main Extension Entry Point
// ---------------------------------------------------------------------------

export default function subagentsExtension(pi: ExtensionAPI): void {
	// ---- Tool: agent_spawn ----
	registerTool(
		pi,
		"agent_spawn",
		"Spawn Subagent",
		"Spawn a sub-agent to perform a task. " +
			"Inspired by OpenAI Codex's delegation model and pi-subagents. " +
			"Supported types: worker, explore, scout, planner, reviewer. " +
			"Use mode:'background' to run in parallel, mode:'blocking' to wait for result. " +
			"Tools can be restricted via `tools` allowlist for security. " +
			"Depth is auto-tracked to prevent runaway delegation.",
		Type.Object({
			task: Type.String({
				description: "Task description for the sub-agent to execute.",
			}),
			type: Type.Optional(
				Type.String({
					description: "Agent type: 'worker' (default), 'explore', 'scout', 'planner', 'reviewer'.",
				}),
			),
			mode: Type.Optional(
				Type.String({
					description: "'background' (default) — spawn and continue; 'blocking' — wait for result.",
				}),
			),
			model: Type.Optional(
				Type.String({
					description: "Model override (e.g. 'deepseek-ai/DeepSeek-V4-Flash'). Omit for orchestrator's model.",
				}),
			),
			tools: Type.Optional(
				Type.Array(Type.String(), {
					description: "Tool allowlist for security (e.g. ['read', 'bash']). Omit for all tools.",
				}),
			),
			noTools: Type.Optional(
				Type.String({
					description: "'all' — no tools; 'builtin' — disable read/bash/edit/write.",
				}),
			),
			timeout: Type.Optional(
				Type.Number({
					description: "Timeout in milliseconds (default 120000).",
				}),
			),
		}),
		async (params, signal) => {
			const task = String(params.task);
			const type = optionalString(params.type) ?? "worker";
			const mode = optionalString(params.mode) ?? "background";
			const model = optionalString(params.model);
			const tools = params.tools as string[] | undefined;
			const noTools = optionalString(params.noTools) as "all" | "builtin" | undefined;
			const timeout = optionalNumber(params.timeout) ?? DEFAULT_TIMEOUT_MS;

			const info = await spawnSubagent(task, type, {
				model,
				tools,
				noTools,
				timeout,
				depth: 0,
				mode,
				abortController: new AbortController(),
			});

			// Note: after registry.register, info.id is always set
			const agentId = info.id!;

			if (mode === "blocking") {
				const result = await collectResult(agentId, timeout);
				return [
					`[Subagent ${info.nickname} (#${info.id}) — ${type}]`,
					`Status: completed`,
					`Depth: ${info.depth}`,
					`Duration: ${((Date.now() - info.createdAt) / 1000).toFixed(1)}s`,
					"",
					result,
				].join("\n");
			}

			return [
				`[Subagent ${info.nickname} (#${info.id})] spawned`,
				`Type: ${type}`,
				`Mode: background`,
				`Status: running`,
				`Depth: ${info.depth}`,
				`Task: ${task}`,
				"",
				`Use agent_result({ agentId: "${info.id}" }) to retrieve results.`,
			].join("\n");
		},
		"Spawn a sub-agent to perform a task. Returns agent ID for result collection.",
	);

	// ---- Tool: agent_result ----
	registerTool(
		pi,
		"agent_result",
		"Get Subagent Result",
		"Retrieve the result of a spawned sub-agent. " +
			"Works on both running and completed agents. " +
			"For running agents, blocks until complete or timeout.",
		Type.Object({
			agentId: Type.String({
				description: "Agent ID returned by agent_spawn.",
			}),
			timeout: Type.Optional(
				Type.Number({
					description: "Timeout in milliseconds (default 120000).",
				}),
			),
		}),
		async (params, signal) => {
			const agentId = String(params.agentId);
			const timeout = optionalNumber(params.timeout) ?? DEFAULT_TIMEOUT_MS;

			const info = registry.get(agentId);
			if (!info) {
				return `Agent ${agentId} not found. Use agent_list to see active agents.`;
			}

			if (info.status === "completed") {
				return [
					`[Subagent ${info.nickname} (#${info.id}) — ${info.type}]`,
					`Status: completed`,
					`Duration: ${((info.completedAt! - info.createdAt) / 1000).toFixed(1)}s`,
					"",
					info.result ?? "[No result]",
				].join("\n");
			}

			if (info.status === "error") {
				return [
					`[Subagent ${info.nickname} (#${info.id}) — ${info.type}]`,
					`Status: error`,
					`Error: ${info.error}`,
				].join("\n");
			}

			if (info.status === "timeout" || info.status === "aborted") {
				return [
					`[Subagent ${info.nickname} (#${info.id}) — ${info.type}]`,
					`Status: ${info.status}`,
				].join("\n");
			}

			// Still running — wait for result
			const result = await collectResult(agentId, timeout);
			return [
				`[Subagent ${info.nickname} (#${info.id}) — ${info.type}]`,
				`Status: completed`,
				`Duration: ${((Date.now() - info.createdAt) / 1000).toFixed(1)}s`,
				"",
				result,
			].join("\n");
		},
		"Retrieve result from a spawned sub-agent.",
	);

	// ---- Tool: agent_list ----
	registerTool(
		pi,
		"agent_list",
		"List Subagents",
		"List all spawned sub-agents with their current status. " +
			"Shows: id, nickname, type, status, task, depth, duration.",
		Type.Object({
			status: Type.Optional(
				Type.String({
					description: "Filter by status: 'running', 'completed', 'error', 'timeout', 'aborted'.",
				}),
			),
		}),
		async (params, signal) => {
			const statusFilter = optionalString(params.status);
			let agents = registry.list();

			if (statusFilter) {
				agents = agents.filter((a) => a.status === statusFilter);
			}

			if (agents.length === 0) {
				return "No sub-agents found.";
			}

			const header = `${"ID".padEnd(12)} ${"Nickname".padEnd(18)} ${"Type".padEnd(12)} ${"Status".padEnd(12)} ${"Depth".padEnd(6)} ${"Duration".padEnd(10)} Task`;
			const separator = "-".repeat(80);
			const rows = agents.map((a) => {
				const duration = a.completedAt
					? `${((a.completedAt - a.createdAt) / 1000).toFixed(1)}s`
					: `${((Date.now() - a.createdAt) / 1000).toFixed(1)}s*`;
				return `${a.id.padEnd(12)} ${a.nickname.padEnd(18)} ${a.type.padEnd(12)} ${a.status.padEnd(12)} ${String(a.depth).padEnd(6)} ${duration.padEnd(10)} ${a.task.slice(0, 30)}`;
			});

			return [
				`Active agents: ${agents.filter((a) => a.status === "running").length}/${registry.count()}`,
				"",
				header,
				separator,
				...rows,
			].join("\n");
		},
		"List spawned sub-agents and their status.",
	);

	// ---- Tool: agent_stop ----
	registerTool(
		pi,
		"agent_stop",
		"Stop Subagent",
		"Stop a running sub-agent by ID. " +
			"The agent will be aborted and its current result (if any) is discarded.",
		Type.Object({
			agentId: Type.String({
				description: "Agent ID to stop.",
			}),
		}),
		async (params, signal) => {
			const agentId = String(params.agentId);
			const info = registry.get(agentId);

			if (!info) {
				return `Agent ${agentId} not found.`;
			}

			if (info.status !== "running") {
				return `Agent ${info.nickname} (#${agentId}) is already ${info.status}.`;
			}

			info.abortController?.abort();
			info.session?.agent.abort();
			registry.update(agentId, { status: "aborted", completedAt: Date.now() });

			return `[Subagent ${info.nickname} (#${agentId})] stopped.`;
		},
		"Stop a running sub-agent.",
	);

	// ---- Tool: agent_steer ----
	registerTool(
		pi,
		"agent_steer",
		"Steer Subagent",
		"Send a steering message to a running sub-agent. " +
			"The message is queued and injected after the current turn completes. " +
			"Use to redirect, clarify, or provide additional context.",
		Type.Object({
			agentId: Type.String({
				description: "Agent ID to steer.",
			}),
			message: Type.String({
				description: "Steering message to send to the sub-agent.",
			}),
		}),
		async (params, signal) => {
			const agentId = String(params.agentId);
			const message = String(params.message);

			const info = registry.get(agentId);
			if (!info) {
				return `Agent ${agentId} not found.`;
			}

			if (info.status !== "running") {
				return `Agent ${info.nickname} (#${agentId}) is ${info.status} and cannot be steered.`;
			}

			if (!info.session) {
				return `Agent ${info.nickname} (#${agentId}) has no active session.`;
			}

			try {
				info.session.agent.steer({ role: "user", content: message });
				return `[Subagent ${info.nickname} (#${agentId})] steering message queued.`;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return `Failed to steer agent ${agentId}: ${msg}`;
			}
		},
		"Send a steering message to a running sub-agent.",
	);

	// ---- Tool: agent_depth ----
	registerTool(
		pi,
		"agent_depth",
		"Delegation Depth",
		"Check the current delegation depth. " +
			"The orchestrator is depth 0. Each spawned sub-agent increments depth. " +
			"Maximum allowed depth is 3.",
		Type.Object({}),
		async (params, signal) => {
			const agents = registry.list();
			const maxDepth = Math.max(0, ...agents.map((a) => a.depth));
			const running = agents.filter((a) => a.status === "running").length;

			return [
				`Delegation depth: ${maxDepth}/${MAX_DEPTH}`,
				`Active sub-agents: ${running}`,
				`Total spawned: ${agents.length}`,
				"",
				"Depth hierarchy:",
				...agents
					.sort((a, b) => a.createdAt - b.createdAt)
					.map((a) => {
						const indent = "  ".repeat(a.depth);
						return `${indent}[d${a.depth}] ${a.nickname} (#${a.id}) — ${a.status}`;
					}),
			].join("\n");
		},
		"Check current delegation depth and agent hierarchy.",
	);
}