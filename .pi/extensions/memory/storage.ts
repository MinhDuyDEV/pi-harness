/**
 * Memory Storage — Low-level memory-file CRUD
 *
 * Extracted from maintenance.ts to break the import cycle:
 *   maintenance.ts → pipeline.ts → scene.ts → maintenance.ts
 *
 * Now scene.ts, tools.ts, persona.ts, etc. import from here instead.
 */

import { getMemoryDB } from "./db.js";
import type { MemoryFileRow } from "./config.js";

// ---------------------------------------------------------------------------
// Memory File Operations
// ---------------------------------------------------------------------------

export function upsertMemoryFile(
	filePath: string,
	content: string,
	mode: "replace" | "append" = "replace",
): void {
	const db = getMemoryDB();
	const now = new Date().toISOString();
	const nowEpoch = Date.now();

	db.prepare(
		`INSERT INTO memory_files (file_path, content, mode, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       content = CASE WHEN excluded.mode = 'append'
         THEN memory_files.content || '\n\n' || excluded.content
         ELSE excluded.content END,
       mode = excluded.mode,
       updated_at = ?,
       updated_at_epoch = ?`,
	).run(filePath, content, mode, now, nowEpoch, now, nowEpoch);

	// SQLite is the canonical store. No filesystem mirror.
}

export function getMemoryFile(filePath: string): MemoryFileRow | null {
	const db = getMemoryDB();
	return (
		(db
			.prepare("SELECT * FROM memory_files WHERE file_path = ?")
			.get(filePath) as unknown as MemoryFileRow | undefined) ?? null
	);
}

export function getMarkdownFilesInSqlite(): string[] {
	const db = getMemoryDB();
	const rows = db
		.prepare(
			"SELECT markdown_file FROM observations WHERE markdown_file IS NOT NULL",
		)
		.all() as Array<{ markdown_file: string }>;
	return rows.map((r) => r.markdown_file);
}
