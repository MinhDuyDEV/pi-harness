/**
 * FTS5 Project File Indexing
 *
 * Indexes project .md, .ts, .json, .yaml files into a virtual FTS5 table
 * so memory search returns BOTH learned observations AND native project knowledge.
 * Reconciles on session start via fingerprint diffing (stat.size + mtimeMs).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { getMemoryDB } from "./db.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS project_fts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    last_indexed_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS project_fts_idx USING fts5(
    file_path, content,
    content='project_fts',
    content_rowid='id',
    tokenize='porter unicode61'
  );
`;

const TRIGGERS_SQL = `
  CREATE TRIGGER IF NOT EXISTS project_fts_ai AFTER INSERT ON project_fts BEGIN
    INSERT INTO project_fts_idx(rowid, file_path, content) VALUES (new.id, new.file_path, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS project_fts_ad AFTER DELETE ON project_fts BEGIN
    INSERT INTO project_fts_idx(project_fts_idx, rowid, file_path, content) VALUES('delete', old.id, old.file_path, old.content);
  END;
  CREATE TRIGGER IF NOT EXISTS project_fts_au AFTER UPDATE ON project_fts BEGIN
    INSERT INTO project_fts_idx(project_fts_idx, rowid, file_path, content) VALUES('delete', old.id, old.file_path, old.content);
    INSERT INTO project_fts_idx(rowid, file_path, content) VALUES (new.id, new.file_path, new.content);
  END;
`;

// ---------------------------------------------------------------------------
// Excluded dirs and file extensions
// ---------------------------------------------------------------------------

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "target", "vendor", ".next", ".turbo",
  "build", "coverage", ".nyc_output", "__pycache__", ".pi/artifacts",
]);

const INCLUDED_EXTS = new Set([
  ".md", ".ts", ".tsx", ".js", ".jsx", ".json", ".yaml", ".yml", ".toml",
]);

const MAX_FILE_SIZE = 1_000_000; // 1MB
const MAX_INDEXED_FILES = 200;

// ---------------------------------------------------------------------------
// Lazy init guard
// ---------------------------------------------------------------------------

let projectIndexInitialized = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ProjectIndexStats {
  total: number;
  fresh: number;
  stale: number;
}

export interface ProjectFileRow {
  file_path: string;
  snippet: string;
  score: number;
}

export function ensureProjectFTSSchema(): void {
  if (projectIndexInitialized) return;
  const db = getMemoryDB();
  db.exec(SCHEMA_SQL);
  db.exec(TRIGGERS_SQL);
  projectIndexInitialized = true;
}

function shouldExclude(dir: string): boolean {
  const parts = dir.split("/");
  return parts.some((p) => EXCLUDED_DIRS.has(p) || p.startsWith("."));
}

export function walkProjectFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (shouldExclude(full)) continue;
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (stat.isFile() && INCLUDED_EXTS.has(extname(entry)) && stat.size <= MAX_FILE_SIZE) {
          files.push(full);
        }
      } catch { /* skip */ }
    }
  }
  walk(root);
  // Limit to MAX_INDEXED_FILES (keep first N encountered)
  return files.slice(0, MAX_INDEXED_FILES);
}

function computeFingerprint(filePath: string): string | null {
  try {
    const s = statSync(filePath);
    return `${s.size}-${s.mtimeMs}`;
  } catch { return null; }
}

function indexFile(filePath: string, root: string): "hit" | "updated" | "skipped" {
  const fp = computeFingerprint(filePath);
  if (!fp) return "skipped";

  const db = getMemoryDB();
  const existing = db.prepare(`SELECT fingerprint FROM project_fts WHERE file_path = ?`).get(filePath) as { fingerprint: string } | undefined;
  if (existing?.fingerprint === fp) return "hit";

  let content: string;
  try { content = readFileSync(filePath, "utf-8"); } catch { return "skipped"; }
  const relPath = relative(root, filePath);

  db.prepare(`INSERT INTO project_fts (file_path, content, fingerprint, last_indexed_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET content=excluded.content, fingerprint=excluded.fingerprint, last_indexed_at=excluded.last_indexed_at`)
    .run(relPath, content, fp, Date.now());

  return "updated";
}

export function reconcileProjectIndex(root: string): ProjectIndexStats {
  ensureProjectFTSSchema();
  const db = getMemoryDB();

    const diskFiles = walkProjectFiles(root);
    const indexed = db.prepare(`SELECT file_path FROM project_fts`).all() as Array<{ file_path: string }>;

    let fresh = 0, stale = 0;

  // Index new/changed files
  for (const f of diskFiles) {
    const relPath = relative(root, f);
    const result = indexFile(f, root);
    if (result === "updated") fresh++;
  }

  // Remove deleted files from index
  for (const row of indexed) {
    if (!diskFiles.some((f) => relative(root, f) === row.file_path)) {
      db.prepare(`DELETE FROM project_fts WHERE file_path = ?`).run(row.file_path);
      stale++;
    }
  }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM project_fts`).get() as { c: number }).c;
  return { total, fresh, stale };
}

export function searchProjectIndex(query: string, limit = 5): ProjectFileRow[] {
  ensureProjectFTSSchema();
  const db = getMemoryDB();
  // Preserve path-relevant characters, strip only what breaks FTS5 syntax
  const sanitized = query.replace(/[^\w\s.\/-]/g, " ").trim();
  if (!sanitized) return [];
  const terms = sanitized.split(/\s+/).filter(Boolean).map((t) => `"${t}"`).join(" OR ");

  const rows = db.prepare(`
    SELECT project_fts.file_path, snippet(project_fts_idx, 0, '<<', '>>', '...', 32) AS snippet, bm25(project_fts_idx) AS score
    FROM project_fts_idx JOIN project_fts ON project_fts.id = project_fts_idx.rowid
    WHERE project_fts_idx MATCH ?
    ORDER BY score LIMIT ?
  `).all(terms, limit) as unknown as ProjectFileRow[];

  return rows.map((r) => ({ ...r, score: -r.score }));
}

export function mergeWithObservationSearch(
  query: string,
  opts?: { limit?: number },
): Array<ProjectFileRow & { source: string }> {
  const limit = opts?.limit ?? 8;

  // Observation search
  const db = getMemoryDB();
  const safeQuery = query.replace(/[%_\\]/g, (c: string) => `\\${c}`);
  const obsPattern = `%${safeQuery}%`;
  const observations = db.prepare(`
    SELECT 'observation' as source, id as file_path, title || ': ' || substr(narrative, 1, 200) AS snippet, 1.0 AS score
    FROM observations WHERE title LIKE ? ESCAPE '\\' OR narrative LIKE ? ESCAPE '\\'
    ORDER BY created_at_epoch DESC LIMIT ?
  `).all(obsPattern, obsPattern, limit) as unknown as Array<ProjectFileRow & { source: string }>;

  // Project file search
  const projectFiles = searchProjectIndex(query, limit).map((r) => ({ ...r, source: "project" as const }));

  // Interleave: project first, then observations
  const merged: Array<ProjectFileRow & { source: string }> = [];
  const maxLen = Math.max(projectFiles.length, observations.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < projectFiles.length) merged.push(projectFiles[i]);
    if (i < observations.length) merged.push(observations[i]);
  }

  return merged.slice(0, limit);
}
