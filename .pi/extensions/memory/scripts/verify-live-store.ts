/**
 * One-shot live DB verification (uses default ~/.config/pi/memory/memory.db).
 * Inserts a tagged learning row, verifies updated_at_epoch, then deletes it.
 *
 * Run: npx tsx .pi/extensions/memory/scripts/verify-live-store.ts
 */

import { getMemoryDB, closeMemoryDB } from "../db.js";
import { storeObservation } from "../observations.js";

const TAG = "W25 post-restart verify (auto-delete)";

function main(): void {
	const db = getMemoryDB();
	const v = db
		.prepare("SELECT MAX(version) AS v FROM schema_versions")
		.get() as { v: number | null };
	const col = db
		.prepare(
			"SELECT 1 AS x FROM pragma_table_info('observations') WHERE name = 'updated_at_epoch'",
		)
		.get() as { x: number } | undefined;

	console.log("schema_version:", v.v ?? "none");
	console.log("updated_at_epoch column:", col ? "present" : "MISSING");

	if ((v.v ?? 0) < 10) {
		console.error("FAIL: expected schema >= 10");
		process.exit(1);
	}
	if (!col) {
		console.error("FAIL: updated_at_epoch missing after migration");
		process.exit(1);
	}

	const id = storeObservation({
		type: "learning",
		title: TAG,
		narrative: "Ephemeral row from verify-live-store.ts; safe to ignore.",
		source: "manual",
		confidence: "high",
	});

	const row = db
		.prepare(
			"SELECT id, title, created_at_epoch, updated_at_epoch FROM observations WHERE id = ?",
		)
		.get(id) as {
		id: number;
		title: string;
		created_at_epoch: number;
		updated_at_epoch: number | null;
	};

	if (!row || row.title !== TAG) {
		console.error("FAIL: storeObservation returned id", id, "but row not found");
		process.exit(1);
	}
	if (row.updated_at_epoch == null) {
		console.error("FAIL: updated_at_epoch null on new insert");
		process.exit(1);
	}

	db.prepare("DELETE FROM observations WHERE id = ?").run(id);
	console.log("storeObservation: ok (id", id, ", updated_at_epoch", row.updated_at_epoch, ")");
	console.log("cleanup: deleted test row", id);
	console.log("PASS: live DB v10 + storeObservation");
}

try {
	main();
} finally {
	closeMemoryDB();
}