/**
 * Focused unit tests for deterministic harness verification commands.
 *
 * Run: npx tsx .pi/extensions/harness/verification.test.ts
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runVerificationCommands } from "./verification.js";

const root = mkdtempSync(join(tmpdir(), "pikit-harness-verification-"));
try {
	{
		const t = "runVerificationCommands skips empty command lists";
		const summary = runVerificationCommands([], root);
		assert.equal(summary.status, "skipped", t);
		assert.deepEqual(summary.results, [], t);
	}

	{
		const t = "runVerificationCommands passes when all commands exit zero";
		const summary = runVerificationCommands(["node -e \"process.stdout.write('ok')\""], root);
		assert.equal(summary.status, "passed", t);
		assert.equal(summary.results[0].exitCode, 0, t);
		assert.equal(summary.results[0].stdout, "ok", t);
	}

	{
		const t = "runVerificationCommands fails when a command exits non-zero";
		const summary = runVerificationCommands(["node -e \"process.exit(7)\""], root);
		assert.equal(summary.status, "failed", t);
		assert.equal(summary.results[0].exitCode, 7, t);
	}

	{
		const t = "runVerificationCommands blocks dangerous commands before execution";
		const summary = runVerificationCommands(["git reset --hard"], root);
		assert.equal(summary.status, "failed", t);
		assert.equal(summary.results[0].allowed, false, t);
		assert.ok(summary.results[0].reason?.includes("blocked"), t);
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log("verification.test.ts: all assertions passed.");
