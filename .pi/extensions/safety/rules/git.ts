/**
 * Safety Rules — Git Operations
 *
 * Ported from guardrails.ts + guardian.ts. 8 rules covering
 * force push, reset --hard, restore ., clean, branch delete, stash drop, git add .
 */

import { block, confirm, rule, type RuleSet, type Verdict } from "../types.js";

type GitConfirmThreat = "data-destruction" | "data-integrity";

function gitConfirm(
  id: string,
  threat: GitConfirmThreat,
  message: string,
  pattern: RegExp,
  cmd: string,
): Verdict | null {
  return pattern.test(cmd) ? confirm(id, "medium", threat, message) : null;
}

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
        ? block(
            "no-force-push-main",
            "critical",
            "history-rewrite",
            "Force push to main/master is forbidden. Use --force-with-lease on feature branches instead.",
          )
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
        ? block(
            "no-push-mirror",
            "critical",
            "history-rewrite",
            "`git push --mirror` can overwrite all remote branches and tags, including main/master.",
          )
        : null,
  }),
  rule({
    id: "warn-git-reset-hard",
    description: "Warn on git reset --hard",
    severity: "medium",
    threat: "data-destruction",
    targets: ["bash"],
    check: (ctx) =>
      gitConfirm(
        "warn-git-reset-hard",
        "data-destruction",
        "`git reset --hard` discards all uncommitted changes. This is destructive and irreversible.",
        /git\s+reset\s+--hard/,
        ctx.command!,
      ),
  }),
  rule({
    id: "warn-git-restore-dot",
    description: "Warn on git restore . (discard all changes)",
    severity: "medium",
    threat: "data-destruction",
    targets: ["bash"],
    check: (ctx) =>
      gitConfirm(
        "warn-git-restore-dot",
        "data-destruction",
        "`git restore .` discards uncommitted changes in tracked files.",
        /git\s+restore\s+(\.(\s|$)|.*--\s+\.(\s|$))/,
        ctx.command!,
      ),
  }),
  rule({
    id: "warn-git-add-dot",
    description: "Warn on git add . (stages all changes)",
    severity: "medium",
    threat: "data-integrity",
    targets: ["bash"],
    check: (ctx) =>
      gitConfirm(
        "warn-git-add-dot",
        "data-integrity",
        "`git add .` stages all changes including unrelated files. Stage specific paths instead.",
        /git\s+add\s+(\.\s*$|\.$|\s+\.(\s|$))/,
        ctx.command!,
      ),
  }),
  rule({
    id: "warn-git-clean",
    description: "Warn on git clean -fd (remove untracked files)",
    severity: "medium",
    threat: "data-destruction",
    targets: ["bash"],
    check: (ctx) =>
      gitConfirm(
        "warn-git-clean",
        "data-destruction",
        "`git clean -f` permanently removes untracked files. They cannot be recovered.",
        /git\s+clean\s+.*-[a-zA-Z]*f/,
        ctx.command!,
      ),
  }),
  rule({
    id: "warn-git-branch-delete",
    description: "Branch deletion",
    severity: "medium",
    threat: "data-destruction",
    targets: ["bash"],
    check: (ctx) =>
      gitConfirm(
        "warn-git-branch-delete",
        "data-destruction",
        "Branch deletion detected.",
        /git\s+(branch|push)\s+.*(-[dD]|--delete)\b/,
        ctx.command!,
      ),
  }),
  rule({
    id: "warn-stash-drop",
    description: "Stash drop or clear",
    severity: "medium",
    threat: "data-destruction",
    targets: ["bash"],
    check: (ctx) =>
      gitConfirm(
        "warn-stash-drop",
        "data-destruction",
        "Dropped stashes cannot be easily recovered.",
        /git\s+stash\s+(drop|clear)\b/,
        ctx.command!,
      ),
  }),
];
