/**
 * Widget rendering for the Harness extension.
 *
 * Provides a live TUI widget showing harness progress: workflow phase,
 * active agent metadata, sprint/review progress, active tools, and elapsed time.
 *
 * Renders at three detail levels depending on available terminal width:
 *   expanded (≥80 columns), normal (≥60 columns), compact (<60 columns).
 */

import type { ExtensionContext, ThemeColor, AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Braille spinner frames — industry standard for TUI (pi built-in, unicode-animations npm).
 * Each frame is a 2×4 braille dot pattern, cycling through all dot states.
 * Standard interval: 80ms.
 * Source: https://www.npmjs.com/package/unicode-animations and pi's own setWorkingIndicator().
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

export type HarnessPhase = "initializing" | "planning" | "generating" | "evaluating" | "fixing" | "complete" | "failed" | "";
export type AgentRole = "planner" | "generator" | "evaluator";
export type VerificationGateStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "unverifiable";
export type ReviewStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type WidgetTraceQualityStatus = "pending" | "weak" | "ok" | "strong";

export type ActiveTool = {
	id: string;
	name: string;
	label: string;
	startedAt: number;
};

export interface WidgetState {
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
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
	sprintTitle: string;
	pattern: string;
	iteration: number;
	maxIterations: number;
	passedSprints: number;
	failedSprints: number;
	ownedFiles: string;
	verificationCommandCount: number;
	verificationStatus: VerificationGateStatus;
	reviewStatus: ReviewStatus;
	runnerMode: string;
	riskLane: string;
	contextItemCount: number;
	proofItemCount: number;
	traceQuality: WidgetTraceQualityStatus;
	dependencyCount: number;
	frictionCount: number;
}

/** Minimal theme type matching pi-tui's Theme (types not exported directly). */
export type WidgetTheme = { fg: (color: ThemeColor, text: string) => string; bold?: (text: string) => string };

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

function splitFiles(files: string): string[] {
	return files
		.split(/[\n,]+/)
		.map((file) => file.trim())
		.filter(Boolean);
}

function compactFiles(files: string): string {
	const items = splitFiles(files);
	if (items.length === 0) return "—";
	if (items.length === 1) return items[0];
	return `${items[0]} +${items.length - 1}`;
}

function statusWord(status: VerificationGateStatus | ReviewStatus): string {
	switch (status) {
		case "running":
			return "RUN";
		case "passed":
			return "PASS";
		case "failed":
			return "FAIL";
		case "skipped":
			return "SKIP";
		case "unverifiable":
			return "NONE";
		default:
			return "WAIT";
	}
}

function statusColor(status: VerificationGateStatus | ReviewStatus): ThemeColor {
	if (status === "passed") return "success";
	if (status === "failed") return "error";
	if (status === "running") return "accent";
	if (status === "unverifiable") return "muted";
	return "muted";
}

function traceWord(status: WidgetTraceQualityStatus): string {
	switch (status) {
		case "strong":
			return "STRONG";
		case "ok":
			return "OK";
		case "weak":
			return "WEAK";
		default:
			return "WAIT";
	}
}

function traceColor(status: WidgetTraceQualityStatus): ThemeColor {
	if (status === "strong") return "success";
	if (status === "ok") return "accent";
	if (status === "weak") return "error";
	return "muted";
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

/** Accumulate usage metrics from an agent session's messages. */
type MessageWithUsage = {
	role?: unknown;
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		cost?: { total?: number };
	};
};

export function sessionUsage(session: AgentSession): Pick<WidgetState, "turnCount" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "totalCost"> {
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	let totalCost = 0;
	let turnCount = 0;
	for (const message of session.messages as readonly MessageWithUsage[]) {
		if (message.role === "assistant") turnCount++;
		if (message.usage) {
			inputTokens += message.usage.input || 0;
			outputTokens += message.usage.output || 0;
			cacheReadTokens += message.usage.cacheRead || 0;
			cacheWriteTokens += message.usage.cacheWrite || 0;
			totalCost += message.usage.cost?.total || 0;
		}
	}
	return { turnCount, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalCost };
}

export class HarnessWidget {
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
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
			sprintTitle: "",
			pattern: "",
			iteration: 0,
			maxIterations: 3,
			passedSprints: 0,
			failedSprints: 0,
			ownedFiles: "",
			verificationCommandCount: 0,
			verificationStatus: "pending",
			reviewStatus: "pending",
			runnerMode: "",
			riskLane: "normal",
			contextItemCount: 0,
			proofItemCount: 0,
			traceQuality: "pending",
			dependencyCount: 0,
			frictionCount: 0,
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
			`${this.c(theme, "muted", "cache")} ${formatTokens(s.cacheReadTokens)}/${formatTokens(s.cacheWriteTokens)}`,
			`${this.c(theme, "muted", "¤")} ${formatCost(s.totalCost)}`,
		].join(" · ");
	}

	private statusBadge(theme: WidgetTheme, status: VerificationGateStatus | ReviewStatus): string {
		return this.c(theme, statusColor(status), statusWord(status));
	}

	private taskStatus(theme: WidgetTheme): string {
		const s = this.state;
		if (s.phase === "complete") return this.c(theme, "success", "PASS");
		if (s.phase === "failed") return this.c(theme, "error", "FAIL");
		if (this.isRunning()) return this.c(theme, "accent", "RUN");
		return this.c(theme, "muted", "WAIT");
	}

	private writeLockLine(theme: WidgetTheme): string {
		const s = this.state;
		const lock = s.agentRole === "generator" ? compactFiles(s.ownedFiles) : "read-only";
		return `${this.c(theme, "muted", "lock")} ${lock}`;
	}

	private gateLine(theme: WidgetTheme): string {
		const s = this.state;
		const count = s.verificationCommandCount > 0 ? ` · ${s.verificationCommandCount} cmd` : "";
		return `${this.c(theme, "muted", "gate")} ${this.statusBadge(theme, s.verificationStatus)}${count}`;
	}

	private reviewLine(theme: WidgetTheme): string {
		return `${this.c(theme, "muted", "review")} ${this.statusBadge(theme, this.state.reviewStatus)}`;
	}

	private runnerLine(theme: WidgetTheme): string {
		const mode = this.state.runnerMode || "sdk";
		return `${this.c(theme, "muted", "runner")} ${mode}`;
	}

	private planLine(theme: WidgetTheme): string {
		const s = this.state;
		const parts = [
			`${this.c(theme, "muted", "lane")} ${s.riskLane || "normal"}`,
			`${this.c(theme, "muted", "ctx")} ${s.contextItemCount}`,
			`${this.c(theme, "muted", "proof")} ${s.proofItemCount}`,
			`${this.c(theme, "muted", "trace")} ${this.c(theme, traceColor(s.traceQuality), traceWord(s.traceQuality))}`,
		];
		if (s.dependencyCount > 0) parts.push(`${this.c(theme, "muted", "dep")} ${s.dependencyCount}`);
		if (s.frictionCount > 0) parts.push(`${this.c(theme, "muted", "fri")} ${s.frictionCount}`);
		return parts.join(" · ");
	}

	private buildExpandedLines(width: number, theme: WidgetTheme): string[] {
		const totalWidth = Math.max(80, width);
		const contentWidth = totalWidth - 7;
		const leftWidth = Math.min(34, Math.max(28, Math.floor(contentWidth * 0.34)));
		const rightWidth = contentWidth - leftWidth;
		const s = this.state;
		const pattern = s.pattern || "producer-reviewer";
		const progress = this.sprintProgressBar(theme, 26);
		const title = ` Harness MC · ${pattern} · ${progress || "planning"} · ${formatElapsed(Date.now() - this.startedAt)} `;
		const top = `${this.c(theme, "border", "╭")}${this.c(theme, "borderAccent", borderSegment(" Phase graph ", leftWidth + 2))}${this.c(theme, "border", "┬")}${this.c(theme, "borderAccent", borderSegment(title, rightWidth + 2))}${this.c(theme, "border", "╮")}`;
		const bottom = `${this.c(theme, "border", "╰")}${this.c(theme, "border", "─".repeat(leftWidth + 2))}${this.c(theme, "border", "┴")}${this.c(theme, "border", "─".repeat(rightWidth + 2))}${this.c(theme, "border", "╯")}`;
		const buildDone = Math.min(s.total, s.passedSprints + s.failedSprints);
		const reviewProgress = pattern === "pipeline" ? "skipped" : s.iteration > 0 ? `${s.iteration}/${s.maxIterations}` : `0/${s.maxIterations}`;
		const phaseRows = [
			this.phaseRow(theme, "plan", "Plan manifest", s.total > 0 ? `${s.total} tasks` : "0/1"),
			this.phaseRow(theme, "build", "Implement owned seams", s.total > 0 ? `${buildDone}/${s.total}` : "0/0"),
			this.phaseRow(theme, "review", pattern === "pipeline" ? "Deterministic gate" : "Gate + reviewer", reviewProgress),
			this.phaseRow(theme, "finish", "Merge decision", s.phase === "complete" ? "passed" : s.phase === "failed" ? "failed" : "pending"),
		];
		const sprintLabel = s.total > 0 ? `${s.sprint || 0}/${s.total}` : "planning";
		const rightRows = [
			`${this.taskStatus(theme)} ${this.c(theme, s.phase === "failed" ? "error" : "accent", this.b(theme, this.phaseLabel()))}`,
			`${this.c(theme, "muted", "task")} ${s.sprintTitle || "sprint manifest"} ${this.c(theme, "dim", `(${sprintLabel})`)}`,
			this.planLine(theme),
			`${this.agentLine(theme)} · ${this.runnerLine(theme)}`,
			`${this.writeLockLine(theme)} · ${this.gateLine(theme)} · ${this.reviewLine(theme)}`,
		];
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
		const header = `${this.taskStatus(theme)} ${this.b(theme, "Harness")} · ${pattern}${progress ? ` · ${progress}` : ""}`;
		const rows = [
			header,
			`  ${this.c(theme, "accent", this.phaseLabel())} · ${this.agentLine(theme)}`,
		];
		if (s.sprintTitle) rows.push(`  ${this.c(theme, "muted", "task")} ${s.sprint}/${s.total} · ${s.sprintTitle}`);
		rows.push(`  ${this.planLine(theme)}`);
		rows.push(`  ${this.writeLockLine(theme)} · ${this.gateLine(theme)} · ${this.reviewLine(theme)}`);
		rows.push(`  ${this.c(theme, "muted", "tools")} ${this.activeToolLine(theme)}`);
		rows.push(`  ${this.metricsLine(theme)}`);
		return rows.map((line) => truncateToWidth(line, width, "…"));
	}

	private buildCompactLines(width: number, theme: WidgetTheme): string[] {
		const s = this.state;
		const sprint = s.total > 0 ? ` ${s.sprint || 0}/${s.total}` : "";
		const agent = s.agentName ? ` · ${s.agentName}` : "";
		const gate = ` · gate:${statusWord(s.verificationStatus)}`;
		const trace = ` · trace:${traceWord(s.traceQuality)}`;
		const metrics = ` · ↻${s.turnCount} ↑${formatTokens(s.inputTokens)} ↓${formatTokens(s.outputTokens)} c${formatTokens(s.cacheReadTokens)}/${formatTokens(s.cacheWriteTokens)} $${formatCost(s.totalCost).slice(1)}`;
		return [truncateToWidth(`${this.taskStatus(theme)} harness${sprint}${gate}${trace} · ${this.phaseLabel()}${agent}${metrics}`, width, "…")];
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

	getMetrics(): Pick<WidgetState, "turnCount" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "totalCost"> {
		return {
			turnCount: this.state.turnCount,
			inputTokens: this.state.inputTokens,
			outputTokens: this.state.outputTokens,
			cacheReadTokens: this.state.cacheReadTokens,
			cacheWriteTokens: this.state.cacheWriteTokens,
			totalCost: this.state.totalCost,
		};
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
