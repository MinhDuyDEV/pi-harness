/**
 * Safety Rules — Git Operations
 *
 * Ported from guardrails.ts + guardian.ts. 8 rules covering
 * force push, reset --hard, checkout ., clean, add ., no-verify,
 * rebase -i, branch delete, stash drop.
 */

import { block, confirm, rule, type RuleSet } from "../types.js";

export const gitRules: RuleSet = [
	rule({
		id: "no-force-push-main",
		description: "Never force push main/master",
		severity: "critical",
		threat: "history-rewrite",
		targets: ["bash"],
		check: (ctx) => {
			const cmd = ctx.command!;
			const forceFlag =
				/git\s+push(?:\s+\S+)*?\s+(-f|--force)(?!-with-lease)/.test(cmd) &&
				/\b(main|master)\b/.test(cmd);
			const forceRefspec = /git\s+push\s+.*\+(main|master)\b/.test(cmd);
			return forceFlag || forceRefspec
				? block("no-force-push-main", "critical", "history-rewrite",
					"Force push to main/master is forbidden. Use --force-with-lease on feature branches instead.")
				: null;
		},
	}),
	rule({
		id: "no-push-mirror",
		description: "Block git push --mirror (rewrites all remote refs)",
		severity: "critical",
		threat: "history-rewrite",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+push\s+.*--mirror/.test(ctx.command!)
				? block("no-push-mirror", "critical", "history-rewrite",
					"`git push --mirror` can overwrite all remote branches and tags, including main/master.")
				: null,
	}),
	rule({
		id: "warn-git-reset-hard",
		description: "Warn on git reset --hard",
		severity: "medium",
		threat: "data-destruction",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+reset\s+--hard/.test(ctx.command!)
				? confirm("warn-git-reset-hard", "medium", "data-destruction",
					"`git reset --hard` discards all uncommitted changes. This is destructive and irreversible.")
				: null,
	}),
	rule({
		id: "warn-git-checkout-dot",
		description: "Warn on git checkout . (discard all changes)",
		severity: "medium",
		threat: "data-destruction",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+checkout\s+(\.|-- \.)/.test(ctx.command!)
				? confirm("warn-git-checkout-dot", "medium", "data-destruction",
					"`git checkout .` discards all uncommitted changes in tracked files.")
				: null,
	}),
	rule({
		id: "warn-git-restore-dot",
		description: "Warn on git restore . (discard all changes)",
		severity: "medium",
		threat: "data-destruction",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+restore\s+(\.(\s|$)|.*--\s+\.(\s|$))/.test(ctx.command!)
				? confirm("warn-git-restore-dot", "medium", "data-destruction",
					"`git restore .` discards uncommitted changes in tracked files.")
				: null,
	}),
	rule({
		id: "warn-git-clean",
		description: "Warn on git clean -fd (remove untracked files)",
		severity: "medium",
		threat: "data-destruction",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+clean\s+.*-[a-zA-Z]*f/.test(ctx.command!)
				? confirm("warn-git-clean", "medium", "data-destruction",
					"`git clean -f` permanently removes untracked files. They cannot be recovered.")
				: null,
	}),
	rule({
		id: "warn-git-add-all",
		description: "Warn on git add . (stage everything)",
		severity: "low",
		threat: "sensitive-modification",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+add\s+(\.|--all|-A)(\b|$|\s)/.test(ctx.command!)
				? confirm("warn-git-add-all", "low", "sensitive-modification",
					"`git add .` stages everything including unintended files. Stage specific files instead.")
				: null,
	}),
	rule({
		id: "warn-bypass-hooks",
		description: "Warn on --no-verify flag",
		severity: "medium",
		threat: "sensitive-modification",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+.*--no-verify/.test(ctx.command!)
				? confirm("warn-bypass-hooks", "medium", "sensitive-modification",
					"`--no-verify` bypasses git hooks. This may skip important checks.")
				: null,
	}),
	rule({
		id: "warn-git-rebase-interactive",
		description: "Interactive rebase (history rewrite)",
		severity: "medium",
		threat: "history-rewrite",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+rebase\s+(-i|--interactive)\b/.test(ctx.command!)
				? confirm("warn-git-rebase-interactive", "medium", "history-rewrite",
					"Interactive rebase rewrites git history. If this branch has been pushed, others may have based work on it.")
				: null,
	}),
	rule({
		id: "warn-git-branch-delete",
		description: "Branch deletion",
		severity: "medium",
		threat: "data-destruction",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+(branch|push)\s+.*(-[dD]|--delete)\b/.test(ctx.command!)
				? confirm("warn-git-branch-delete", "medium", "data-destruction",
					"Branch deletion detected.")
				: null,
	}),
	rule({
		id: "warn-stash-drop",
		description: "Stash drop or clear",
		severity: "medium",
		threat: "data-destruction",
		targets: ["bash"],
		check: (ctx) =>
			/git\s+stash\s+(drop|clear)\b/.test(ctx.command!)
				? confirm("warn-stash-drop", "medium", "data-destruction",
					"Dropped stashes cannot be easily recovered.")
				: null,
	}),
];
