/**
 * Tests for memory observation warning-type dedup (v8->v9 migration).
 *
 * Covers:
 *   - Migration applies and records schema_version = 9
 *   - Partial unique index `idx_observations_warning_dedup` exists
 *   - `storeObservation` dedupes warnings with the same title within
 *     the same hour bucket (same created_at_epoch / 3_600_000)
 *   - `storeObservation` does NOT dedupe warnings across different hours
 *   - `storeObservation` does NOT dedupe non-warning types
 *   - On dedup, the returned id is the existing row's id (so callers
 *     can correlate)
 *
 * Run: npx tsx --test .pi/extensions/memory/observations.test.ts
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { getMemoryDB, closeMemoryDB } from "./db.js";
import { storeObservation } from "./observations.js";
import { applyMigrations } from "./migrations.js";
import { archiveDuplicateObservations, normalizeWarningTitleForDedupe } from "./maintenance.js";
import { isCompactionSelfWarning, isTemplateOrSourceLineWarningTitle } from "./tools.js";

// ---------------------------------------------------------------------------
// Isolated DB: each `tsx --test` invocation is its own process, so a
// temp PI_MEMORY_DB_PATH here cannot leak into the real ~/.config/pi DB.
// Set env var BEFORE the first getMemoryDB() call (the env var is read
// once inside getMemoryDB, not at module load). Imports are hoisted but
// they only bind references -- they don't call getMemoryDB() themselves.
// ---------------------------------------------------------------------------
const tmpDir = mkdtempSync(join(tmpdir(), "memory-dedup-test-"));
process.env.PI_MEMORY_DB_PATH = join(tmpDir, "memory.db");

// Reset observations table between tests so each scenario is independent.
function resetObservations(): void {
	const db = getMemoryDB();
	db.exec("DELETE FROM observations");
}

test("observation guard: template/source-line warning titles are rejected", () => {
	assert.equal(
		isTemplateOrSourceLineWarningTitle("multi-grep.ts:87 notices.push(...)"),
		true,
	);
	assert.equal(
		isTemplateOrSourceLineWarningTitle("title: `Warning: ${terms.slice(0, 3).join(\", \")}`"),
		true,
	);
	assert.equal(
		isTemplateOrSourceLineWarningTitle("Warning: partial file index"),
		false,
		"stable user-facing notice is allowed",
	);
});

test("observation guard: compaction self-warnings are filtered", () => {
	assert.equal(
		isCompactionSelfWarning({
			type: "warning",
			title: "Compaction note wrote seven meta warnings",
			narrative: "This weekly summary should stay in the artifact.",
		}),
		true,
		"warning about compaction is filtered",
	);
	assert.equal(
		isCompactionSelfWarning({
			type: "warning",
			title: "Warning: TypeScript diagnostics failed",
			narrative: "Real project warning about diagnostics output.",
		}),
		false,
		"ordinary warning is not filtered",
	);
	assert.equal(
		isCompactionSelfWarning({
			type: "bugfix",
			title: "Fixed compaction summary output",
		}),
		false,
		"non-warning durable compaction bugfix is allowed",
	);
});

test("v8->v9 migration: schema_version is recorded as >=9 and partial index exists", () => {
	const db = getMemoryDB();
	const row = db
		.prepare("SELECT MAX(version) AS v FROM schema_versions")
		.get() as { v: number | null };
	assert.ok((row.v ?? 0) >= 10, `got version ${row.v}, expected >= 10`);

	const idx = db
		.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name = ?")
		.get("idx_observations_warning_dedup") as { sql: string } | undefined;
	assert.ok(idx, "index exists");
	assert.match(
		idx!.sql,
		/WHERE type = 'warning'/i,
		"index is partial on type='warning'",
	);
	assert.match(
		idx!.sql,
		/created_at_epoch\s*\/\s*3600000/i,
		"index uses hourly bucket expression",
	);
});

test("v9->v10 migration: observations.updated_at_epoch column exists with INTEGER type", () => {
	const db = getMemoryDB();
	const cols = db
		.prepare("PRAGMA table_info(observations)")
		.all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
	const col = cols.find((c) => c.name === "updated_at_epoch");
	assert.ok(col, "updated_at_epoch column exists on observations");
	assert.match(col!.type, /INT/i, `updated_at_epoch type is INTEGER, got '${col!.type}'`);
	assert.equal(col!.notnull, 0, "updated_at_epoch is nullable (no NOT NULL)");
});

test("v9->v10 migration: ALTER path works on a pre-migration DB (simulates live DB)", () => {
	// Simulate the exact state of the live DB before v9->v10:
	// - version = 9, no updated_at_epoch column.
	// This catches a bug class the previous test misses: if the pragma_table_info
	// check were wrong (e.g., always returns 1), the ALTER would never run and
	// pre-migration DBs would stay broken.
	const db = getMemoryDB();

	// Drop the column and the v10 row to roll back to pre-migration state.
	db.exec("ALTER TABLE observations DROP COLUMN updated_at_epoch");
	db.exec("DELETE FROM schema_versions WHERE version = 10");

	const beforeCols = db
		.prepare("PRAGMA table_info(observations)")
		.all() as Array<{ name: string }>;
	assert.ok(
		!beforeCols.find((c) => c.name === "updated_at_epoch"),
		"pre-migration state: column is gone",
	);

	// Re-run migrations. v9->v10 should detect the missing column and ALTER.
	applyMigrations({ db });

	const afterCols = db
		.prepare("PRAGMA table_info(observations)")
		.all() as Array<{ name: string; type: string }>;
	const restored = afterCols.find((c) => c.name === "updated_at_epoch");
	assert.ok(restored, "post-migration: column is back");
	assert.match(restored!.type, /INT/i, "restored column type is INTEGER");

	const v = (
		db
			.prepare("SELECT MAX(version) AS v FROM schema_versions")
			.get() as { v: number }
	).v;
	assert.equal(v, 10, "schema_version bumped to 10");
});

test("normalizeWarningTitleForDedupe strips shell, PID, color residue, truncation, and whitespace", () => {
	const expected = "warning:no_color-env-ignored-due-to-force_color";
	assert.equal(
		normalizeWarningTitleForDedupe("(node:13821) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set."),
		expected,
	);
	assert.equal(
		normalizeWarningTitleForDedupe("[bash] (node:86409) 39m Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set."),
		expected,
	);
	assert.equal(
		normalizeWarningTitleForDedupe("(node:61451) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR'..."),
		expected,
	);
	assert.equal(
		normalizeWarningTitleForDedupe("[bash] (node:61372) Warning: The 'NO_COLOR' env is ignored due to the..."),
		expected,
	);
});

test("archiveDuplicateObservations: dry-run previews and apply supersedes historical duplicates", () => {
	resetObservations();
	const db = getMemoryDB();

	// Exact non-warning duplicate: same durable content repeated twice.
	const decision1 = storeObservation({
		type: "decision",
		title: "Duplicate decision",
		narrative: "same content",
	});
	const decision2 = storeObservation({
		type: "decision",
		title: "Duplicate decision",
		narrative: "same content",
	});

	// Warning cross-hour duplicate: v9 prevents same-hour dupes, so move the
	// first warning back an hour before writing the second.
	const warning1 = storeObservation({
		type: "warning",
		title: "(node:111) Warning: noisy historical warning",
		narrative: "first hour",
	});
	db.prepare(
		"UPDATE observations SET created_at_epoch = created_at_epoch - 3600000 WHERE id = ?",
	).run(warning1);
	const warning2 = storeObservation({
		type: "warning",
		title: "[bash] (node:222) 39m Warning: noisy historical warning",
		narrative: "second hour",
	});

	const preview = archiveDuplicateObservations({ dryRun: true });
	assert.equal(preview.candidates, 2, "one decision duplicate + one warning duplicate");
	assert.equal(preview.exactNonWarningCandidates, 1, "one exact non-warning duplicate");
	assert.equal(preview.warningTitleCandidates, 1, "one cross-hour warning duplicate");
	assert.equal(preview.archived, 0, "dry-run does not archive rows");

	const applied = archiveDuplicateObservations({ dryRun: false });
	assert.equal(applied.archived, 2, "apply archives two duplicate rows");

	const superseded = db
		.prepare(
			"SELECT id, superseded_by FROM observations WHERE id IN (?, ?, ?, ?) ORDER BY id",
		)
		.all(decision1, decision2, warning1, warning2) as Array<{ id: number; superseded_by: number | null }>;
	assert.equal(
		superseded.filter((row) => row.superseded_by !== null).length,
		2,
		"exactly two rows were marked superseded",
	);

	const afterPreview = archiveDuplicateObservations({ dryRun: true });
	assert.equal(afterPreview.candidates, 0, "no duplicate candidates remain");
});

test("storeObservation: same warning within the same hour dedupes to first id", () => {
	resetObservations();

	const id1 = storeObservation({
		type: "warning",
		title: "Warning: NO_COLOR ignored due to FORCE_COLOR",
		narrative: "first",
	});
	const id2 = storeObservation({
		type: "warning",
		title: "Warning: NO_COLOR ignored due to FORCE_COLOR",
		narrative: "second same hour",
	});
	const id3 = storeObservation({
		type: "warning",
		title: "Warning: NO_COLOR ignored due to FORCE_COLOR",
		narrative: "third same hour",
	});

	assert.ok(id1 > 0, `id1 should be > 0, got ${id1}`);
	assert.equal(id2, id1, "second call returns first row's id");
	assert.equal(id3, id1, "third call returns first row's id");

	const db = getMemoryDB();
	const count = (
		db
			.prepare(
				"SELECT COUNT(*) AS c FROM observations WHERE type = 'warning' AND title = ?",
			)
			.get("Warning: NO_COLOR ignored due to FORCE_COLOR") as { c: number }
	).c;
	assert.equal(count, 1, "only one row stored");
});

test("storeObservation: same warning title across different hours is NOT deduped", () => {
	resetObservations();

	const id1 = storeObservation({
		type: "warning",
		title: "Warning: bar",
		narrative: "hour 1",
	});

	// Backdate the first row by exactly 1 hour so it lands in the prior
	// hour bucket. This simulates the same warning recurring in a later
	// session (or after a day roll).
	const db = getMemoryDB();
	db.prepare(
		"UPDATE observations SET created_at_epoch = created_at_epoch - 3600000 WHERE id = ?",
	).run(id1);

	const id2 = storeObservation({
		type: "warning",
		title: "Warning: bar",
		narrative: "hour 2 (now)",
	});

	assert.notEqual(id1, id2, "different hour -> different row ids");

	const count = (
		db
			.prepare(
				"SELECT COUNT(*) AS c FROM observations WHERE type = 'warning' AND title = ?",
			)
			.get("Warning: bar") as { c: number }
	).c;
	assert.equal(count, 2, "two rows stored");
});

test("storeObservation: non-warning types are NOT deduped", () => {
	resetObservations();

	const id1 = storeObservation({
		type: "decision",
		title: "Use X",
		narrative: "first",
	});
	const id2 = storeObservation({
		type: "decision",
		title: "Use X",
		narrative: "second",
	});

	assert.notEqual(id1, id2, "decisions with same title in same hour do NOT dedupe");

	const db = getMemoryDB();
	const count = (
		db
			.prepare(
				"SELECT COUNT(*) AS c FROM observations WHERE type = 'decision' AND title = ?",
			)
			.get("Use X") as { c: number }
	).c;
	assert.equal(count, 2, "both rows stored");
});

test("storeObservation: different warning titles within the same hour stay distinct", () => {
	resetObservations();

	const id1 = storeObservation({
		type: "warning",
		title: "Warning: alpha",
		narrative: "",
	});
	const id2 = storeObservation({
		type: "warning",
		title: "Warning: beta",
		narrative: "",
	});

	assert.notEqual(id1, id2, "different titles -> different rows");
});

test("migrateV8ToV9 is idempotent on a v9 DB", () => {
	resetObservations();

	// Seed two identical warnings in the same hour.
	storeObservation({
		type: "warning",
		title: "Warning: idempotent",
		narrative: "",
	});
	const beforeCount = (
		getMemoryDB()
			.prepare("SELECT COUNT(*) AS c FROM observations WHERE type = 'warning'")
			.get() as { c: number }
	).c;
	assert.equal(beforeCount, 1, "first insert + dedup'd second insert = 1 row");

	// Re-run migrations. v8ToV9 should be a no-op now.
	applyMigrations({ db: getMemoryDB() });

	const afterCount = (
		getMemoryDB()
			.prepare("SELECT COUNT(*) AS c FROM observations WHERE type = 'warning'")
			.get() as { c: number }
	).c;
	assert.equal(afterCount, 1, "count unchanged after re-running migrations");

	const version = (
		getMemoryDB()
			.prepare("SELECT MAX(version) AS v FROM schema_versions")
			.get() as { v: number | null }
	).v;
	assert.equal(version, 10, "schema_version stays at 10");
});

test("cleanup", () => {
	closeMemoryDB();
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// best-effort
	}
});
