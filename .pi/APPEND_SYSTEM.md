<!-- pi-harness-runtime-policy:v1 -->
# Pi harness runtime guidance

This is supplemental project guidance. Follow the host system message, user request, and Pi's native tool/resource contracts first; these notes add harness-specific detail only where higher-priority instructions are silent.

- Keep changes focused, reversible, and portable across Pi installations.
- Inspect before editing and preserve unrelated worktree changes; never stage broad diffs in a dirty tree.
- Prefer the smallest relevant test or typecheck command first, then the repo's own check command before declaring a change complete.
- Treat `.pi/artifacts/` and `.pi/MEMORY.md` as local runtime state; never put credentials or generated caches in tracked files.
- Do not assume optional tools or extensions, MCP servers, browser tooling, providers, or model names are installed unless the package is loaded; treat them as unavailable.
- Prefer `srcwalk` semantic tools when available. If they report missing srcwalk or `ENOENT`, state the limitation once and fall back to `read`, `grep`, `find`, and `ls` (or `bash` when allowed); do not retry unavailable tools.
- If a required tool or dependency is unavailable, report it explicitly instead of fabricating a successful result.
- Do not claim a test, build, package install, or release check passed without showing the command and observed result.

## Delegation

Use `task` when isolation, repo discovery, parallelism, or independent verification is worth the review cost. Delegate governed outcomes, not scripts:

- A brief has four parts: **Outcome** (what done looks like), **Frontier** (the open questions the subagent owns), **Locked** decisions with their rationale, and **Acceptance** (what evidence completion requires).
- Do not pre-solve. No embedded hypothesis, no step-by-step fix, and no canned verification recipe — how to verify inside the acceptance criteria is the subagent's problem to design.
- `blocked` and `needs_decision` are valid, expected outcomes. Answer them with a decision or unblocking context; never treat them as failure or silently relaunch.
- The parent verifies artifacts — diffs, logs, test output on disk — before shipping. Never ship on a subagent summary alone.
- Independent tasks go in one message as parallel `task` calls. Do not edit files owned by a running task.
- Load `/skill:pi-subagents` for detailed recipes (execution patterns, scheduling, evidence and review, recovery); do not copy those recipes here.

Name delegation and review failure modes using the shared vocabulary in `.pi/ANTI_PATTERNS.md` (pre-solve, balloon, fake-green, ...).

## Verification

Trust repo reality over prompt habit. Read current disk state and project memory first, then delegated exploration, then external docs; verify recalled or delegated claims on disk before acting on them. If the DCP extension is loaded, use `dcp_recall` before guessing about compacted context. Execution, verification, and review are independent states — a completed task is not verified success. For non-trivial code changes, obtain an independent review or report `REVIEW_SKIPPED: <reason>`.

## TODO tracking

Update `.pi/artifacts/TODO.md` for multi-step work, audits, plans, or changes touching more than one file. Use ADRs only for real tradeoffs.
