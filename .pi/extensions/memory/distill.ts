/**
 * Memory compaction — agent-driven lossy compression.
 *
 * After ADR-001 cleanup: removed the L1 temporal-message + L2 distillation
 * pipeline. The agent now does compaction: it reads recent observations via
 * `getObservationsForCompaction`, decides what to keep, and writes a markdown
 * note to `.pi/artifacts/notes/{ISO-week}.md` (per-project, not per-user).
 *
 * Per the Syntax #976 thesis:
 * - "the agent itself has some autonomy over how it compresses it" (Mario)
 * - "It just grabs a JSONL file. Bash is all you need." (Armin)
 *
 * See: .pi/artifacts/DECISIONS.md#adr-001-memory-extension-cleanup
 */

import type { ObservationRow } from "./config.js";
import { getMemoryDB } from "./db.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Walk up from `startDir` looking for the project root.
 * The project root is the nearest ancestor that contains a `package.json`.
 * Falls back to `startDir` if no marker is found (caller's responsibility to
 * log a warning in that case).
 *
 * This handles the common case where pi is run from `<project>/.pi/` or
 * `<project>/.pi/extensions/`, so we don't write to `.pi/.pi/artifacts/`.
 */
export function findProjectRoot(startDir: string): string {
	let dir = path.resolve(startDir);
	const root = path.parse(dir).root;
	while (true) {
		if (fs.existsSync(path.join(dir, "package.json"))) {
			return dir;
		}
		if (dir === root) {
			// No package.json found — return startDir as-is.
			return startDir;
		}
		dir = path.dirname(dir);
	}
}

/**
 * Return all observations from the last `sinceDays` days, ordered by
 * `created_at_epoch`. The agent decides which to keep and writes a markdown
 * note via the regular `write` tool.
 */
export function getObservationsForCompaction(
	sinceDays: number = 7,
	limit: number = 500,
): ObservationRow[] {
	const db = getMemoryDB();
	const sinceMs = Date.now() - sinceDays * 86_400_000;
	return db
		.prepare(
			`SELECT * FROM observations
           WHERE superseded_by IS NULL
             AND created_at_epoch >= ?
           ORDER BY created_at_epoch DESC
           LIMIT ?`,
		)
		.all(sinceMs, limit) as unknown as ObservationRow[];
}

/**
 * Return a markdown-formatted payload of observations, ready for the
 * agent to summarize. The agent's compaction call is responsible for
 * writing the result to disk.
 */
export function formatObservationsForCompaction(observations: ObservationRow[]): string {
	if (observations.length === 0) return "No observations to compact.";

	const sections = observations.map((o) => {
		const date = new Date(o.created_at_epoch).toISOString().slice(0, 10);
		const concepts = (() => {
			try {
				const arr = JSON.parse(o.concepts);
				return Array.isArray(arr) && arr.length > 0 ? `  concepts: ${arr.join(", ")}` : "";
			} catch {
				return "";
			}
		})();
		return `## [${o.type}] ${o.title} (${date})
${concepts}
${o.narrative ?? ""}`;
	});

	return `# Observations (${observations.length} total)\n\n${sections.join("\n\n")}`;
}

/**
 * Write a compacted markdown note to `<projectRoot>/.pi/artifacts/notes/{weekId}.md`.
 * Per-project, not per-user — these are project-level working memory.
 *
 * If `projectRoot` is not given, we walk up from `process.cwd()` to find the
 * actual project root (the nearest ancestor with a `package.json`). This
 * handles the case where pi is run from `<project>/.pi/` or similar.
 *
 * Returns the absolute path written. Throws if the write fails.
 */
export function writeCompactionNote(
	weekId: string,
	markdown: string,
	projectRoot?: string,
): string {
	const root = projectRoot ? findProjectRoot(projectRoot) : findProjectRoot(process.cwd());
	const notesDir = path.join(root, ".pi", "artifacts", "notes");
	fs.mkdirSync(notesDir, { recursive: true });
	const filePath = path.join(notesDir, `${weekId}.md`);
	fs.writeFileSync(filePath, markdown, "utf-8");
	return filePath;
}

/**
 * Get current ISO week ID, e.g. "2026-W25". Used as filename for the
 * weekly compaction note.
 */
export function getCurrentWeekId(date: Date = new Date()): string {
	const tmp = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
	const dayNum = tmp.getUTCDay() || 7;
	tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
	return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
