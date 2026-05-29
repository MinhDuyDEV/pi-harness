/**
 * Git safety utilities for the Harness extension.
 *
 * Provides isolated worktree creation and git operations
 * that never stage, commit, reset, or modify dirty files.
 *
 * All functions here explicitly avoid:
 *   - git add / stage
 *   - git commit
 *   - git reset
 *   - git clean / checkout . / restore .
 *   - any operation that touches dirty or unrelated files
 */

import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HarnessWorkspace {
	cwd: string;
	isolated: boolean;
	worktreePath?: string;
	warning?: string;
}

// ─── Project Root ─────────────────────────────────────────────────────────────

/**
 * Resolve the git project root from cwd.
 * Falls back to cwd if not inside a git repository.
 * Does not modify any git state.
 */
export function resolveProjectRoot(cwd: string): string {
	try {
		return execSync("git rev-parse --show-toplevel", { cwd }).toString().trim();
	} catch {
		return cwd;
	}
}

// ─── Workspace Isolation ──────────────────────────────────────────────────────

/**
 * Create an isolated detached git worktree for harness writes.
 * Falls back to the current cwd only when git worktree creation is unavailable.
 *
 * Safety guarantees:
 *   - Uses `git worktree add --detach HEAD` — creates a detached HEAD,
 *     never stages, commits, resets, or bypasses hooks.
 *   - All agent file mutations happen inside this isolated worktree.
 *   - No automatic stage, commit, reset, or unrelated dirty-file modification
 *     is introduced at any point in the workspace lifecycle.
 *   - If worktree creation fails, execution falls back to cwd with a warning
 *     and no git isolation — caller is responsible for safety.
 */
export async function createHarnessWorkspace(cwd: string, prompt: string): Promise<HarnessWorkspace> {
	try {
		const root = resolveProjectRoot(cwd);
		const project = root.split(/[\\/]/).pop() || "project";
		const slug = prompt
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 24) || "run";
		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const worktreePath = join(homedir(), ".pi", "worktrees", project, `harness-${stamp}-${slug}`);
		mkdirSync(join(homedir(), ".pi", "worktrees", project), { recursive: true });
		execSync(`git worktree add --detach ${JSON.stringify(worktreePath)} HEAD`, { cwd: root });
		return { cwd: worktreePath, isolated: true, worktreePath };
	} catch (err) {
		return {
			cwd,
			isolated: false,
			warning: `Could not create isolated git worktree; using current cwd without automatic git rollback. ${(err as Error).message}`,
		};
	}
}
