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

export type HarnessWorkspaceMode = "current" | "worktree" | "auto";

export interface HarnessWorkspace {
	cwd: string;
	isolated: boolean;
	mode: HarnessWorkspaceMode;
	worktreePath?: string;
	warning?: string;
}

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

/**
 * Select the workspace a harness run should mutate.
 *
 * Default policy is current workspace. Worktrees are opt-in because they add
 * copy-back/merge overhead and make live tmux panes less directly connected to
 * the files the user is editing.
 *
 * `auto` currently aliases `current`; callers should choose `worktree`
 * explicitly when risk/complexity justifies isolation.
 */
export async function createHarnessWorkspace(
	cwd: string,
	prompt: string,
	mode: HarnessWorkspaceMode = "current",
): Promise<HarnessWorkspace> {
	if (mode === "current" || mode === "auto") {
		return { cwd, isolated: false, mode };
	}

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
		return { cwd: worktreePath, isolated: true, mode, worktreePath };
	} catch (err) {
		return {
			cwd,
			isolated: false,
			mode,
			warning: `Could not create isolated git worktree; using current cwd without automatic git rollback. ${(err as Error).message}`,
		};
	}
}
