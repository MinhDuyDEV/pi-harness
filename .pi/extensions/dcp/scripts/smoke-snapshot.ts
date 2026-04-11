import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __snapshotInternals } from "../snapshot.ts";

const { parseSessionRows, buildSummary, formatSnapshot } = __snapshotInternals;

const tmpRoot = mkdtempSync(join(tmpdir(), "pikit-vcc-snapshot-"));
const sessionFile = join(tmpRoot, "session.jsonl");

try {
	const lines = [
		JSON.stringify({ type: "session", id: "smoke" }),
		JSON.stringify({
			type: "message",
			message: {
				role: "user",
				content: [
					{
						type: "text",
						text: "please keep concise and implement vcc_snapshot in .pi/extensions/dcp/snapshot.ts password=abc123",
					},
				],
			},
		}),
		JSON.stringify({
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking" },
					{ type: "toolCall", name: "edit", arguments: { path: ".pi/extensions/dcp/snapshot.ts" } },
					{ type: "text", text: "updated snapshot logic" },
				],
			},
		}),
		JSON.stringify({
			type: "message",
			message: {
				role: "toolResult",
				toolName: "bash",
				isError: true,
				content: [{ type: "text", text: "build failed: blocked by missing dep" }],
			},
		}),
	].join("\n");

	writeFileSync(sessionFile, lines, "utf-8");

	const rows = parseSessionRows(sessionFile);
	assert.equal(rows.length, 3, "expected 3 message rows");

	const summary = buildSummary(rows);
	assert(summary.sessionGoal.length > 0, "expected session goal entries");
	assert(summary.filesAndChanges.some((line) => line.includes("snapshot.ts")), "expected file activity for snapshot.ts");

	const snapshot = formatSnapshot(summary);
	assert(snapshot.includes("[Session Goal]"), "missing Session Goal section");
	assert(snapshot.includes("[Files And Changes]"), "missing Files And Changes section");
	assert(snapshot.includes("[Outstanding Context]"), "missing Outstanding Context section");
	assert(snapshot.includes("password [REDACTED]"), "secret redaction failed");

	console.log("vcc_snapshot smoke test passed");
} finally {
	rmSync(tmpRoot, { recursive: true, force: true });
}
