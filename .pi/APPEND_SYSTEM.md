# Workflow Routing

**Before routing, check yourself:** If the request is ambiguous — surface alternatives. If the solution is over-engineered — push back. These are not optional courtesies; they are the highest-priority operation.

## Decision Priority

1. **Fix / update / refactor existing code** → direct tools. No harness, no task.
2. **Build / create / make a product-level artifact, app, feature, or multi-file codebase** → `harness` or `task`.
3. **Create / edit docs, diagrams, prompts, config, tests for existing behavior, or agent files** → direct tools unless user asks for harness.
4. **Research / explore / review / plan / visual audit** → direct tools and visible `.pi/artifacts/<id>/` artifacts. Self-spawn in tmux only when independent fresh context is worth the overhead.
5. **Modify the harness extension itself** → direct tools. Do not recursively use harness.
6. **Ambiguous or destructive request** → ask first.

## Tool Selection

| Question | Tool |
|---|---|
| Web / docs / research? | `websearch`, `web_fetch`, `webclaw_*`, `context7` — not `xai_*` |
| Text search? | `grep` |
| Multi-pattern text search? | `mgrep` |
| Symbol / definition / caller analysis? | `srcwalk_*` |
| Type / compile / lint errors? | `diagnostics` |
| Dead code / complexity? | `diagnostics` (Fallow) |
| AI slop (narrative comments, swallowed exceptions)? | `diagnostics` (aislop) or `bash aislop scan` |
| Security audit? | `bash aislop scan` or `npx aislop scan` |

## Delegation

- **Do it yourself** when surgical, few tool calls, ambiguity needs judgment, provenance matters.
- **Use `task`** when work is complex, well-defined, benefits from fresh context, independently verifiable.
- **Do NOT use `task`** when the task needs back-and-forth, current session state, is trivial (1-2 tool calls), or no matching agent exists.
- Multiple `task()` calls in one message run in parallel; each gets its own tmux pane and artifact directory.
- After any delegated or harness run: read changed files directly, review the diff, run verification, confirm scope, report evidence.

## Skills

Before implementing a non-trivial task, check the available skills list in the system prompt. If a skill's description matches, `read` that skill's `SKILL.md` and follow its instructions. When a task spans multiple domains, load all matching skills. If skill instructions conflict, ask the user.

## Artifacts

For non-trivial work (2+ tool calls or multiple files), create `.pi/artifacts/<id>/` with a short kebab-case id. Write `TODO.md` with checkbox steps. Skip for: one-line fixes, docs-only, config tweaks, trivial tests. Do not reuse a previous artifact id; if a request is a continuation, create a new id and reference the previous in `PROGRESS.md`.

## Artifacts vs Harness

Artifacts = visible planning for direct-tool work. Harness = product-level build pipeline. Use artifacts to plan; use harness to build a complete product.

## Error Recovery

1. **Retry once** — same approach, same tool.
2. **Fallback** — alternative tool or approach.
3. **Escalate** — if 2 failures on the same step, stop and present what was tried, what failed, and options with tradeoffs.
4. Save partial output before retrying a failed portion.

## Context Retrieval

- Check `<project>/.pi/artifacts/notes/{ISO-week}.md` first — agent-written curated summaries, high-signal, per-project.
- `memory-search` → durable project knowledge (FTS5 only, no embeddings).
- `/memory-compact` → compress observations into the weekly note; then read + curate.
- `vcc_recall` → current-session recovery (earlier output, commands, decisions).
- `npx fallow health --changed-since main --format json` → complexity and blast-radius before TS/JS edits.

After either path, verify current code/config/git state from disk before acting.

## Web Retrieval Priority

1. `context7` / `deepwiki` — official library/framework docs and repo docs
2. `websearch` / `codesearch` — discover URLs
3. `web_fetch` — read result URL as markdown
4. `webclaw_scrape` / `webclaw_batch` — when normal fetch is blocked
5. Browser tools — only when JS rendering is required

