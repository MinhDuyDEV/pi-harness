import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function assert(condition: unknown, message: string): void {
	if (!condition) throw new Error(message);
}

async function main() {
	const dir = mkdtempSync(join(tmpdir(), "pi-memory-lifecycle-"));
	process.env.PI_MEMORY_DB_PATH = join(dir, "memory.db");

	try {
		const { MEMORY_CONFIG } = await import("../config.js");
		const { getMemoryDB, closeMemoryDB } = await import("../db.js");
		const {
			getCaptureStats,
			getUndistilledMessageCount,
			storeDistillationAndMarkMessages,
			storeTemporalMessage,
		} = await import("../pipeline.js");

		(MEMORY_CONFIG.capture as any).maxMessages = 3;

		for (let i = 0; i < 5; i++) {
			storeTemporalMessage({
				session_id: "session-a",
				message_id: `tool-${i}`,
				role: "tool",
				content: `tool result ${i}`,
				token_estimate: 3,
				time_created: 1_000 + i,
				tool_name: "read",
				tool_call_id: `call-${i}`,
				status: "completed",
				is_error: false,
				raw_json: JSON.stringify({ i }),
			} as any);
		}

		const db = getMemoryDB();
		const rows = db.prepare("SELECT id, message_id, tool_name, tool_call_id, status, is_error, raw_json FROM temporal_messages ORDER BY time_created ASC").all() as Array<Record<string, unknown>>;
		assert(rows.length === 3, `expected temporal capture to be capped at 3 rows, got ${rows.length}`);
		assert(rows[0].message_id === "tool-2", `expected oldest retained row to be tool-2, got ${rows[0]?.message_id}`);
		assert(rows.every((row) => row.tool_name === "read" && typeof row.raw_json === "string"), "expected structured tool metadata to persist");

		const beforeUndistilled = getUndistilledMessageCount("session-a");
		assert(beforeUndistilled === 3, `expected 3 undistilled rows before transaction, got ${beforeUndistilled}`);

		const distillationId = storeDistillationAndMarkMessages(
			{
				session_id: "session-a",
				content: "Distilled tool lifecycle summary with enough text to be meaningful.",
				terms: ["tool", "lifecycle"],
				message_count: 3,
				compression_ratio: 0.5,
				time_start: 1_002,
				time_end: 1_004,
			},
			rows.map((row) => Number(row.id)),
		);
		assert(distillationId > 0, "expected transaction helper to return distillation id");
		assert(getUndistilledMessageCount("session-a") === 0, "expected transaction helper to mark all rows distilled");

		const stats = getCaptureStats();
		assert(stats.total === 3, `expected stats to reflect retained rows, got ${stats.total}`);
		closeMemoryDB();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
