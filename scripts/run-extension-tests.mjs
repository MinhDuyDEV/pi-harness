#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const tsxTestFiles = [
	".pi/extensions/harness/agents.test.ts",
	".pi/extensions/harness/artifacts.test.ts",
	".pi/extensions/harness/gitSafety.test.ts",
	".pi/extensions/harness/interactivePane.test.ts",
	".pi/extensions/harness/parsing.test.ts",
	".pi/extensions/harness/sprint-guards.test.ts",
	".pi/extensions/harness/policy.test.ts",
	".pi/extensions/harness/traceQuality.test.ts",
	".pi/extensions/harness/verification.test.ts",
	".pi/extensions/harness/widgets.test.ts",
	".pi/extensions/tui/tests/fixed-editor.test.ts",
	".pi/extensions/tui/tests/footer.test.ts",
	".pi/extensions/tui/tests/sidebar.test.ts",
	".pi/extensions/tui/tests/todos-panel.test.ts",
];

function run(args) {
	const result = spawnSync("npx", ["tsx", ...args], {
		stdio: "inherit",
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

run(["--test", ...tsxTestFiles]);
run([".pi/extensions/safety/safety.test.ts"]);
run([".pi/extensions/task/helpers.test.ts"]);
run([".pi/extensions/memory/observations.test.ts"]);
run([".pi/extensions/xai/policy.test.ts"]);
