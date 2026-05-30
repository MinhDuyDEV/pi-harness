/**
 * Focused unit tests for harness workspace selection.
 *
 * Run: npx tsx .pi/extensions/harness/gitSafety.test.ts
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createHarnessWorkspace } from "./gitSafety.js";

async function main() {
	const tmpDir = mkdtempSync(join(tmpdir(), "harness-git-safety-test-"));

	try {
		{
			const t = "current workspace mode does not create an isolated worktree";
			const workspace = await createHarnessWorkspace(tmpDir, "Test prompt", "current");
			assert.equal(workspace.cwd, tmpDir, t);
			assert.equal(workspace.isolated, false, t);
			assert.equal(workspace.mode, "current", t);
			assert.equal(workspace.worktreePath, undefined, t);
		}

		{
			const t = "auto workspace mode currently aliases current workspace";
			const workspace = await createHarnessWorkspace(tmpDir, "Test prompt", "auto");
			assert.equal(workspace.cwd, tmpDir, t);
			assert.equal(workspace.isolated, false, t);
			assert.equal(workspace.mode, "auto", t);
			assert.equal(workspace.worktreePath, undefined, t);
		}
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
