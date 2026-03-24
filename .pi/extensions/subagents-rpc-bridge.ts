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

const WATCH_POLL_MS = 250;
const WATCH_TIMEOUT_MS = 10 * 60 * 1000;
const DEBUG_ENV = "PI_SUBAGENTS_RPC_BRIDGE_DEBUG";

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

export default function (pi: ExtensionAPI) {
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

	// --- Lifecycle watching (poll + promise) ---

	const emitTerminalIfNeeded = (id: string, record?: SubagentRecord) => {
		if (finalized.has(id) || !record || !isTerminal(record.status)) return;
		finalized.add(id);
		watching.delete(id);

		const episode = parseEpisode(record.result);

		if (isFailure(record.status)) {
			pi.events.emit("subagents:failed", { id, error: record.error ?? record.status, status: record.status, episode });
			debugNotify(`emit failed id=${id} status=${record.status}${episode ? ` episode=${episode.status}` : ""}`, "warning");
		} else {
			pi.events.emit("subagents:completed", { id, result: record.result, status: record.status, episode });
			debugNotify(`emit completed id=${id} status=${record.status}${episode ? ` episode=${episode.status}` : ""}`);
		}
	};

	const watchAgentLifecycle = (manager: SubagentManager, id: string) => {
		if (watching.has(id) || finalized.has(id)) return;
		watching.add(id);
		const start = Date.now();

		const tick = () => {
			if (finalized.has(id)) { clearInterval(interval); return; }
			const record = manager.getRecord?.(id);
			emitTerminalIfNeeded(id, record);
			if (isTerminal(record?.status)) { clearInterval(interval); return; }
			if (Date.now() - start > WATCH_TIMEOUT_MS) {
				clearInterval(interval);
				watching.delete(id);
				if (!finalized.has(id)) {
					finalized.add(id);
					pi.events.emit("subagents:failed", { id, error: "bridge lifecycle timeout", status: "error" });
					debugNotify(`timeout id=${id}`, "error");
				}
			}
		};

		const interval = setInterval(tick, WATCH_POLL_MS);
		tick();

		const record = manager.getRecord?.(id);
		if (record?.promise) {
			record.promise
				.then(() => { emitTerminalIfNeeded(id, manager.getRecord?.(id)); clearInterval(interval); })
				.catch(() => { emitTerminalIfNeeded(id, manager.getRecord?.(id)); clearInterval(interval); });
		}
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
		if (readyAnnounced || !getSubagentManager()) return;
		readyAnnounced = true;
		pi.events.emit("subagents:ready", {});
		debugNotify(`ready (set ${DEBUG_ENV}=0 to disable)`);
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
		pi.events.emit(`subagents:rpc:ping:reply:${requestId}`, {});
	});

	pi.events.on("subagents:rpc:spawn", (payload: unknown) => {
		const requestId = (payload as any)?.requestId;
		if (!requestId) return;

		try {
			const manager = getSubagentManager();
			if (!manager) throw new Error("@tintinweb/pi-subagents manager not available");
			if (!latestCtx) throw new Error("No extension context yet; try again after one turn");

			const type = (payload as any)?.type;
			const prompt = (payload as any)?.prompt;
			const options = { ...((payload as any)?.options ?? {}) } as Parameters<SubagentManager["spawn"]>[4];

			if (!type || !prompt) throw new Error("Missing required spawn fields: type or prompt");
			if (options.isBackground === undefined) options.isBackground = true;

			debugNotify(`rpc spawn requestId=${requestId} type=${String(type)}`);
			const id = manager.spawn(pi, latestCtx, String(type), String(prompt), options);

			watchAgentLifecycle(manager, id);
			pi.events.emit(`subagents:rpc:spawn:reply:${requestId}`, { id });
			debugNotify(`rpc spawn reply id=${id}`);
		} catch (error: any) {
			const msg = error instanceof Error ? error.message : String(error);
			pi.events.emit(`subagents:rpc:spawn:reply:${requestId}`, { error: msg });
			debugNotify(`rpc spawn error: ${msg}`, "error");
		}
	});

	// Handle startup order: pi-tasks may load after this bridge.
	queueMicrotask(() => announceReadyIfAvailable());
}
