// Smoke test: simulate extension load and verify migrations + version.
//
// IMPORTANT: isolate from the live DB. Without PI_MEMORY_DB_PATH set,
// getMemoryDB() would default to ~/.config/pi/memory/memory.db and any
// schema changes (migrations, triggers, etc.) would be applied to the
// real user data. Always pin to a temp file in a dedicated subdir.
//
// Run: npx tsx .pi/extensions/memory/scripts/smoke-migration.ts

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set env var BEFORE the first getMemoryDB() call. The env var is read
// inside getMemoryDB, not at module load, so this assignment running
// after the import bindings resolve is fine. mkdirSync ensures the
// parent dir exists, otherwise DatabaseSync fails with ENOENT.
const smokeDir = join(tmpdir(), "memory-smoke-migration");
mkdirSync(smokeDir, { recursive: true });
process.env.PI_MEMORY_DB_PATH = join(smokeDir, "memory.db");

import { getMemoryDB, closeMemoryDB } from "../db.js";

try {
	const db = getMemoryDB();
	const tables = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
		.all() as Array<{ name: string }>;
	const v = db
		.prepare("SELECT MAX(version) AS v FROM schema_versions")
		.get() as { v: number };
	console.log("PI_MEMORY_DB_PATH =", process.env.PI_MEMORY_DB_PATH);
	console.log("schema_version =", v.v);
	console.log("tables:", tables.map((t) => t.name).join(", "));
} catch (err) {
	console.error("FAILED:", err instanceof Error ? err.message : err);
	process.exit(1);
} finally {
	closeMemoryDB();
	try {
		rmSync(smokeDir, { recursive: true, force: true });
	} catch {
		// best-effort
	}
}
