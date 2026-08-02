/**
 * Focused regression tests for the safety extension policy boundary.
 *
 * Run: node --import tsx --test .pi/extensions/safety/safety.test.ts
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import safetyExtension from "../safety.js";
import { readFileSync } from "node:fs";
import { evaluate } from "./evaluate.js";
import { defaultRules } from "./rules/presets.js";
import { VerificationTracker, verificationRules } from "./rules/verification.js";
import { workspaceRules } from "./rules/workspace.js";
import type { RuleSet, ToolCallContext } from "./types.js";

// The package defaults the safety gate to off; tests opt back in explicitly
// so they never depend on the working-tree .pi/settings.json on disk.
const GATE_ON = { extensions: { safety: true } } as const;

function verdictFor(rules: RuleSet, ctx: ToolCallContext) {
	return evaluate(rules, ctx, "highest-severity").verdict;
}

{
	// The module header used to advertise "26 rules across 7 categories" with
	// every per-category number wrong. Nothing checked it, so it stayed wrong
	// through several rule additions. It is now an assertion.
	const t = "extension.ts header states the real rule counts";
	const { rules } = defaultRules();
	const byCategory = new Map<string, number>();
	for (const rule of rules) {
		const category = rule.id.split(/[.:\-\/]/)[0] ?? rule.id;
		byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
	}
	const header = readFileSync(new URL("./extension.ts", import.meta.url), "utf8");
	const declared = header.match(/RULES:\s*(\d+)\s+rules across\s+(\d+)\s+categories/);
	assert.ok(declared, t + ": header declares a count");
	assert.equal(
		Number(declared![1]),
		rules.length,
		`${t}: header says ${declared![1]} rules, defaultRules() returns ${rules.length}`,
	);
}

{
	const t = "safetyExtension registers current tool_call hook and blocks critical commands";
	const handlers = new Map<string, Function>();
	const commands = new Map<string, { handler: (args: unknown, ctx: unknown) => Promise<string> | string }>();
	const fakePi = {
		on(event: string, handler: Function) {
			handlers.set(event, handler);
		},
		registerCommand(name: string, options: { handler: (args: unknown, ctx: unknown) => Promise<string> | string }) {
			commands.set(name, options);
		},
	};

	safetyExtension(fakePi as never, GATE_ON);
	assert.equal(handlers.has("tool_call"), true, t + ": hook registered");
	assert.equal(handlers.has("before_tool_call"), false, t + ": stale hook not used");

	const result = handlers.get("tool_call")?.({
		type: "tool_call",
		toolCallId: "tc-1",
		toolName: "bash",
		input: { command: "rm -rf /" },
	});
	assert.deepEqual(result, {
		block: true,
		reason: "[safety] BLOCKED (CRITICAL): Catastrophic delete detected. This would destroy critical system or user files.\n\nRule: no-catastrophic-rm\nThreat: data-destruction",
	}, t + ": block result shape");

	const confirmWithoutUi = handlers.get("tool_call")?.({
		type: "tool_call",
		toolCallId: "tc-2",
		toolName: "bash",
		input: { command: "git add ." },
	});
	assert.equal(confirmWithoutUi?.block, true, t + ": confirm rule fails closed without UI");
	assert.match(confirmWithoutUi?.reason ?? "", /No confirmation UI available/, t + ": fail-closed reason");
	assert.ok(commands.has("safety"), t + ": command still registered");
}

{
	const t = "sensitive file reads and bash secret dumps are blocked";
	const { rules } = defaultRules();
	assert.equal(verdictFor(rules, {
		tool: "read",
		path: ".env",
		cwd: "/repo",
		sessionId: "s1",
	})?.kind, "block", t + ": read .env");
	assert.equal(verdictFor(rules, {
		tool: "bash",
		command: "cat .env",
		cwd: "/repo",
		sessionId: "s1",
	})?.kind, "block", t + ": cat .env");
	assert.equal(verdictFor(rules, {
		tool: "bash",
		command: "printenv",
		cwd: "/repo",
		sessionId: "s1",
	})?.kind, "block", t + ": printenv");
}

{
	const t = "workspace rules canonicalize traversal and symlink escapes";
	const root = mkdtempSync(join(tmpdir(), "pi-harness-safety-workspace-"));
	const protectedDir = join(root, "protected");
	const workspaceDir = join(root, "workspace");
	mkdirSync(protectedDir);
	mkdirSync(workspaceDir);
	writeFileSync(join(protectedDir, "secret.txt"), "secret");
	symlinkSync(protectedDir, join(workspaceDir, "escape"));
	try {
		const rules = workspaceRules({ additionalProtectedPaths: [protectedDir] });
		assert.equal(verdictFor(rules, {
			tool: "write",
			path: join(root, "tmp", "..", "protected", "secret.txt"),
			cwd: workspaceDir,
			sessionId: "s1",
		})?.kind, "block", t + ": dot-dot traversal");
		assert.equal(verdictFor(rules, {
			tool: "write",
			path: "escape/secret.txt",
			cwd: workspaceDir,
			sessionId: "s1",
		})?.kind, "block", t + ": symlink target");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

{
	const t = "failed verification does not satisfy completion gate";
	const tracker = new VerificationTracker();
	assert.equal(tracker.isVerificationCommand("npm test"), true, t + ": recognizes verification command");
	tracker.recordEvidence("s1", "npm test");
	tracker.recordResult("s1", "npm test", "Tests: 1 failed, 2 passed, 3 total", 1);
	assert.equal(tracker.hasPassingResult("s1"), false, t + ": failed result is not passing evidence");
	assert.equal(tracker.getLatestResult("s1")?.exitCode, 1, t + ": latest result tracked");
	assert.equal(verdictFor(verificationRules(tracker), {
		tool: "taskupdate",
		command: "TaskUpdate taskId=1 status=completed",
		cwd: "/repo",
		sessionId: "s1",
	})?.kind, "confirm", t);
}


{
	const t = "dangerous network targets block encoded localhost and link-local addresses";
	const { rules } = defaultRules();
	for (const url of ["http://2130706433", "http://0x7f000001", "http://[::ffff:127.0.0.1]", "http://[fe80::1]"]) {
		const verdict = verdictFor(rules, {
			tool: "web_fetch",
			url,
			cwd: "/repo",
			sessionId: "s1",
		});
		assert.equal(verdict?.kind, "block", `${t}: ${url}`);
	}
}


async function testConfirmationAllowsConfirmRules(): Promise<void> {
	const t = "confirmed confirm-level rules are allowed";
	let handler: Function | undefined;
	const blockers: unknown[] = [];
	const fakePi = {
		on(event: string, next: Function) {
			if (event === "tool_call") handler = next;
		},
		registerCommand() {},
		events: {
			emit(channel: string, payload: unknown) {
				if (channel === "herdr:blocked") blockers.push(payload);
			},
		},
	};
	safetyExtension(fakePi as never, GATE_ON);
	const result = await handler?.({
		type: "tool_call",
		toolCallId: "tc-confirm",
		toolName: "bash",
		input: { command: "git add ." },
	}, { ui: { confirm: () => true } });
	assert.equal(result, undefined, t);
	assert.deepEqual(blockers, [
		{ active: true, blockerId: "safety:warn-git-add-dot", label: "Safety confirmation" },
		{ active: false, blockerId: "safety:warn-git-add-dot", label: "Safety confirmation" },
	], t + ": prompt exposes and clears a real Herdr blocker");
}

async function testDisabledRulesPosture(): Promise<void> {
	// A MEDIUM rule: the env can only disable below-critical severities, and
	// this test used to disable `no-force-push-main` — a critical rule — which
	// is precisely the hole the severity floor closes.
	const t = "disabled rules are visible in safety posture";
	const previous = process.env.PI_SAFETY_DISABLED_RULES;
	process.env.PI_SAFETY_DISABLED_RULES = "warn-git-reset-hard";
	try {
		const commands = new Map<string, { handler: (args: unknown, ctx: unknown) => Promise<void> | void }>();
		const fakePi = {
			on() {},
			registerCommand(name: string, options: { handler: (args: unknown, ctx: unknown) => Promise<void> | void }) {
				commands.set(name, options);
			},
		};
		safetyExtension(fakePi as never, GATE_ON);
		let notification = "";
		const output = await commands.get("safety")?.handler({}, {
			ui: {
				notify(message: string) {
					notification = message;
				},
			},
		});
		assert.equal(output, undefined, t + ": command returns void");
		assert.match(notification, /Disabled rules/i, t + ": disabled heading");
		assert.match(notification, /warn-git-reset-hard/, t + ": disabled id");
	} finally {
		if (previous === undefined) delete process.env.PI_SAFETY_DISABLED_RULES;
		else process.env.PI_SAFETY_DISABLED_RULES = previous;
	}
}

async function testUnknownToolsAreEvaluated(): Promise<void> {
	// H-C: `contextFromEvent` returned null for any tool outside the five it
	// recognized, and the hook treats null as nothing-to-evaluate — so every
	// MCP tool bypassed all rules, including `targets: ["*"]`. The wildcard
	// network rule must now see a dangerous URL nested inside an unknown
	// tool's input, not just in a top-level `url` field.
	const t = "unknown tools are evaluated by default";
	let handler: Function | undefined;
	const fakePi = {
		on(event: string, next: Function) {
			if (event === "tool_call") handler = next;
		},
		registerCommand() {},
		events: { emit() {} },
	};
	safetyExtension(fakePi as never, GATE_ON);

	const blocked = await handler?.({
		type: "tool_call",
		toolCallId: "tc-mcp",
		toolName: "mcp__deploy__trigger",
		input: { config: { endpoint: "http://169.254.169.254/latest/meta-data/" } },
	});
	assert.equal(blocked?.block, true, t + ": metadata endpoint blocked");
	assert.match(String(blocked?.reason ?? ""), /block-dangerous-network-target/, t + ": wildcard rule fired");

	const allowed = await handler?.({
		type: "tool_call",
		toolCallId: "tc-mcp-ok",
		toolName: "mcp__deploy__trigger",
		input: { config: { endpoint: "https://registry.example.com/deploy" } },
	});
	assert.equal(allowed, undefined, t + ": benign unknown tool allowed");
}

async function testUrlAllowlistIsNarrow(): Promise<void> {
	// Browser-type tools legitimately navigate to local dev servers, so the
	// operator can vouch for specific hosts — but only specific hosts, and
	// never metadata endpoints.
	const t = "PI_SAFETY_URL_ALLOWLIST is per-host and cannot cover metadata";
	const previous = process.env.PI_SAFETY_URL_ALLOWLIST;
	process.env.PI_SAFETY_URL_ALLOWLIST = "localhost:5173,169.254.169.254";
	try {
		let handler: Function | undefined;
		const fakePi = {
			on(event: string, next: Function) {
				if (event === "tool_call") handler = next;
			},
			registerCommand() {},
			events: { emit() {} },
		};
		safetyExtension(fakePi as never, GATE_ON);

		const allowed = await handler?.({
			type: "tool_call",
			toolCallId: "tc-preview",
			toolName: "mcp__browser__navigate",
			input: { url: "http://localhost:5173/app" },
		});
		assert.equal(allowed, undefined, t + ": allowlisted host+port passes");

		const otherPort = await handler?.({
			type: "tool_call",
			toolCallId: "tc-other-port",
			toolName: "mcp__browser__navigate",
			input: { url: "http://localhost:8080/" },
		});
		assert.equal(otherPort?.block, true, t + ": other port still blocked");

		const metadata = await handler?.({
			type: "tool_call",
			toolCallId: "tc-metadata",
			toolName: "mcp__browser__navigate",
			input: { url: "http://169.254.169.254/latest/meta-data/" },
		});
		assert.equal(metadata?.block, true, t + ": metadata endpoint is never allowlistable");
	} finally {
		if (previous === undefined) delete process.env.PI_SAFETY_URL_ALLOWLIST;
		else process.env.PI_SAFETY_URL_ALLOWLIST = previous;
	}
}

async function testCriticalRulesCannotBeDisabled(): Promise<void> {
	// H-D: the same undocumented env that mutes a medium nuisance rule could
	// switch off credential blocking. Critical rules stay on.
	const t = "PI_SAFETY_DISABLED_RULES cannot disable critical rules";
	const previous = process.env.PI_SAFETY_DISABLED_RULES;
	process.env.PI_SAFETY_DISABLED_RULES = "block-dangerous-network-target";
	try {
		let handler: Function | undefined;
		const commands = new Map<string, { handler: (args: unknown, ctx: unknown) => Promise<void> | void }>();
		const fakePi = {
			on(event: string, next: Function) {
				if (event === "tool_call") handler = next;
			},
			registerCommand(name: string, options: { handler: (args: unknown, ctx: unknown) => Promise<void> | void }) {
				commands.set(name, options);
			},
			events: { emit() {} },
		};
		safetyExtension(fakePi as never, GATE_ON);

		const blocked = await handler?.({
			type: "tool_call",
			toolCallId: "tc-critical",
			toolName: "bash",
			input: { command: "curl http://169.254.169.254/latest/meta-data/" },
		});
		assert.equal(blocked?.block, true, t + ": rule still fires");

		let notification = "";
		await commands.get("safety")?.handler({}, {
			ui: {
				notify(message: string) {
					notification = message;
				},
			},
		});
		assert.match(notification, /REFUSED/i, t + ": posture names the refusal");
		assert.match(notification, /block-dangerous-network-target/, t + ": refused id listed");
	} finally {
		if (previous === undefined) delete process.env.PI_SAFETY_DISABLED_RULES;
		else process.env.PI_SAFETY_DISABLED_RULES = previous;
	}
}

function testThrowingRuleFailsClosed(): void {
	// A rule that crashes has not approved the call it was examining.
	const t = "a throwing rule blocks instead of escaping the hook";
	const throwing: RuleSet = [
		{
			id: "explodes",
			description: "always throws",
			severity: "high",
			threat: "data-destruction",
			targets: ["*"],
			check: () => {
				throw new Error("regex catastrophe");
			},
		},
	];
	const result = evaluate(throwing, {
		tool: "bash",
		command: "echo hello",
		cwd: "/tmp",
		sessionId: "s",
	}, "highest-severity");
	assert.equal(result.verdict?.kind, "block", t);
	assert.match(result.verdict?.message ?? "", /cannot approve/, t + ": explains why");
}

async function testAuditIsPersisted(): Promise<void> {
	// The in-memory ring dies with the process; the sessions someone needs to
	// reconstruct are exactly the ones with no audit left.
	const t = "fired rules are persisted to the JSONL audit";
	const auditDir = mkdtempSync(join(tmpdir(), "safety-audit-"));
	const previous = process.env.PI_SAFETY_AUDIT_DIR;
	process.env.PI_SAFETY_AUDIT_DIR = auditDir;
	try {
		let handler: Function | undefined;
		const emitted: Array<{ channel: string; payload: unknown }> = [];
		const fakePi = {
			on(event: string, next: Function) {
				if (event === "tool_call") handler = next;
			},
			registerCommand() {},
			events: {
				emit(channel: string, payload: unknown) {
					emitted.push({ channel, payload });
				},
			},
		};
		safetyExtension(fakePi as never, GATE_ON);
		await handler?.({
			type: "tool_call",
			toolCallId: "tc-audit",
			toolName: "bash",
			input: { command: "git push --force origin main" },
		});

		const persisted = readFileSync(join(auditDir, "safety-audit.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { ruleId: string; kind: string });
		assert.ok(persisted.length >= 1, t + ": at least one entry");
		assert.ok(persisted.some((e) => e.kind === "block" || e.kind === "confirm"), t + ": verdict recorded");

		const verdictEvents = emitted.filter((e) => e.channel === "pi-harness:safety:verdict:v1");
		assert.equal(verdictEvents.length, persisted.length, t + ": one bus event per audit entry");
	} finally {
		if (previous === undefined) delete process.env.PI_SAFETY_AUDIT_DIR;
		else process.env.PI_SAFETY_AUDIT_DIR = previous;
		rmSync(auditDir, { recursive: true, force: true });
	}
}

testThrowingRuleFailsClosed();

Promise.all([
	testConfirmationAllowsConfirmRules(),
	testDisabledRulesPosture(),
	testUnknownToolsAreEvaluated(),
	testCriticalRulesCannotBeDisabled(),
	testUrlAllowlistIsNarrow(),
	testAuditIsPersisted(),
]).then(() => {
	console.log("safety.test.ts: all assertions passed.");
});
