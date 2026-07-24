<!-- pi-harness-runtime-policy:v1 -->
# Pi harness runtime guidance

This is supplemental project guidance. Follow the host system message, user request, and Pi's native tool/resource contracts first; these notes add harness-specific detail only where higher-priority instructions are silent.

- Keep changes focused, reversible, and portable across Pi installations.
- Inspect before editing and preserve unrelated worktree changes; never stage broad diffs in a dirty tree.
- Prefer the smallest relevant test or typecheck command first, then run `npm run check` before declaring a change complete.
- Treat `.pi/artifacts/` and `.pi/MEMORY.md` as local runtime state; never put credentials or generated caches in tracked files.
- Do not assume optional tools or extensions, MCP servers, browser tooling, providers, or model names are installed unless the package is loaded; treat them as unavailable.
- If a required tool or dependency is unavailable, report it explicitly instead of fabricating a successful result.
- Do not claim a test, build, package install, or release check passed without showing the command and observed result.

## Delegation

Use `task` when isolation, repo discovery, parallelism, or independent verification is worth the review cost. Independent `task` calls go in one message, parallel. Do not edit files owned by a running background task. Parent verifies artifacts — never ship on a subagent summary alone. The runtime is `@minhduydev/pi-subagents`; load `/skill:pi-subagents` for full recipes (execution patterns, delegation examples, scheduling, evidence/review, recovery) — do not copy those recipes here.

### Pane and workspace placement (HerdR UX)

Pick placement by task shape, not habit. Foreground splits preserve focus (`--no-focus`), so they open without stealing the cursor.

| Situation | Mode | Where it appears |
|---|---|---|
| trivial single-file edit, direct Q&A, one known file | inline — no `task` | parent pane |
| 1-3 quick parallel reads / explore / research | foreground, shared cwd | foreground split in the current workspace (visible, easy to watch) |
| a coherent batch of related tasks (audit N files; implement + review + proof-audit; parallel writers on different areas) | one `workspace_group` label + same `batch_id`, `join: "group"` | first task opens an owned workspace root; later same-group tasks stack downward (parent workspace stays clean) |
| fire-and-forget, past the split limit, or reducing visual noise | `background: true` | queues; no immediate pane; recovers from a split race |
| any parallel or sensitive writer | `isolation: "worktree"` + exclusive `claims` | separate workspace + separate git checkout (physical isolation, clean review) |

### Pane-race fix is structural, not just batching

Exclusive write `claims` are acquired and serialized before launch — conflicting writers BLOCK rather than bursting concurrent `splitWindowPane` calls. So declare `orchestration.claims` for every writer; the old "≤3 foreground per message" rule is only a light fallback for claim-less read-only fan-out. If a `task` still reports `Failed to create herdr execution pane`, re-launch it as `background: true` — never drop the work.

### UX-smoothing behaviors to lean on

- **Preserve-focus** (`--no-focus`): panes open without stealing the cursor; the parent keeps typing.
- **Grouped completion** (`batch_id` + `join: "group"`): one coalesced `task-batch-complete` follow-up instead of N pings — the smoothest UX for parallel work, no turn storm.
- **Herdr toast on settle**: a non-intrusive completion signal.
- **Lifecycle state is a wake-up hint, never success**: `working` → leave alone; `blocked` → inspect and steer once (`/task-steer <id> <msg>`); `idle`/`done` → reconcile the Pi session JSONL; `unknown` → uncertain, never success. Do not stare at `working` panes.
- **Attention broker** (optional): `herdr plugin link <installed>/@minhduydev/pi-subagents/herdr-plugin/attention-broker` wakes the `Root` supervisor on settle/blocked without polling.

### Control surface and durable state

The control tool is **`task_control`** (renamed from `herdr` in 0.5+): `status`, `result`, `handoff`, `record_evidence`, `verify`, `review`, `ship`, `release`, `reap`, `doctor`, `metrics`, and `worktree_status` / `worktree_merge` / `worktree_remove`. Human commands: `/tasks`, `/task <id>`, `/task-result <id>`, `/task-steer <id> <msg>`, `/task-stop <id>`, `/task-doctor`, `/task-metrics`, `/task-schedules`, `/task-unschedule <id>`, `/task-sessions`. Prefer human commands for destructive operations. Durable state lives in `.pi/artifacts/tasks/orchestration/` (`runs.json`, `leases.json`, `events.jsonl` mandatory, `contexts/`, `schedules.json`, `evidence/`); `events.jsonl` is correctness state and is never disabled — `PI_SUBAGENTS_NO_TELEMETRY=1` strips optional fields only.

### Evidence and review

Execution, verification, and review are independent states; a completed child is not verified success. Handoff evidence is context-only and **cannot** pass a proof gate. For `evidence-only` proof, use `task_control record_evidence` (binds producer identity, observation time, artifact digest, claim) or rely on the canonical Pi session (auto-bound by the completion hook). Reviews need a real, completed `reviewer_task_id` distinct from the producer and matching `reviewer_agent` when configured. Never invent an orchestration identity, evidence path, test result, or reviewer task ID; use `task_control worktree_merge` only after `ship` passes, and `worktree_remove` to explicitly discard retained changes.

### Discipline defaults for this harness

For `task` calls that WRITE files or touch sensitive scope, pass `orchestration` with exclusive project-relative `claims`, `lease_ttl_ms`, `proof = { mode: "evidence-only" }`, and `context` (goal, known_facts, decisions, references) so the subagent starts with provenance, not a blank slate. Keep the opt-in intentional — orchestration is off by default to preserve the additive, non-clobbering contract; turn it on where evidence and single-ownership matter.

## Verification

Trust repo reality over prompt habit. Read current disk state, project memory, then delegated exploration, then external docs. Use `dcp_recall` before guessing about compacted context, and verify recalled or delegated claims on disk before acting. For non-trivial code changes, run `task(reviewer)` with touched paths or report `REVIEW_SKIPPED: <reason>`.

## TODO tracking

Update `.pi/artifacts/TODO.md` for multi-step work, audits, plans, or changes touching more than one file. Use ADRs only for real tradeoffs.