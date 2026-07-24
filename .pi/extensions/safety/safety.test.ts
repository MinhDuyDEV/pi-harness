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
import { evaluate } from "./evaluate.js";
import { defaultRules } from "./rules/presets.js";
import { VerificationTracker, verificationRules } from "./rules/verification.js";
import { workspaceRules } from "./rules/workspace.js";
import type { RuleSet, ToolCallContext } from "./types.js";

function verdictFor(rules: RuleSet, ctx: ToolCallContext) {
	return evaluate(rules, ctx, "highest-severity").verdict;
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

	safetyExtension(fakePi as never);
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
	const root = mkdtempSync(join(tmpdir(), "pikit-safety-workspace-"));
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
	const fakePi = {
		on(event: string, next: Function) {
			if (event === "tool_call") handler = next;
		},
		registerCommand() {},
	};
	safetyExtension(fakePi as never);
	const result = await handler?.({
		type: "tool_call",
		toolCallId: "tc-confirm",
		toolName: "bash",
		input: { command: "git add ." },
	}, { ui: { confirm: () => true } });
	assert.equal(result, undefined, t);
}

async function testDisabledRulesPosture(): Promise<void> {
	const t = "disabled rules are visible in safety posture";
	const previous = process.env.PI_SAFETY_DISABLED_RULES;
	process.env.PI_SAFETY_DISABLED_RULES = "no-force-push-main";
	try {
		const commands = new Map<string, { handler: (args: unknown, ctx: unknown) => Promise<void> | void }>();
		const fakePi = {
			on() {},
			registerCommand(name: string, options: { handler: (args: unknown, ctx: unknown) => Promise<void> | void }) {
				commands.set(name, options);
			},
		};
		safetyExtension(fakePi as never);
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
		assert.match(notification, /no-force-push-main/, t + ": disabled id");
	} finally {
		if (previous === undefined) delete process.env.PI_SAFETY_DISABLED_RULES;
		else process.env.PI_SAFETY_DISABLED_RULES = previous;
	}
}

Promise.all([
	testConfirmationAllowsConfirmRules(),
	testDisabledRulesPosture(),
]).then(() => {
	console.log("safety.test.ts: all assertions passed.");
});
