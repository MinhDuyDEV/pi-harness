/**
 * Focused unit tests for harness TUI widget rendering.
 *
 * Run: npx tsx .pi/extensions/harness/widgets.test.ts
 */

import { strict as assert } from "node:assert";
import { visibleWidth } from "@earendil-works/pi-tui";

import { HarnessWidget, type WidgetTheme } from "./widgets.js";

type WidgetFactory = (_tui: unknown, theme: WidgetTheme) => { render: (width: number) => string[]; invalidate: () => void };

function renderWidget(width: number, update: Parameters<HarnessWidget["update"]>[0]): string[] {
	let factory: WidgetFactory | undefined;
	const ctx = {
		ui: {
			setStatus() {},
			setWidget(_key: string, value: WidgetFactory | undefined) {
				factory = value;
			},
		},
	};
	const widget = new HarnessWidget(ctx as never);
	widget.update(update);
	assert.ok(factory, "widget registered a render factory");
	const theme: WidgetTheme = { fg: (_color, text) => text, bold: (text) => text };
	const lines = factory(undefined, theme).render(width);
	widget.clear();
	return lines;
}

{
	const lines = renderWidget(100, {
		phase: "evaluating",
		pattern: "producer-reviewer",
		runnerMode: "sdk",
		sprint: 2,
		total: 4,
		sprintTitle: "Runtime seam",
		agentName: "harness-reviewer",
		agentRole: "evaluator",
		agentModel: "deepseek-v4-flash",
		ownedFiles: "package.json, vite.config.ts, src/runtime.ts",
		verificationCommandCount: 2,
		verificationStatus: "failed",
		reviewStatus: "running",
		riskLane: "high-risk",
		contextItemCount: 2,
		proofItemCount: 3,
		traceQuality: "weak",
		dependencyCount: 1,
		frictionCount: 2,
		iteration: 1,
		maxIterations: 3,
	});
	const output = lines.join("\n");
	assert.ok(output.includes("Phase graph"), "expanded widget labels the phase graph");
	assert.ok(output.includes("dep 1") && output.includes("fri 2"), "expanded widget shows dependency and friction counts");
	assert.ok(output.includes("task") && output.includes("Runtime seam"), "expanded widget shows the current task");
	assert.ok(output.includes("lock read-only"), "reviewer rows show read-only lock semantics");
	assert.ok(output.includes("gate FAIL · 2 cmd"), "expanded widget shows deterministic gate status and command count");
	assert.ok(output.includes("review RUN"), "expanded widget separates reviewer status from gate status");
	assert.ok(output.includes("lane high-risk") && output.includes("trace WEAK"), "expanded widget shows risk lane and trace quality");
	for (const line of lines) assert.ok(visibleWidth(line) <= 100, `line exceeds width: ${line}`);
}

{
	const lines = renderWidget(72, {
		phase: "generating",
		pattern: "pipeline",
		runnerMode: "interactive-pane",
		sprint: 1,
		total: 1,
		sprintTitle: "Entrypoint migration",
		agentName: "harness-worker",
		agentRole: "generator",
		ownedFiles: "src/index.tsx, src/App.tsx",
		verificationCommandCount: 1,
		verificationStatus: "pending",
		reviewStatus: "skipped",
		riskLane: "normal",
		contextItemCount: 1,
		proofItemCount: 1,
		traceQuality: "pending",
	});
	const output = lines.join("\n");
	assert.ok(output.includes("lock src/index.tsx +1"), "generator rows compact planned write ownership");
	assert.ok(output.includes("gate WAIT · 1 cmd"), "normal widget shows pending gate command");
	assert.ok(output.includes("ctx 1") && output.includes("proof 1"), "normal widget shows context and proof plan counts");
	for (const line of lines) assert.ok(visibleWidth(line) <= 72, `line exceeds width: ${line}`);
}

{
	const lines = renderWidget(59, {
		phase: "generating",
		sprint: 1,
		total: 3,
		agentName: "harness-worker",
		verificationStatus: "running",
		traceQuality: "ok",
	});
	assert.equal(lines.length, 1, "compact widget renders one line");
	assert.ok(lines[0].includes("gate:RUN"), "compact widget preserves gate status");
	assert.ok(lines[0].includes("trace:OK"), "compact widget preserves trace quality");
	assert.ok(visibleWidth(lines[0]) <= 59, "compact line fits requested width");
}
