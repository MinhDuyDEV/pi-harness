/**
 * Focused unit tests for harness safety policy helpers.
 *
 * Run: npx tsx .pi/extensions/harness/policy.test.ts
 */

import { strict as assert } from "node:assert";
import {
	DEFAULT_HARNESS_POLICY,
	filterToolsForRole,
	isCommandAllowed,
	isProtectedPath,
} from "./policy.js";

{
	const t = "isCommandAllowed blocks destructive git and filesystem commands by default";
	assert.equal(isCommandAllowed("git reset --hard", DEFAULT_HARNESS_POLICY).allowed, false, t);
	assert.equal(isCommandAllowed("rm -rf src", DEFAULT_HARNESS_POLICY).allowed, false, t);
	assert.equal(isCommandAllowed("npm test", DEFAULT_HARNESS_POLICY).allowed, true, t);
}

{
	const t = "filterToolsForRole enforces read-only reviewer tools";
	const warnings: string[] = [];
	const tools = filterToolsForRole(["read", "bash", "edit", "write", "grep", "srcwalk_read"], "evaluator", "reviewer", warnings);
	assert.deepEqual(tools, ["read", "grep", "srcwalk_read"], t);
	assert.ok(warnings.some((warning) => warning.includes("read-only evaluator")), t);
}

{
	const t = "isProtectedPath blocks common secret and git metadata paths";
	assert.equal(isProtectedPath("/repo", "/repo/.env"), true, t);
	assert.equal(isProtectedPath("/repo", "/repo/.git/config"), true, t);
	assert.equal(isProtectedPath("/repo", "/repo/src/index.ts"), false, t);
}

console.log("policy.test.ts: all assertions passed.");
