# Workflow Routing

Route work to the right execution layer. Apply these in order.

## Decision Priority

1. **Fix/update/refactor existing code** → direct tools; do **not** use harness by default.
2. **Build/create/make a product-level artifact, app, feature, or multi-file codebase** → `harness`.
3. **Create/edit docs, diagrams, prompts, config, tests for existing behavior, or agent files** → direct tools unless the user explicitly asks for harness.
4. **Modify the harness extension itself** → direct tools or an explicit file/tmux review workflow; do not recursively use harness unless the user explicitly asks.
5. **Research/explore/review/plan/visual audit** → direct tools and visible `.pi/artifacts/<id>/` artifacts; self-spawn in tmux only when independent fresh context is worth the overhead.
6. **Ambiguous or destructive request** → ask before acting.

## Primitive Table

| Primitive | Use For |
|---|---|
| Direct tools | Normal coding, review, edits, tests, research |
| `.pi/artifacts/<id>/PLAN.md` / `PROGRESS.md` | Visible planning and tracking |
| `TODO.md` | Task checklist per artifact |
| `.pi/cli/*.mjs` | Repeatable browser/automation wrappers |
| `tmux` | Dev servers, logs, long-running commands |
| `task` tool | Delegate complex work to specialist agents — spawns pi in a tmux split pane, polls for completion |
| `pi --print/--print-turn` in tmux | Self-spawn isolated review/research |
| `npx fallow` / `fallow-mcp` | Codebase analysis before and after TS/JS edits — dead code, dupes, complexity, blast radius |
| `harness` | Product-level planner → worker → reviewer builds |

## Minimalism Gate

Before `task`, harness, tmux, or self-spawn:

- Can direct tools solve this in the current session?
- Can a file artifact replace hidden runtime state?
- Would tmux make the process more observable?
- Will output be written under `.pi/artifacts/<id>/` and independently verified?

## Delegation Rules

**Do it yourself** when: surgical request, few tool calls, ambiguity needs direct judgment, provenance matters.

**Use `task` tool** when:
- Work is complex and well-defined
- Benefits from fresh context (no session cruft)
- Work is independently verifiable via a RESULT.md file
- You want to watch the sub-agent work live
- You want to run multiple sub-agents in parallel

**Do NOT use `task` when:**
- The task requires interactive back-and-forth with the caller (task is write-once, read-once)
- The task needs access to the current session's memory, variables, or state
- The task is trivial (1-2 tool calls) — direct tools are faster
- No matching agent exists for the task type

**Self-spawn** (raw `pi --print/--print-turn` in tmux) when: non-standard toolset needed, requires existing session state, or the task needs specific interaction that `task` doesn't support.

## Task Tool Protocol

### Call

When you invoke `task(agent_type, prompt, description, background?)`:

```
task(agent_type="explore", prompt="...", description="3-5 word summary")
```

- `agent_type` — must match a `.md` file name in `.pi/agents/` (project) or `~/.pi/agent/agents/` (user global). Overrides: project wins over user.
- `prompt` — complete, self-contained instructions. The sub-agent starts fresh with zero session history.
- `description` — short label shown in the live widget and completion notification.
- `background` — defaults to `false`, but **all tasks are background-only** (the tool always spawns a tmux pane and returns immediately). The flag is accepted but irrelevant.

### What happens

1. Agent is resolved from `.pi/agents/*.md` by name (frontmatter: description, model, thinking, disallowed_tools)
2. Artifact directory created: `.pi/artifacts/task-<id>/`
3. Three handoff files written:
   - `SYSTEM.md` — agent system prompt (from frontmatter body)
   - `WORKER-CONTEXT.md` — your prompt, agent info, working directory, output format
   - `USER-PROMPT.md` — entry point instructing sub-agent to read WORKER-CONTEXT.md
4. `pi` CLI spawned in a **tmux split pane** (horizontal split) with:
   - `--name task-<id>` — agent session name
   - `--model` — from agent config
   - `--tools` — filtered by `disallowed_tools`
   - `--session-dir` — writes JSONL logs for live toolcall tracking
   - `--append-system-prompt SYSTEM.md` — injects system prompt
   - `PI_TASK_TOOL_DISABLED=1` — prevents recursive tool loading
5. Tool returns immediately with `{ details: { background: true } }` — **no result content**

### Watching live

The tmux split pane is visible in your terminal — you see the sub-agent working in real time. No extra command needed. The pane title defaults to the tmux pane ID (not set by the extension).

### Live widget

A sticky widget appears above the editor showing all running tasks:
```
Agent - description  N toolcalls • elapsed
```
- Updates elapsed time every 1 second (via `requestRender()` timer)
- Updates toolcall count every 3 seconds (via JSONL session polling)
- Multiple tasks stack as separate lines

### Completion

When the sub-agent finishes writing `RESULT.md`, the extension:
1. Reads the file from `.pi/artifacts/task-<id>/RESULT.md`
2. Kills the tmux pane
3. Parses the XML-tagged output:
   ```
   <status>success|failure|blocked|partial</status>
   <summary>One sentence summary</summary>
   <findings>Key findings with file:line references</findings>
   <evidence>Verification evidence</evidence>
   ```
4. Sends a `task-complete` notification with agent name, description, elapsed time, toolcall count, status, summary, and findings

### Notification format

The notification appears in the TUI as:
```
agent - description
N toolcalls • duration
summary
```

Use `expanded` view to see full findings and evidence.

### Output format (sub-agent requirement)

**Every `task` delegation MUST instruct the sub-agent to write its result using this XML format:**

```
<status>success|failure|blocked|partial</status>
<summary>One sentence: what was accomplished</summary>
<findings>Key findings with file:line references</findings>
<evidence>Verification evidence, commands run, output snippets</evidence>
<files>Comma-separated absolute paths of files read/created (optional)</files>
```

If the output lacks XML tags, the extension treats the entire output as `summary` with `status=unknown`.

### Concurrent tasks

You can launch multiple tasks in parallel by making multiple `task` tool calls in a single message. Each gets its own tmux pane, artifact directory, and polling slot. All appear in the widget simultaneously.

### Cleanup

The extension cleans up on `session_shutdown`:
- Stops the check interval and count interval
- Removes the widget
- **Does NOT** remove task artifact directories (they persist for inspection)

## Self-Spawn and Harness Distrust

Never accept delegated output blindly. After any delegated or harness run:

1. Read changed files directly.
2. Review the diff.
3. Run verification.
4. Confirm scope was respected.
5. Report verification evidence.

## Artifacts

**For EVERY non-trivial request or subtask** (2+ tool calls or multiple files), create a fresh artifact:

1. Create `.pi/artifacts/<id>/` with a short kebab-case id describing the task
2. Write `.pi/artifacts/<id>/PLAN.md` with a `## Discovery` section
3. Write `.pi/artifacts/<id>/TODO.md` with checkbox steps
4. Track decisions and notes in `.pi/artifacts/<id>/PROGRESS.md`

Skip for: one-line fixes, docs-only, config tweaks, trivial tests.

The TODO.md creation and checkbox protocol is defined in `AGENTS.md` Hard Constraints — follow it for every artifact.

**Do not reuse a previous artifact id.** Each new request gets a new id. If a request is a continuation of prior work, create a new artifact with a new id and reference the previous one in PROGRESS.md.

## Quality Loop

After any non-trivial implementation, run an iterative fix-verify loop (see `quality-loop` skill):

1. Run all quality gates (typecheck → lint → tests → TODO.md → stubs)
2. If any fail: auto-fix, re-run gates, repeat
3. Max 3 iterations (harness) or 2 iterations (direct worker)
4. Report outcome with iteration count and remaining issues

Skip only for: one-line fixes, docs-only, config tweaks, trivial tests that cannot break existing behavior.

For complex handoffs, write shared context to `.pi/artifacts/<id>/WORKER-CONTEXT.md`, then point a spawned session to it:

```
mkdir -p .pi/artifacts/<id>
pi --name "review <id>" --print-turn "Read .pi/artifacts/<id>/WORKER-CONTEXT.md and produce .pi/artifacts/<id>/REVIEW.md"
```

## Context Retrieval

- `memory-search` → durable project knowledge (prior decisions, bugs, patterns, warnings)
- `vcc_recall()` → current-session recovery (earlier output, commands, user decisions)
- `npx fallow health --changed-since main --format json` → complexity and blast-radius context before editing TS/JS files; see `.pi/skills/fallow/SKILL.md`

After either path, verify current code/config/git state from disk before acting. Serialize `compress` calls — never run multiple compressions in parallel.
