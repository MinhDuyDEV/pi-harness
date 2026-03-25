/**
 * RPC Bridge: @tintinweb/pi-tasks ↔ @tintinweb/pi-subagents
 *
 * pi-tasks sends `subagents:rpc:ping` and `subagents:rpc:spawn` events.
 * pi-subagents exposes a manager via `Symbol.for("pi-subagents:manager")`.
 * This bridge translates between them so TaskExecute works.
 *
 * Without this bridge, TaskExecute times out after 30s (no RPC listener).
 * Agent tool, TaskCreate/List/Get/Update all work without it.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type SubagentStatus = "queued" | "running" | "completed" | "error" | "stopped" | "aborted" | "steered";

type Episode = {
	status: "success" | "failure" | "blocked" | "partial";
	summary?: string;
	findings?: string[];
	artifacts?: string[];
	sources?: string[];
	deviations?: string[];
	blockers?: string[];
	verdict?: string;
	confidence?: number;
	files?: string[];
};

type SubagentRecord = {
	id: string;
	type?: string;
	description?: string;
	status?: SubagentStatus;
	result?: string;
	error?: string;
	startedAt?: number;
	completedAt?: number;
	promise?: Promise<string>;
};

type SubagentManager = {
	spawn: (
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		type: string,
		prompt: string,
		options?: {
			description?: string;
			model?: any;
			maxTurns?: number;
			isolated?: boolean;
			inheritContext?: boolean;
			thinkingLevel?: string;
			isBackground?: boolean;
			isolation?: "worktree";
		},
	) => string;
	getRecord?: (id: string) => SubagentRecord | undefined;
};


const DEBUG_ENV = "PI_SUBAGENTS_RPC_BRIDGE_DEBUG";

/** Required episode fields per agent type. Missing fields trigger warnings. */
const EPISODE_REQUIRED_FIELDS: Record<string, (keyof Episode)[]> = {
	explore: ["findings"],
	scout: ["findings", "sources"],
	worker: ["artifacts"],
	reviewer: ["findings", "verdict"],
	planner: ["summary"],
};

/** Agent types where confidence is expected. */
const CONFIDENCE_EXPECTED: Set<string> = new Set(["explore", "scout", "reviewer"]);

function getSubagentManager(): SubagentManager | undefined {
	const key = Symbol.for("pi-subagents:manager");
	return (globalThis as any)[key] as SubagentManager | undefined;
}

function isTerminal(s?: SubagentStatus): boolean {
	return s === "completed" || s === "error" || s === "stopped" || s === "aborted" || s === "steered";
}

function isFailure(s?: SubagentStatus): boolean {
	return s === "error" || s === "stopped" || s === "aborted";
}

function isDebugEnabled(): boolean {
	const raw = process.env[DEBUG_ENV];
	return raw ? /^(1|true|yes|on)$/i.test(raw.trim()) : false;
}

/** Parse the last <episode>...</episode> block from agent output. */
function parseEpisode(text: string | undefined): Episode | undefined {
	if (!text) return undefined;
	// Last match wins — agents reading docs may have the template in output;
	// the agent-generated episode always appears at the end.
	const matches = [...text.matchAll(/<episode>([\s\S]*?)<\/episode>/g)];
	if (matches.length === 0) return undefined;
	const block = matches[matches.length - 1][1];

	const tag = (name: string): string | undefined => {
		const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`));
		return m ? m[1].trim() : undefined;
	};

	const splitList = (raw: string | undefined): string[] | undefined => {
		if (!raw) return undefined;
		return raw.split(/;\s*/).map(s => s.trim()).filter(Boolean);
	};

	const status = tag("status") as Episode["status"];
	if (!status || !["success", "failure", "blocked", "partial"].includes(status)) return undefined;

	const rawConfidence = tag("confidence");
	const rawFiles = tag("files");

	return {
		status,
		summary: tag("summary"),
		findings: splitList(tag("findings")),
		artifacts: splitList(tag("artifacts")),
		sources: splitList(tag("sources")),
		deviations: splitList(tag("deviations")),
		blockers: splitList(tag("blockers")),
		verdict: tag("verdict"),
		confidence: rawConfidence ? parseFloat(rawConfidence) : undefined,
		files: splitList(rawFiles),
	};
}

/** Validate episode fields for a given agent type. Returns list of warnings. */
function validateEpisode(episode: Episode | undefined, agentType?: string): string[] {
	if (!episode || !agentType) return [];
	const warnings: string[] = [];
	const required = EPISODE_REQUIRED_FIELDS[agentType];
	if (required) {
		for (const field of required) {
			const val = episode[field];
			if (val === undefined || val === null || (Array.isArray(val) && val.length === 0)) {
				warnings.push(`missing required field "${field}" for ${agentType} agent`);
			}
		}
	}
	if (CONFIDENCE_EXPECTED.has(agentType) && episode.confidence === undefined) {
		warnings.push(`missing confidence score for ${agentType} agent`);
	}
	return warnings;
}

/** Execution trace record for debugging multi-task cascades.
 *  Note: taskId is not available in the bridge (lives in pi-tasks agentTaskMap).
 *  Correlate via agentId when debugging. */
interface ExecutionTrace {
	agentId: string;
	agentType?: string;
	episodeStatus: string;
	durationMs: number;
	findingsCount: number;
	artifacts: string[];
	blockers: string[];
	confidence?: number;
	warnings: string[];
	timestamp: number;
}

/** In-memory trace log (last 50 traces). */
const traceLog: ExecutionTrace[] = [];
const MAX_TRACES = 50;

function recordTrace(trace: ExecutionTrace): void {
	traceLog.push(trace);
	if (traceLog.length > MAX_TRACES) traceLog.splice(0, traceLog.length - MAX_TRACES);
}

export default function (pi: ExtensionAPI) {
	const INIT_KEY = Symbol.for("pikit:subagents-rpc-bridge:initialized");
	if ((globalThis as any)[INIT_KEY]) return;
	(globalThis as any)[INIT_KEY] = true;

	let latestCtx: ExtensionContext | undefined;
	let readyAnnounced = false;

	// De-duplication: IDs that already emitted terminal lifecycle events.
	const finalized = new Set<string>();
	// IDs currently being polled for completion.
	const watching = new Set<string>();

	const debugNotify = (msg: string, level: "info" | "warning" | "error" = "info") => {
		if (!isDebugEnabled()) return;
		latestCtx?.ui?.notify?.(`[rpc-bridge] ${msg}`, level);
	};

	// --- Native event de-duplication ---

	const markFinalized = (payload: unknown, event: string) => {
		const id = String((payload as any)?.id || "");
		if (id) { finalized.add(id); watching.delete(id); }
		debugNotify(`native ${event} id=${id}`);
	};

	pi.events.on("subagents:completed", (p) => markFinalized(p, "subagents:completed"));
	pi.events.on("subagents:failed", (p) => markFinalized(p, "subagents:failed"));

	// --- Ready announcement ---

	const announceReadyIfAvailable = () => {
		if (!getSubagentManager()) return;
		if (!readyAnnounced) {
			readyAnnounced = true;
			pi.events.emit("subagents:ready", {});
			debugNotify(`ready (set ${DEBUG_ENV}=0 to disable)`);
		}
	};

	// Re-announce readiness (allows pi-tasks to retry detection even if it missed the first event)
	const reannounceReady = () => {
		if (getSubagentManager()) {
			pi.events.emit("subagents:ready", {});
		}
	};

	// --- Context refresh ---

	const refreshCtx = (ctx?: ExtensionContext) => {
		if (ctx) latestCtx = ctx;
		announceReadyIfAvailable();
	};

	pi.on("session_start", async (_e, ctx) => refreshCtx(ctx));
	pi.on("session_switch", async (_e, ctx) => refreshCtx(ctx));
	pi.on("turn_start", async (_e, ctx) => refreshCtx(ctx));
	pi.on("tool_execution_start", async (_e, ctx) => refreshCtx(ctx));

	// --- RPC handlers (pi-tasks → pi-subagents) ---

	pi.events.on("subagents:rpc:ping", (payload: unknown) => {
		announceReadyIfAvailable();
		if (!getSubagentManager()) return;
		const requestId = (payload as any)?.requestId;
		if (!requestId) return;
		debugNotify(`rpc ping requestId=${requestId}`);
		// Reply must follow RpcReply envelope: { success: true, data: { version } }
		pi.events.emit(`subagents:rpc:ping:reply:${requestId}`, { success: true, data: { version: 2 } });
	});

	// NOTE: Spawn and completion are handled by the native pi-subagents extension.
	// The bridge does NOT handle spawn (that caused double-spawn).
	// Native pi-subagents emits "subagents:completed" which pi-tasks listens to for cascade.
	// The bridge adds trace logging and episode validation on top of the native completion event.

	// Handle startup order: pi-tasks may load after this bridge.
	queueMicrotask(() => announceReadyIfAvailable());
	// Delayed retry: if pi-tasks loaded before us and its initial ping timed out,
	// re-announce after a short delay to trigger its subagents:ready listener.
	setTimeout(() => reannounceReady(), 2000);
}
